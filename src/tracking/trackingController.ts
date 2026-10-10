import type { EngineState, HandFreeSettings, HandPointerPosition, PointerSource, RuntimeStatus, TrackingPerformance } from '../shared/types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CameraManager } from './cameraManager';
import { CalibrationSession } from './calibration';
import { FaceLandmarkerAdapter } from './faceLandmarker';
import { HandLandmarkerAdapter, interpretHand, type HandPointerCoordinates } from './handLandmarker';
import { HeadMapper, relativeHeadPosition, type RelativeHeadPosition } from './headMapper';
import { calibrationGeometryCompatible, mapCameraToViewport, readCalibrationGeometry } from './coordinateMapping';
import { diagnostic } from '../diagnostics/diagnostics';

export interface TrackingCallbacks {
  onStatus: (status: Partial<RuntimeStatus>) => void;
  onPointer: (position: ReturnType<HeadMapper['map']>) => void;
  onPosition: (position: RelativeHeadPosition) => void;
  onCoordinate: (sample: { source: 'head' | 'hand'; point: { x: number; y: number }; confidence: number }) => void;
  onHand: (position: HandPointerPosition, gesture: ReturnType<typeof interpretHand>['gesture']) => void;
  onLandmarks: (frame: { face: NormalizedLandmark[] | null; hand: NormalizedLandmark[] | null; headEnabled: boolean; handEnabled: boolean }) => void;
}

export class TrackingController {
  readonly camera = new CameraManager();
  readonly calibration = new CalibrationSession();
  private readonly landmarker = new FaceLandmarkerAdapter();
  private readonly handLandmarker = new HandLandmarkerAdapter();
  private readonly mapper = new HeadMapper();
  private raf: number | undefined;
  private lastVideoTime = -1;
  private handStableFrames = 0;
  private lostFrames = 0;
  private stableFrames = 0;
  private running = false;
  private engineState: EngineState = 'STOPPED';
  private runToken = 0;
  private handPointer: HandPointerCoordinates = { x: .5, y: .5 };
  private activeSettings: HandFreeSettings | null = null;
  private calibrationWarningShown = false;
  private inferenceBusy = false;
  private performanceWindowStarted = performance.now();
  private lastPerformanceEmit = 0;
  private videoFrames = 0;
  private faceInferences = 0;
  private handInferences = 0;
  private pointerUpdates = 0;
  private faceInferenceTotalMs = 0;
  private handInferenceTotalMs = 0;
  private maxLoopMs = 0;
  private droppedFrames = 0;
  private endedTrack: MediaStreamTrack | null = null;
  private activeVideo: HTMLVideoElement | null = null;

  constructor(protected readonly callbacks: TrackingCallbacks) {}

  async start(video: HTMLVideoElement, settings: HandFreeSettings, deviceId?: string): Promise<void> {
    if (this.running || this.engineState === 'STARTING' || this.engineState === 'READY' || this.engineState === 'RUNNING' || this.engineState === 'PAUSED' || this.camera.currentStream) return;
    const token = ++this.runToken;
    this.engineState = 'STARTING';
    this.activeSettings = settings;
    this.lastVideoTime = -1;
    this.resetPerformance();
    this.handStableFrames = 0;
    this.callbacks.onStatus({ engineState: 'STARTING', pointerSource: this.pointerSource(settings), permission: 'prompt', cameraState: 'requesting', trackingState: 'loading', trackingPhase: 'camera-ready', error: undefined });
    try {
      await this.camera.start(video, deviceId);
      if (token !== this.runToken) return;
      this.activeVideo = video;
      const stream = this.camera.currentStream as MediaStream | null;
      this.endedTrack = stream ? stream.getVideoTracks()[0] ?? null : null;
      this.endedTrack?.addEventListener('ended', this.onCameraEnded, { once: true });
      this.engineState = 'READY';
      this.callbacks.onStatus({ engineState: 'READY', permission: 'active', cameraState: 'active', trackingState: 'ready', trackingPhase: 'camera-ready', error: undefined });
      await this.loadModels(video, settings);
      if (token !== this.runToken) return;
    } catch (error) {
      this.engineState = 'ERROR';
      throw error;
    }
    this.running = true;
    this.engineState = 'RUNNING';
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.handPointer = { x: .5, y: .5 };
    this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), cameraState: 'active', trackingState: 'tracking', trackingPhase: 'tracking', handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle' });
    this.loop(video, token);
  }

  async restart(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    this.activeSettings = settings;
    if (!this.camera.currentStream) {
      await this.start(video, settings);
      return;
    }
    const token = ++this.runToken;
    this.engineState = 'STOPPING';
    this.running = false;
    this.resetPerformance();
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.landmarker.close();
    this.handLandmarker.close();
    this.engineState = 'STARTING';
    this.callbacks.onStatus({ engineState: 'STARTING', pointerSource: this.pointerSource(settings), permission: 'active', cameraState: 'active', trackingState: 'loading', trackingPhase: 'camera-ready', error: undefined, faceDetected: false, confidence: 0, handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle', handConfidence: 0 });
    await this.loadModels(video, settings);
    if (token !== this.runToken) return;
    this.running = true;
    this.engineState = 'RUNNING';
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.handPointer = { x: .5, y: .5 };
    this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), cameraState: 'active', trackingState: 'tracking', trackingPhase: 'tracking' });
    this.loop(video, token);
  }

  private async loadModels(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    try {
      if (settings.enabledModes.includes('head')) await this.landmarker.load((phase) => this.callbacks.onStatus({ trackingPhase: phase === 'ready' ? 'camera-ready' : phase }));
      if (settings.enabledModes.includes('hand')) await this.handLandmarker.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const problem = diagnostic('MODEL_LOAD_FAILED', 'tracking.models');
      this.cleanupAfterStartFailure(video);
      this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'error', error: `${problem.explanation} ${message}`, diagnostic: problem });
      throw new Error(`${problem.title}. ${problem.explanation} ${message}`);
    }
  }

  updateSettings(settings: HandFreeSettings): void {
    const previousSource = this.activeSettings ? this.pointerSource(this.activeSettings) : 'none';
    this.activeSettings = settings;
    const nextSource = this.pointerSource(settings);
    if (previousSource !== nextSource) {
      this.handStableFrames = 0;
      this.stableFrames = 0;
      this.callbacks.onStatus({ pointerSource: nextSource, engineState: this.engineState });
    }
  }
  pause(video: HTMLVideoElement): void {
    if (!this.camera.currentStream || this.engineState === 'STOPPED' || this.engineState === 'STOPPING') return;
    this.camera.pause(video);
    this.engineState = 'PAUSED';
    this.callbacks.onStatus({ engineState: 'PAUSED', permission: 'paused', cameraState: 'paused', trackingState: 'paused', trackingPhase: 'paused', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0 });
  }
  resume(video: HTMLVideoElement): void {
    if (!this.camera.currentStream) return;
    this.camera.resume(video);
    this.engineState = 'RUNNING';
    this.lostFrames = 0;
    this.handStableFrames = 0;
    this.callbacks.onStatus({ engineState: 'RUNNING', permission: 'active', cameraState: 'active', trackingState: 'tracking', trackingPhase: 'tracking' });
  }

  stop(video: HTMLVideoElement): void {
    if (this.engineState === 'STOPPED' && !this.camera.currentStream) return;
    this.engineState = 'STOPPING';
    this.runToken += 1;
    this.running = false;
    this.inferenceBusy = false;
    this.endedTrack?.removeEventListener('ended', this.onCameraEnded);
    this.endedTrack = null;
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.activeVideo = null;
    this.landmarker.close();
    this.handLandmarker.close();
    this.activeSettings = null;
    this.handPointer = { x: .5, y: .5 };
    this.mapper.reset();
    this.engineState = 'STOPPED';
    this.callbacks.onStatus({ engineState: 'STOPPED', pointerSource: 'none', permission: 'stopped', trackingPhase: 'idle', cameraState: 'stopped', trackingState: 'idle', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0, activeCameraConsumers: [], activeFaceLoops: 0, activeHandLoops: 0, activePointerLoops: 0 });
  }

  recenter(): void { this.mapper.reset(true); }
  destroy(video: HTMLVideoElement): void { this.stop(video); }

  private cleanupAfterStartFailure(video: HTMLVideoElement): void {
    this.engineState = 'ERROR';
    this.runToken += 1;
    this.running = false;
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.endedTrack?.removeEventListener('ended', this.onCameraEnded);
    this.endedTrack = null;
    this.activeVideo = null;
    this.camera.stop(video);
    this.landmarker.close();
    this.handLandmarker.close();
    this.mapper.reset();
  }

  private onCameraEnded = (): void => {
    if (this.engineState !== 'STOPPED' && this.engineState !== 'STOPPING') {
      const video = this.activeVideo;
      if (video) this.stop(video);
      else this.callbacks.onStatus({ cameraState: 'stopped', trackingState: 'idle', permission: 'stopped', trackingPhase: 'idle', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0, error: 'The camera stream ended.' });
    }
  };

  private resetPerformance(): void {
    this.performanceWindowStarted = performance.now();
    this.lastPerformanceEmit = 0;
    this.videoFrames = 0;
    this.faceInferences = 0;
    this.handInferences = 0;
    this.pointerUpdates = 0;
    this.faceInferenceTotalMs = 0;
    this.handInferenceTotalMs = 0;
    this.maxLoopMs = 0;
    this.droppedFrames = 0;
  }

  private emitPerformance(video: HTMLVideoElement, settings: HandFreeSettings, now: number): void {
    if (now - this.lastPerformanceEmit < 250) return;
    const elapsed = Math.max(0.001, (now - this.performanceWindowStarted) / 1000);
    const faceMs = this.faceInferences ? this.faceInferenceTotalMs / this.faceInferences : 0;
    const handMs = this.handInferences ? this.handInferenceTotalMs / this.handInferences : 0;
    const performance: TrackingPerformance = {
      videoFps: this.videoFrames / elapsed,
      faceInferenceFps: this.faceInferences / elapsed,
      handInferenceFps: this.handInferences / elapsed,
      pointerFps: this.pointerUpdates / elapsed,
      renderFps: 0,
      averageInferenceMs: (this.faceInferenceTotalMs + this.handInferenceTotalMs) / Math.max(1, this.faceInferences + this.handInferences),
      faceInferenceMs: faceMs,
      handInferenceMs: handMs,
      activeCameraStreams: this.camera.currentStream ? 1 : 0,
      activeTrackingLoops: this.running ? 1 : 0,
      // Face and hand inference share this one scheduler; they are model
      // calls, not independent animation loops.
      activeMediaPipeLoops: this.running && (settings.enabledModes.includes('head') || settings.enabledModes.includes('hand')) ? 1 : 0,
      activeAnimationLoops: 0,
      droppedFrames: this.droppedFrames,
      messageSendRate: 0,
      mainThreadBlockingMs: this.maxLoopMs,
      cameraWidth: video.videoWidth,
      cameraHeight: video.videoHeight,
      updatedAt: Date.now()
    };
    this.callbacks.onStatus({ performance });
    this.performanceWindowStarted = now;
    this.lastPerformanceEmit = now;
    this.videoFrames = 0;
    this.faceInferences = 0;
    this.handInferences = 0;
    this.pointerUpdates = 0;
    this.faceInferenceTotalMs = 0;
    this.handInferenceTotalMs = 0;
    this.maxLoopMs = 0;
    this.droppedFrames = 0;
  }

  private loop(video: HTMLVideoElement, token: number): void {
    if (!this.running || token !== this.runToken || (this.engineState !== 'RUNNING' && this.engineState !== 'TRACKING_LOST')) return;
    const settings = this.activeSettings;
    if (!settings) return;
    // RAF is suspended when the user switches from the camera dashboard to
    // the controlled webpage. Use a capture timer and process only new frames.
    this.raf = window.setTimeout(() => this.loop(video, token), 33);
    if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const now = performance.now();
    this.videoFrames += 1;
    if (this.inferenceBusy) {
      this.droppedFrames += 1;
      this.emitPerformance(video, settings, now);
      return;
    }
    this.inferenceBusy = true;
    const loopStarted = now;
    let sample: ReturnType<FaceLandmarkerAdapter['detect']> = null;
    let handSample: ReturnType<HandLandmarkerAdapter['detect']> = null;
    try {
      if (settings.enabledModes.includes('head')) {
        const started = performance.now();
        sample = this.landmarker.detect(video, now);
        this.faceInferenceTotalMs += performance.now() - started;
        this.faceInferences += 1;
      }
      if (settings.enabledModes.includes('hand')) {
        const started = performance.now();
        handSample = this.handLandmarker.detect(video, now);
        this.handInferenceTotalMs += performance.now() - started;
        this.handInferences += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const problem = diagnostic('MODEL_LOAD_FAILED', 'tracking.models');
      this.cleanupAfterStartFailure(video);
      this.callbacks.onStatus({ permission: 'stopped', cameraState: 'error', trackingState: 'error', trackingPhase: 'error', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0, error: `${problem.explanation} ${message}`, diagnostic: problem });
      this.engineState = 'ERROR';
      return;
    } finally {
      this.inferenceBusy = false;
      this.maxLoopMs = Math.max(this.maxLoopMs, performance.now() - loopStarted);
    }
    this.callbacks.onLandmarks({ face: sample?.landmarks ?? null, hand: handSample?.landmarks ?? null, headEnabled: settings.enabledModes.includes('head'), handEnabled: settings.enabledModes.includes('hand') });
    const geometry = readCalibrationGeometry(video);
    const calibrationValid = calibrationGeometryCompatible(settings.calibration, geometry, this.camera.currentDeviceId, settings.mirrorCamera);
    if (!calibrationValid && !this.calibrationWarningShown) {
      const problem = diagnostic(!settings.calibration ? 'CALIBRATION_REQUIRED' : settings.calibration.mirrored !== settings.mirrorCamera ? 'MIRROR_CONFIGURATION_INVALID' : 'CALIBRATION_INVALID', 'tracking.coordinateMapping');
      this.calibrationWarningShown = true;
      this.callbacks.onStatus({ error: problem.explanation, diagnostic: problem });
    }
    if (calibrationValid) this.calibrationWarningShown = false;
    const calibration = calibrationValid ? settings.calibration : null;
    if (settings.enabledModes.includes('head')) {
      if (!sample) {
        this.engineState = 'TRACKING_LOST';
        this.lostFrames += 1;
        this.stableFrames = 0;
        this.callbacks.onStatus({ trackingPhase: this.lostFrames > 12 ? 'lost' : 'face-not-detected', faceDetected: false, confidence: 0 });
      } else {
        this.engineState = 'RUNNING';
        this.lostFrames = 0;
        this.stableFrames += 1;
        const position = relativeHeadPosition(sample);
        this.callbacks.onPosition(position);
        this.callbacks.onCoordinate({ source: 'head', point: position, confidence: sample.confidence });
        if (this.stableFrames > 8) {
          const pointer = this.mapper.map(position, calibration, settings.sensitivity, settings.smoothing, settings.deadZone, sample.confidence, geometry, settings.mirrorCamera);
          this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), trackingPhase: 'tracking', faceDetected: true, confidence: sample.confidence, diagnostic: undefined });
          if (calibrationValid) { this.pointerUpdates += 1; this.callbacks.onPointer(pointer); }
        } else this.callbacks.onStatus({ trackingPhase: 'reinitializing', faceDetected: true, confidence: sample.confidence });
      }
    }
    if (settings.enabledModes.includes('hand')) {
        if (!handSample) { this.handStableFrames = 0; this.engineState = 'TRACKING_LOST'; this.callbacks.onStatus({ engineState: 'TRACKING_LOST', handTracking: 'lost', handConfidence: 0 }); }
      else {
        this.engineState = 'RUNNING';
        const hand = interpretHand(handSample, settings.pinchThreshold, settings.handSensitivity, this.handPointer, settings.smoothing);
        this.handPointer = { x: hand.x, y: hand.y };
        this.callbacks.onCoordinate({ source: 'hand', point: { x: hand.x, y: hand.y }, confidence: hand.confidence });
        this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), handTracking: 'tracking', handConfidence: hand.confidence, diagnostic: undefined });
        const mapped = mapCameraToViewport({ x: hand.x, y: hand.y }, calibration, geometry, settings.mirrorCamera);
        const handSensitivity = Math.max(0.65, Math.min(1.6, settings.handSensitivity));
        this.handStableFrames += 1;
        if (calibrationValid && mapped && this.handStableFrames > 5) { this.pointerUpdates += 1; this.callbacks.onHand({ x: Math.max(0.01, Math.min(0.99, 0.5 + (mapped.x - 0.5) * handSensitivity)), y: Math.max(0.01, Math.min(0.99, 0.5 + (mapped.y - 0.5) * handSensitivity)), confidence: hand.confidence, source: 'hand-tracking' }, hand.gesture); }
      }
    }
    this.emitPerformance(video, settings, performance.now());
  }

  private pointerSource(settings: HandFreeSettings): PointerSource {
    if (settings.enabledModes.includes('hand')) return settings.touchViewEnabled ? 'touchview-hand' : 'hand';
    if (settings.enabledModes.includes('head') || settings.headControlEnabled) return 'head';
    return 'none';
  }
}
