import type { HandGesture } from '../shared/types';

export type TouchViewGestureState = 'IDLE' | 'HOVERING' | 'ACTIVATION_CANDIDATE' | 'ACTIVATED' | 'RELEASE_WAIT' | 'COOLDOWN';
export type TouchViewActivationMethod = 'pinch' | 'stable-hold';

export interface TouchViewGestureInput {
  targetKey: string | null;
  gesture: HandGesture;
  confidence: number;
  now: number;
}

export interface TouchViewGestureEvent {
  type: 'target-hovered' | 'pinch-started' | 'hold-started' | 'hold-cancelled' | 'activation-rejected' | 'activated' | 'hand-lost';
  method?: TouchViewActivationMethod;
  duration?: number;
}

export class TouchViewGestureMachine {
  state: TouchViewGestureState = 'IDLE';
  targetKey: string | null = null;
  candidateMethod: TouchViewActivationMethod | null = null;
  candidateStartedAt = 0;
  cooldownUntil = 0;
  private pinchArmed = true;
  private stableHoldActivated = false;
  private readonly confidenceThreshold: number;

  constructor(private holdDuration: number, private cooldownDuration: number, private stableHoldEnabled: boolean, confidenceThreshold = 0.55) {
    this.confidenceThreshold = confidenceThreshold;
  }

  configure(holdDuration: number, cooldownDuration: number, stableHoldEnabled: boolean): void {
    const armed = this.pinchArmed;
    const cooldownUntil = this.cooldownUntil;
    this.holdDuration = holdDuration;
    this.cooldownDuration = cooldownDuration;
    this.stableHoldEnabled = stableHoldEnabled;
    this.reset();
    this.pinchArmed = armed;
    this.cooldownUntil = cooldownUntil;
  }

  update(input: TouchViewGestureInput): { events: TouchViewGestureEvent[]; activate: boolean } {
    const events: TouchViewGestureEvent[] = [];
    if (input.gesture !== 'pinch' && input.confidence >= this.confidenceThreshold) { this.release(input.now); this.pinchArmed = true; }
    const lost = input.confidence < this.confidenceThreshold || !input.targetKey;
    if (lost) {
      if (input.gesture === 'pinch') this.pinchArmed = false;
      if (this.state === 'ACTIVATION_CANDIDATE') events.push({ type: 'hold-cancelled', method: this.candidateMethod ?? undefined, duration: input.now - this.candidateStartedAt });
      if (this.state !== 'IDLE') events.push({ type: 'hand-lost' });
      this.state = 'IDLE';
      this.targetKey = null;
      this.candidateMethod = null;
      return { events, activate: false };
    }

    if (input.targetKey !== this.targetKey) {
      if (this.state === 'ACTIVATION_CANDIDATE' && this.candidateMethod === 'pinch' && input.gesture === 'pinch') this.pinchArmed = false;
      if (this.state === 'ACTIVATION_CANDIDATE') events.push({ type: 'hold-cancelled', method: this.candidateMethod ?? undefined, duration: input.now - this.candidateStartedAt });
      this.targetKey = input.targetKey;
      this.candidateMethod = null;
      this.stableHoldActivated = false;
      this.state = input.now < this.cooldownUntil ? 'COOLDOWN' : 'IDLE';
      events.push({ type: 'target-hovered' });
    }

    if (this.state === 'COOLDOWN') {
      if (input.now < this.cooldownUntil) return { events, activate: false };
      this.state = 'HOVERING';
    }

    if (this.state === 'IDLE') this.state = 'HOVERING';

    if (this.state === 'HOVERING') {
      if (input.gesture === 'pinch' && this.pinchArmed) {
        this.state = 'ACTIVATION_CANDIDATE';
        this.candidateMethod = 'pinch';
        this.candidateStartedAt = input.now;
        events.push({ type: 'pinch-started' });
      } else if (input.gesture !== 'pinch' && this.stableHoldEnabled && !this.stableHoldActivated) {
        this.state = 'ACTIVATION_CANDIDATE';
        this.candidateMethod = 'stable-hold';
        this.candidateStartedAt = input.now;
        events.push({ type: 'hold-started' });
      }
    }

    if (this.state !== 'ACTIVATION_CANDIDATE') return { events, activate: false };
    if (this.candidateMethod === 'pinch' && input.gesture !== 'pinch') {
      events.push({ type: 'hold-cancelled', method: 'pinch', duration: input.now - this.candidateStartedAt });
      this.state = 'HOVERING';
      this.candidateMethod = null;
      return { events, activate: false };
    }
    if (this.candidateMethod === 'stable-hold' && input.gesture === 'pinch') {
      events.push({ type: 'hold-cancelled', method: 'stable-hold', duration: input.now - this.candidateStartedAt });
      this.state = 'HOVERING';
      this.candidateMethod = null;
      return { events, activate: false };
    }
    if (input.now - this.candidateStartedAt < this.holdDuration) return { events, activate: false };

    const method = this.candidateMethod ?? 'stable-hold';
    this.state = method === 'pinch' ? 'RELEASE_WAIT' : 'ACTIVATED';
    this.cooldownUntil = input.now + this.cooldownDuration;
    this.pinchArmed = false;
    this.stableHoldActivated = method === 'stable-hold';
    events.push({ type: 'activated', method, duration: input.now - this.candidateStartedAt });
    return { events, activate: true };
  }

  release(now: number): void {
    if (this.state === 'RELEASE_WAIT' || (this.state === 'ACTIVATED' && !this.stableHoldActivated)) {
      this.pinchArmed = true;
      this.state = 'COOLDOWN';
      this.cooldownUntil = Math.max(this.cooldownUntil, now + this.cooldownDuration);
    }
  }

  progress(now: number): number {
    if (this.state !== 'ACTIVATION_CANDIDATE') return 0;
    return Math.max(0, Math.min(1, (now - this.candidateStartedAt) / this.holdDuration));
  }

  reset(): void {
    this.state = 'IDLE';
    this.targetKey = null;
    this.candidateMethod = null;
    this.candidateStartedAt = 0;
    this.cooldownUntil = 0;
    this.pinchArmed = true;
    this.stableHoldActivated = false;
  }
}
