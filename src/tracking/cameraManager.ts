import type { PermissionState } from '../shared/types';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export type CameraState = 'idle' | 'requesting' | 'active' | 'paused' | 'stopped' | 'denied' | 'unavailable' | 'error';

export class CameraManager {
  private stream: MediaStream | null = null;
  private deviceId?: string;
  private state: CameraState = 'idle';

  async listCameras(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
  }

  get currentState(): CameraState { return this.state; }
  get currentStream(): MediaStream | null { return this.stream; }
  get currentDeviceId(): string | undefined { return this.deviceId; }

  async start(video: HTMLVideoElement, deviceId?: string): Promise<{ permission: PermissionState; cameras: CameraDevice[] }> {
    if (this.stream) return { permission: 'active', cameras: await this.listCameras() };
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = 'unavailable';
      throw new Error('Camera access is not available in this browser context.');
    }
    this.state = 'requesting';
    this.deviceId = deviceId;
    try {
      // 640x360 keeps the preview responsive while leaving headroom for two
      // MediaPipe VIDEO inferences and pointer delivery on ordinary laptops.
      // The browser may still choose a higher native mode for a selected
      // device; diagnostics report the actual track dimensions.
      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } }
        : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
      this.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      this.deviceId = this.stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
      video.srcObject = this.stream;
      video.muted = true;
      await video.play();
      this.state = 'active';
      return { permission: 'active', cameras: await this.listCameras() };
    } catch (error) {
      this.state = error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'error';
      this.stop(video);
      throw error instanceof Error ? error : new Error('Unable to start camera.');
    }
  }

  pause(video: HTMLVideoElement): void {
    if (!this.stream) return;
    video.pause();
    this.state = 'paused';
  }

  resume(video: HTMLVideoElement): void {
    if (!this.stream) return;
    void video.play();
    this.state = 'active';
  }

  stop(video: HTMLVideoElement): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    video.pause();
    video.srcObject = null;
    this.state = 'stopped';
  }
}
