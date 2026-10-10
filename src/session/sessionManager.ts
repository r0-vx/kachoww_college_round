import type { CameraConsumer, HandFreeSettings, RuntimeStatus } from '../shared/types';
import { TrackingController, type TrackingCallbacks } from '../tracking/trackingController';

/** Single camera and MediaPipe owner used by the extension control center. */
export class SessionManager extends TrackingController {
  private readonly consumers = new Set<CameraConsumer>();
  private readonly listeners = new Set<(snapshot: Partial<RuntimeStatus>) => void>();

  constructor(callbacks: TrackingCallbacks) {
    super(callbacks);
  }

  acquire(consumer: CameraConsumer): void {
    this.consumers.add(consumer);
    this.publishConsumers();
  }

  release(consumer: CameraConsumer): void {
    this.consumers.delete(consumer);
    this.publishConsumers();
  }

  clearConsumers(): void {
    this.consumers.clear();
    this.publishConsumers();
  }

  get activeConsumers(): CameraConsumer[] {
    return [...this.consumers];
  }

  getSnapshot(): Pick<RuntimeStatus, 'cameraState' | 'trackingState' | 'activeCameraConsumers' | 'activeFaceLoops' | 'activeHandLoops' | 'activePointerLoops'> {
    const active = Boolean(this.camera.currentStream);
    const paused = this.camera.currentState === 'paused';
    return {
      cameraState: active ? paused ? 'paused' : 'active' : 'stopped',
      trackingState: active ? paused ? 'paused' : 'tracking' : 'idle',
      activeCameraConsumers: this.activeConsumers,
      activeFaceLoops: active ? 1 : 0,
      activeHandLoops: active ? 1 : 0,
      activePointerLoops: active ? 1 : 0
    };
  }

  async startCamera(video: HTMLVideoElement, settings: HandFreeSettings, deviceId?: string): Promise<void> {
    this.acquire('dashboard');
    await this.start(video, settings, deviceId);
    this.publishSnapshot();
  }

  stopCamera(video: HTMLVideoElement, explicit = false): void {
    if (!explicit && this.consumers.size > 1) {
      this.release('dashboard');
      return;
    }
    this.clearConsumers();
    this.stop(video);
    this.publishSnapshot();
  }

  startTouchView(): void { this.acquire('touchview'); }
  stopTouchView(): void { this.release('touchview'); }

  async startFaceTracking(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    await this.restart(video, { ...settings, enabledModes: Array.from(new Set([...settings.enabledModes, 'head' as const])) });
    this.acquire('head');
  }

  async startHandTracking(video: HTMLVideoElement, settings: HandFreeSettings): Promise<void> {
    await this.restart(video, { ...settings, enabledModes: Array.from(new Set([...settings.enabledModes, 'hand' as const])) });
    this.acquire('hand');
  }

  stopFaceTracking(): void { this.release('head'); }
  stopHandTracking(): void { this.release('hand'); }
  pauseTracking(video: HTMLVideoElement): void { this.pause(video); }
  resumeTracking(video: HTMLVideoElement): void { this.resume(video); }

  subscribe(listener: (snapshot: Partial<RuntimeStatus>) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private publishConsumers(): void {
    this.callbacks.onStatus({ activeCameraConsumers: this.activeConsumers });
    this.publishSnapshot();
  }

  private publishSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
