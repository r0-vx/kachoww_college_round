import type { HandFreeSettings, RuntimeStatus } from '../shared/types';
import { CameraManager } from './cameraManager';
import { CalibrationSession } from './calibration';
import { FaceLandmarkerAdapter } from './faceLandmarker';
import { HeadMapper, relativeHeadPosition, type RelativeHeadPosition } from './headMapper';

export interface TrackingCallbacks {
  onStatus: (status: Partial<RuntimeStatus>) => void;
  onPointer: (position: ReturnType<HeadMapper['map']>) => void;
  onPosition: (position: RelativeHeadPosition) => void;
}

export class TrackingController {
  readonly camera = new CameraManager();
  readonly calibration = new CalibrationSession();
  private readonly landmarker = new FaceLandmarkerAdapter();
  private readonly mapper = new HeadMapper();
  private raf: number | undefined;
  private lostFrames = 0;
  private stableFrames = 0;
  private running = false;

  constructor(private readonly callbacks: TrackingCallbacks) {}

  async start(video: HTMLVideoElement, settings: HandFreeSettings, deviceId?: string): Promise<void> {
    await this.camera.start(video, deviceId);
    this.callbacks.onStatus({ permission: 'active', trackingPhase: 'camera-ready', error: undefined });
    await this.landmarker.load((phase) => this.callbacks.onStatus({ trackingPhase: phase === 'ready' ? 'camera-ready' : phase }));
    this.running = true;
    this.lostFrames = 0;
    this.stableFrames = 0;
    this.callbacks.onStatus({ trackingPhase: 'tracking' });
    this.loop(video, settings);
  }

  pause(video: HTMLVideoElement): void {
    this.camera.pause(video);
    this.callbacks.onStatus({ permission: 'paused', trackingPhase: 'paused' });
  }

  resume(video: HTMLVideoElement): void {
    this.camera.resume(video);
    this.callbacks.onStatus({ permission: 'active', trackingPhase: 'tracking' });
  }

  stop(video: HTMLVideoElement): void {
    this.running = false;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.camera.stop(video);
    this.landmarker.close();
    this.mapper.reset();
    this.callbacks.onStatus({ permission: 'stopped', trackingPhase: 'idle', faceDetected: false, confidence: 0 });
  }

  recenter(): void { this.mapper.reset(); }

  destroy(video: HTMLVideoElement): void { this.stop(video); }

  private loop(video: HTMLVideoElement, settings: HandFreeSettings): void {
    if (!this.running) return;
    const sample = this.landmarker.detect(video, performance.now());
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
      } else {
        this.callbacks.onStatus({ trackingPhase: 'reinitializing', faceDetected: true, confidence: sample.confidence });
      }
    }
    this.raf = requestAnimationFrame(() => this.loop(video, settings));
  }
}
