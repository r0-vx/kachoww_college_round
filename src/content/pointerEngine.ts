import type { HandFreeMessage, HandFreeSettings, HandPointerPosition, PointerPosition, TargetInfo } from '../shared/types';
import { DwellController } from './dwellController';
import { findTargetAt } from './targetDetector';

const STYLE_ID = 'handfree-pointer-styles';

export class PointerEngine {
  private pointer: HTMLDivElement;
  private label: HTMLDivElement;
  private progress: HTMLDivElement;
  private currentTarget: HTMLElement | null = null;
  private currentPosition = { x: 0.5, y: 0.5 };
  private enabled = false;
  private paused = false;
  private settings: HandFreeSettings;
  private dwell: DwellController;
  private cooldownUntil = 0;

  constructor(settings: HandFreeSettings) {
    this.settings = settings;
    this.pointer = document.createElement('div');
    this.pointer.id = 'handfree-pointer';
    this.pointer.setAttribute('aria-hidden', 'true');
    this.label = document.createElement('div');
    this.label.className = 'handfree-target-label';
    this.progress = document.createElement('div');
    this.progress.className = 'handfree-dwell-progress';
    this.pointer.append(this.progress, this.label);
    document.documentElement.appendChild(this.pointer);
    this.injectStyles();
    this.dwell = new DwellController({
      onStart: (target, duration) => {
        this.progress.style.setProperty('--handfree-progress', '0');
        this.label.textContent = `Selecting ${target.accessibleName}`;
        this.pointer.dataset.dwell = 'active';
        this.emit({ type: 'DWELL_STARTED', target, duration });
      },
      onProgress: (progress) => this.progress.style.setProperty('--handfree-progress', String(progress)),
      onCancel: (reason) => {
        this.pointer.dataset.dwell = 'idle';
        this.progress.style.setProperty('--handfree-progress', '0');
        this.emit({ type: 'DWELL_CANCELLED', reason });
      },
      onComplete: (target) => {
        this.pointer.dataset.dwell = 'cooldown';
        this.cooldownUntil = performance.now() + this.settings.cooldownDuration;
        this.emit({ type: 'DWELL_COMPLETED', target });
        const found = findTargetAt(this.currentPosition.x * window.innerWidth, this.currentPosition.y * window.innerHeight);
        found?.element.click();
        window.setTimeout(() => {
          if (this.pointer.dataset.dwell === 'cooldown') this.pointer.dataset.dwell = 'idle';
        }, this.settings.cooldownDuration);
      }
    });
    this.applyVisibility();
  }

  updateSettings(settings: HandFreeSettings): void {
    this.settings = settings;
    this.enabled = settings.enabled && (settings.headControlEnabled || settings.enabledModes.includes('hand'));
    this.paused = settings.paused;
    if (!this.enabled || this.paused) this.dwell.cancel(this.paused ? 'HandFree paused' : 'Head Control disabled');
    this.applyVisibility();
  }

  move(position: PointerPosition | HandPointerPosition): void {
    if (!this.enabled || this.paused || position.confidence < 0.55 || performance.now() < this.cooldownUntil) return;
    this.currentPosition = { x: Math.max(0.01, Math.min(0.99, position.x)), y: Math.max(0.01, Math.min(0.99, position.y)) };
    const x = this.currentPosition.x * window.innerWidth;
    const y = this.currentPosition.y * window.innerHeight;
    this.pointer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const found = findTargetAt(x, y);
    if (found?.element !== this.currentTarget) {
      this.currentTarget?.classList.remove('handfree-target');
      this.currentTarget = found?.element ?? null;
      this.currentTarget?.classList.add('handfree-target');
      this.emit({ type: 'TARGET_HIGHLIGHT', target: found?.info ?? null });
    }
    this.dwell.updateTarget(found, this.settings.dwellDuration, this.settings.dwellEnabled && this.enabled && !this.paused);
  }

  recenter(): void {
    this.currentPosition = { x: 0.5, y: 0.5 };
    this.dwell.cancel('Pointer recentered');
    this.dwell.resetCompletion();
    this.pointer.style.transform = `translate3d(${window.innerWidth / 2}px, ${window.innerHeight / 2}px, 0)`;
  }

  activateCurrentTarget(): void {
    if (!this.enabled || this.paused || !this.currentTarget || performance.now() < this.cooldownUntil) return;
    if (this.currentTarget.hidden || (this.currentTarget as HTMLButtonElement).disabled || this.currentTarget.getAttribute('aria-disabled') === 'true') return;
    const target = findTargetAt(this.currentPosition.x * window.innerWidth, this.currentPosition.y * window.innerHeight);
    if (!target || target.element !== this.currentTarget) return;
    this.cooldownUntil = performance.now() + this.settings.cooldownDuration;
    this.dwell.cancel('Gesture activation');
    this.currentTarget.click();
    this.emit({ type: 'DWELL_COMPLETED', target: target.info });
  }

  cancelDwell(reason: string): void { this.dwell.cancel(reason); }

  destroy(): void {
    this.dwell.destroy();
    this.currentTarget?.classList.remove('handfree-target');
    this.pointer.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  private applyVisibility(): void {
    this.pointer.dataset.visible = this.enabled ? 'true' : 'false';
    this.pointer.dataset.paused = this.paused ? 'true' : 'false';
  }

  private emit(message: HandFreeMessage): void {
    try { void chrome.runtime.sendMessage(message); } catch { /* content scripts can outlive the service worker */ }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #handfree-pointer{position:fixed;z-index:2147483647;width:26px;height:26px;margin:-13px 0 0 -13px;border:3px solid #7dd3fc;border-radius:50%;background:rgba(8,47,73,.82);box-shadow:0 0 0 4px rgba(125,211,252,.22),0 4px 18px rgba(0,0,0,.34);pointer-events:none;transform:translate3d(50vw,50vh,0);transition:opacity .18s ease;opacity:0}#handfree-pointer[data-visible="true"]{opacity:1}#handfree-pointer[data-paused="true"]{border-color:#fbbf24;background:rgba(120,53,15,.9)}#handfree-pointer[data-dwell="active"]{border-color:#4ade80}.handfree-dwell-progress{position:absolute;inset:-7px;border:3px solid transparent;border-top-color:#4ade80;border-right-color:#4ade80;border-radius:50%;transform:rotate(-45deg);clip-path:polygon(50% 50%,50% 0%,100% 0%,100% calc(var(--handfree-progress,0) * 100%),50% 50%)}.handfree-target{outline:3px solid #7dd3fc!important;outline-offset:3px!important}.handfree-target-label{position:absolute;left:32px;top:-10px;white-space:nowrap;max-width:280px;padding:5px 8px;border-radius:6px;background:#07111f;color:#e0f2fe;font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif;opacity:0}.handfree-dwell-progress + .handfree-target-label{opacity:1}
      @media (prefers-reduced-motion:reduce){#handfree-pointer{transition:none}}
    `;
    document.documentElement.appendChild(style);
  }
}
