export class CameraThumbnail {
  private canvas: HTMLCanvasElement | undefined;
  private lastAttempt = -Infinity;
  private lastVideoTime = -1;

  constructor(private readonly createCanvas = () => document.createElement('canvas')) {}

  frame(video: HTMLVideoElement | null, now = performance.now()): string | undefined {
    if (!video || video.readyState < 2 || video.paused || !video.videoWidth || !video.videoHeight || now - this.lastAttempt < 200 || video.currentTime === this.lastVideoTime) return;
    this.lastAttempt = now;
    this.lastVideoTime = video.currentTime;
    try {
      const canvas = this.canvas ??= this.createCanvas();
      if (canvas.width !== 320) canvas.width = 320;
      if (canvas.height !== 180) canvas.height = 180;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, 320, 180);
      return canvas.toDataURL('image/jpeg', .6);
    } catch {
      // A thumbnail failure must never interrupt pointer delivery.
      return undefined;
    }
  }

  reset(): void { this.lastAttempt = -Infinity; this.lastVideoTime = -1; }
}
