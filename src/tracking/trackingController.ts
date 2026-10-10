import type { HandFreeSettings, HandPointerPosition, RuntimeStatus } from '../shared/types';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CameraManager } from './cameraManager';
import { CalibrationSession } from './calibration';
import { FaceLandmarkerAdapter } from './faceLandmarker';
import { HandLandmarkerAdapter, interpretHand, type HandPointerCoordinates } from './handLandmarker';
import { HeadMapper, relativeHeadPosition, type RelativeHeadPosition } from './headMapper';

export interface TrackingCallbacks {
  onStatus: (status: Partial<RuntimeStatus>) => void;
  onPointer: (position: ReturnType<HeadMapper['map']>) => void;
  onPosition: (position: RelativeHeadPosition) => void;
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
  private lostFrames = 0;
  private stableFrames = 0;
  private running = false;
  private handPointer: HandPointerCoordinates = { x: .5, y: .5 };

  constructor(private readonly callbacks: TrackingCallbacks) {}

  async start(video: HTMLVideoElement, settings: HandFreeSettings, deviceId?: string): Promise<void> {
    await this.camera.start(video, deviceId);
    this.callbacks.onStatus({ permission: 'active', trackingPhase: 'camera-ready', error: undefined });
    await this.loadModels(video, settings);
    this.running = true;
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.handPointer = { x: .5, y: .5 };
    this.callbacks.onStatus({ trackingPhase: 'tracking', handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle' });
    this.loop(video, settings);
  }

  async restart(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    if (!this.camera.currentStream) {
      await this.start(video, settings);
      return;
    }
    this.running = false;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.landmarker.close();
    this.handLandmarker.close();
    this.callbacks.onStatus({ permission: 'active', trackingPhase: 'camera-ready', error: undefined, faceDetected: false, confidence: 0, handTracking: settings.enabledModes.includes('hand') ? 'lost' : 'idle', handConfidence: 0 });
    await this.loadModels(video, settings);
    this.running = true;
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.handPointer = { x: .5, y: .5 };
    this.callbacks.onStatus({ trackingPhase: 'tracking' });
    this.loop(video, settings);
  }

  private async loadModels(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    try {
      if (settings.enabledModes.includes('head')) await this.landmarker.load((phase) => this.callbacks.onStatus({ trackingPhase: phase === 'ready' ? 'camera-ready' : phase }));
      if (settings.enabledModes.includes('hand')) await this.handLandmarker.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.cleanupAfterStartFailure(video);
      this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'error', error: `Camera opened, but tracking could not start. ${message}` });
      throw new Error(`Camera opened, but tracking could not start. ${message}`);
    }
  }

  pause(video: HTMLVideoElement): void { this.camera.pause(video); this.callbacks.onStatus({ permission: 'paused', trackingPhase: 'paused' }); }
  resume(video: HTMLVideoElement): void { this.camera.resume(video); this.callbacks.onStatus({ permission: 'active', trackingPhase: 'tracking' }); }

  stop(video: HTMLVideoElement): void {
    this.running = false;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.landmarker.close();
    this.handLandmarker.close();
    this.handPointer = { x: .5, y: .5 };
    this.mapper.reset();
    this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'idle', faceDetected: false, confidence: 0, handTracking: 'idle', handConfidence: 0 });
  }

  recenter(): void { this.mapper.reset(); }
  destroy(video: HTMLVideoElement): void { this.stop(video); }

  private cleanupAfterStartFailure(video: HTMLVideoElement): void {
    this.running = false;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.landmarker.close();
    this.handLandmarker.close();
    this.mapper.reset();
  }

  private loop(video: HTMLVideoElement, settings: HandFreeSettings): void {
    if (!this.running) return;
    const now = performance.now();
    let sample: ReturnType<FaceLandmarkerAdapter['detect']> = null;
    let handSample: ReturnType<HandLandmarkerAdapter['detect']> = null;
    try {
      sample = settings.enabledModes.includes('head') ? this.landmarker.detect(video, now) : null;
      handSample = settings.enabledModes.includes('hand') ? this.handLandmarker.detect(video, now) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.cleanupAfterStartFailure(video);
      this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'error', error: `Tracking stopped because MediaPipe raised an error. ${message}` });
      return;
    }
    this.callbacks.onLandmarks({ face: sample?.landmarks ?? null, hand: handSample?.landmarks ?? null, headEnabled: settings.enabledModes.includes('head'), handEnabled: settings.enabledModes.includes('hand') });
    if (settings.enabledModes.includes('head')) {
      if (!sample) {
        this.lostFrames += 1;
        this.stableFrames = 0;
        this.callbacks.onStatus({ trackingPhase: this.lostFrames > 12 ? 'lost' : 'face-not-detected', faceDetected: false, confidence: 0 });
      } else {
        this.lostFrames = 0;
        this.stableFrames += 1;
        const position = relativeHeadPosition(sample);
        this.callbacks.onPosition(position);
        if (this.stableFrames > 8) {
          const pointer = this.mapper.map(position, settings.calibration, settings.sensitivity, settings.smoothing, settings.deadZone, sample.confidence);
          this.callbacks.onStatus({ trackingPhase: 'tracking', faceDetected: true, confidence: sample.confidence });
          this.callbacks.onPointer(pointer);
        } else this.callbacks.onStatus({ trackingPhase: 'reinitializing', faceDetected: true, confidence: sample.confidence });
      }
    }
    if (settings.enabledModes.includes('hand')) {
      if (!handSample) this.callbacks.onStatus({ handTracking: 'lost', handConfidence: 0 });
      else {
        const hand = interpretHand(handSample, settings.pinchThreshold, settings.handSensitivity, this.handPointer);
        this.handPointer = { x: hand.x, y: hand.y };
        this.callbacks.onStatus({ handTracking: 'tracking', handConfidence: hand.confidence });
        this.callbacks.onHand({ x: hand.x, y: hand.y, confidence: hand.confidence, source: 'hand-tracking' }, hand.gesture);
      }
    }
    this.raf = requestAnimationFrame(() => this.loop(video, settings));
  }
}
