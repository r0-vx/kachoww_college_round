import type { TargetInfo } from '../shared/types';

export interface DwellCallbacks {
  onStart: (target: TargetInfo, duration: number) => void;
  onProgress: (progress: number) => void;
  onCancel: (reason: string) => void;
  onComplete: (target: TargetInfo) => void;
}

export class DwellController {
  private timer: number | undefined;
  private startedAt = 0;
  private target: { element: HTMLElement; info: TargetInfo } | null = null;
  private completedForElement: HTMLElement | null = null;
  private frame: number | undefined;

  constructor(private readonly callbacks: DwellCallbacks) {}

  updateTarget(target: { element: HTMLElement; info: TargetInfo } | null, duration: number, enabled: boolean): void {
    if (!enabled || !target) {
      this.cancel(enabled ? 'No interactive target' : 'Dwell disabled');
      this.target = null;
      return;
    }
    if (this.target?.element === target.element) return;
    this.cancel('Target changed');
    this.target = target;
    if (this.completedForElement === target.element) return;
    this.startedAt = performance.now();
    this.callbacks.onStart(target.info, duration);
    this.timer = window.setTimeout(() => {
      this.callbacks.onProgress(1);
      this.callbacks.onComplete(target.info);
      this.completedForElement = target.element;
      this.timer = undefined;
      this.stopFrame();
    }, duration);
    this.frame = requestAnimationFrame(() => this.tick(duration));
  }

  resetCompletion(): void {
    this.completedForElement = null;
  }

  cancel(reason: string): void {
    if (this.timer !== undefined || this.target) this.callbacks.onCancel(reason);
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.target = null;
    this.stopFrame();
  }

  destroy(): void {
    this.cancel('Pointer stopped');
  }

  private tick(duration: number): void {
    if (this.timer === undefined) return;
    this.callbacks.onProgress(Math.min(1, (performance.now() - this.startedAt) / duration));
    this.frame = requestAnimationFrame(() => this.tick(duration));
  }

  private stopFrame(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
}
