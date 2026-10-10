import type { EngineState, HandFreeSettings, HandPointerPosition, PointerSource, RuntimeStatus } from '../shared/types';
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

  constructor(private readonly callbacks: TrackingCallbacks) {}

  async start(video: HTMLVideoElement, settings: HandFreeSettings, deviceId?: string): Promise<void> {
    if (this.running || this.engineState === 'STARTING' || this.engineState === 'READY' || this.engineState === 'RUNNING' || this.engineState === 'PAUSED' || this.camera.currentStream) return;
    const token = ++this.runToken;
    this.engineState = 'STARTING';
    this.activeSettings = settings;
    this.lastVideoTime = -1;
    this.handStableFrames = 0;
    this.callbacks.onStatus({ engineState: 'STARTING', pointerSource: this.pointerSource(settings), permission: 'prompt', trackingPhase: 'camera-ready', error: undefined });
    try {
      await this.camera.start(video, deviceId);
      if (token !== this.runToken) return;
      this.engineState = 'READY';
      this.callbacks.onStatus({ engineState: 'READY', permission: 'active', trackingPhase: 'camera-ready', error: undefined });
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
    this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), trackingPhase: 'tracking', handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle' });
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
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.landmarker.close();
    this.handLandmarker.close();
    this.engineState = 'STARTING';
    this.callbacks.onStatus({ engineState: 'STARTING', pointerSource: this.pointerSource(settings), permission: 'active', trackingPhase: 'camera-ready', error: undefined, faceDetected: false, confidence: 0, handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle', handConfidence: 0 });
    await this.loadModels(video, settings);
    if (token !== this.runToken) return;
    this.running = true;
    this.engineState = 'RUNNING';
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.handPointer = { x: .5, y: .5 };
    this.callbacks.onStatus({ engineState: 'RUNNING', pointerSource: this.pointerSource(settings), trackingPhase: 'tracking' });
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
    this.callbacks.onStatus({ engineState: 'PAUSED', permission: 'paused', trackingPhase: 'paused' });
  }
  resume(video: HTMLVideoElement): void {
    if (!this.camera.currentStream) return;
    this.camera.resume(video);
    this.engineState = 'RUNNING';
    this.lostFrames = 0;
    this.handStableFrames = 0;
    this.callbacks.onStatus({ engineState: 'RUNNING', permission: 'active', trackingPhase: 'tracking' });
  }

  stop(video: HTMLVideoElement): void {
    if (this.engineState === 'STOPPED' && !this.camera.currentStream) return;
    this.engineState = 'STOPPING';
    this.runToken += 1;
    this.running = false;
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.landmarker.close();
    this.handLandmarker.close();
    this.activeSettings = null;
    this.handPointer = { x: .5, y: .5 };
    this.mapper.reset();
    this.engineState = 'STOPPED';
    this.callbacks.onStatus({ engineState: 'STOPPED', pointerSource: 'none', permission: 'stopped', trackingPhase: 'idle', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0 });
  }

  recenter(): void { this.mapper.reset(true); }
  destroy(video: HTMLVideoElement): void { this.stop(video); }

  private cleanupAfterStartFailure(video: HTMLVideoElement): void {
    this.engineState = 'ERROR';
    this.runToken += 1;
    this.running = false;
    if (this.raf !== undefined) clearTimeout(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.landmarker.close();
    this.handLandmarker.close();
    this.mapper.reset();
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
    let sample: ReturnType<FaceLandmarkerAdapter['detect']> = null;
    let handSample: ReturnType<HandLandmarkerAdapter['detect']> = null;
    try {
      sample = settings.enabledModes.includes('head') ? this.landmarker.detect(video, now) : null;
      handSample = settings.enabledModes.includes('hand') ? this.handLandmarker.detect(video, now) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const problem = diagnostic('MODEL_LOAD_FAILED', 'tracking.models');
      this.cleanupAfterStartFailure(video);
      this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'error', error: `${problem.explanation} ${message}`, diagnostic: problem });
      this.engineState = 'ERROR';
      return;
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
          if (calibrationValid) this.callbacks.onPointer(pointer);
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
        if (calibrationValid && mapped && this.handStableFrames > 5) this.callbacks.onHand({ x: Math.max(0.01, Math.min(0.99, 0.5 + (mapped.x - 0.5) * handSensitivity)), y: Math.max(0.01, Math.min(0.99, 0.5 + (mapped.y - 0.5) * handSensitivity)), confidence: hand.confidence, source: 'hand-tracking' }, hand.gesture);
      }
    }
  }

  private pointerSource(settings: HandFreeSettings): PointerSource {
    if (settings.enabledModes.includes('hand')) return settings.touchViewEnabled ? 'touchview-hand' : 'hand';
    if (settings.enabledModes.includes('head') || settings.headControlEnabled) return 'head';
    return 'none';
  }
}
