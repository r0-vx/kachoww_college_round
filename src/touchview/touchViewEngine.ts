import type { HandGesture, TargetInfo } from '../shared/types';
import { findTargetAt } from '../content/targetDetector';
import { TouchViewGestureMachine, type TouchViewGestureEvent, type TouchViewGestureState } from './touchViewGesture';

export interface TouchViewEngineEvent extends TouchViewGestureEvent {
  target?: TargetInfo;
  state: TouchViewGestureState;
}

export interface TouchViewEngineOptions {
  holdDuration: number;
  cooldownDuration: number;
  stableHoldEnabled: boolean;
  cursorSize: number;
  cursorColor: string;
  feedbackEnabled: boolean;
  onEvent?: (event: TouchViewEngineEvent) => void;
  onTarget?: (target: TargetInfo | null) => void;
}

const clamp = (value: number): number => Math.max(0.01, Math.min(0.99, value));

export class TouchViewEngine {
  private readonly cursor: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly machine: TouchViewGestureMachine;
  private readonly targetIds = new WeakMap<HTMLElement, string>();
  private nextTargetId = 1;
  private target: { element: HTMLElement; info: TargetInfo } | null = null;
  private paused = false;
  private active = true;
  private lastPosition = { x: 0.5, y: 0.5 };
  private options: TouchViewEngineOptions;

  constructor(options: TouchViewEngineOptions) {
    this.options = options;
    this.machine = new TouchViewGestureMachine(options.holdDuration, options.cooldownDuration, options.stableHoldEnabled);
    this.cursor = document.createElement('div');
    this.cursor.className = 'touchview-cursor';
    this.cursor.setAttribute('aria-hidden', 'true');
    this.progress = document.createElement('div');
    this.progress.className = 'touchview-cursor__progress';
    this.label = document.createElement('div');
    this.label.className = 'touchview-cursor__label';
    this.cursor.append(this.progress, this.label);
    document.body.appendChild(this.cursor);
    this.applyOptions();
  }

  setOptions(options: TouchViewEngineOptions): void {
    this.options = { ...this.options, ...options };
    this.machine.configure(options.holdDuration, options.cooldownDuration, options.stableHoldEnabled);
    this.applyOptions();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clearTarget('activation-rejected');
    this.cursor.dataset.active = active ? 'true' : 'false';
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.cursor.dataset.paused = paused ? 'true' : 'false';
    if (paused) this.clearTarget('activation-rejected');
  }

  update(position: { x: number; y: number }, gesture: HandGesture, confidence: number, now = performance.now()): void {
    if (!this.active) return;
    this.lastPosition = { x: clamp(position.x), y: clamp(position.y) };
    const x = this.lastPosition.x * window.innerWidth;
    const y = this.lastPosition.y * window.innerHeight;
    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (this.paused) return;
    const nextTarget = confidence >= 0.55 ? findTargetAt(x, y) : null;
    if (nextTarget?.element !== this.target?.element) {
      this.target?.element.classList.remove('touchview-target');
      this.target = nextTarget;
      this.target?.element.classList.add('touchview-target');
      this.label.textContent = this.target?.info.accessibleName ?? '';
      this.options.onTarget?.(this.target?.info ?? null);
    }
    if (this.machine.state === 'RELEASE_WAIT' && gesture !== 'pinch') this.machine.release(now);
    const result = this.machine.update({ targetKey: this.target ? this.targetId(this.target.element) : null, gesture, confidence, now });
    this.progress.style.setProperty('--touchview-progress', String(this.machine.progress(now)));
    this.cursor.dataset.state = this.machine.state.toLowerCase();
    for (const event of result.events) {
      const enriched: TouchViewEngineEvent = { ...event, state: this.machine.state, target: this.target?.info };
      this.options.onEvent?.(enriched);
    }
    if (result.activate && this.target) {
      this.target.element.click();
      if (this.options.feedbackEnabled) this.ripple(x, y);
    }
  }

  handLost(): void {
    if (!this.active) return;
    this.machine.update({ targetKey: null, gesture: 'none', confidence: 0, now: performance.now() });
    this.cursor.dataset.state = 'idle';
    this.clearTarget();
  }

  reset(): void {
    this.machine.reset();
    this.clearTarget('activation-rejected');
    this.progress.style.setProperty('--touchview-progress', '0');
  }

  destroy(): void {
    this.clearTarget('activation-rejected');
    this.cursor.remove();
  }

  private clearTarget(eventType?: TouchViewGestureEvent['type']): void {
    this.target?.element.classList.remove('touchview-target');
    this.target = null;
    this.label.textContent = '';
    this.options.onTarget?.(null);
    if (eventType) this.options.onEvent?.({ type: eventType, state: this.machine.state });
  }

  private ripple(x: number, y: number): void {
    const ripple = document.createElement('div');
    ripple.className = 'touchview-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.body.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 650);
  }

  private targetId(element: HTMLElement): string {
    const existing = this.targetIds.get(element);
    if (existing) return existing;
    const id = `touchview-target-${this.nextTargetId++}`;
    this.targetIds.set(element, id);
    return id;
  }

  private applyOptions(): void {
    this.cursor.style.setProperty('--touchview-cursor-size', `${Math.max(18, Math.min(64, this.options.cursorSize))}px`);
    this.cursor.dataset.color = this.options.cursorColor;
    this.cursor.dataset.active = this.active ? 'true' : 'false';
  }
}
