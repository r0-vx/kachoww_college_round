import type { CalibrationData } from '../shared/types';
import type { RelativeHeadPosition } from './headMapper';

export type CalibrationStep = 'neutral' | 'left' | 'right' | 'up' | 'down' | 'target' | 'complete';

export class CalibrationSession {
  private samples: Partial<Record<CalibrationStep, RelativeHeadPosition>> = {};
  step: CalibrationStep = 'neutral';

  capture(position: RelativeHeadPosition): CalibrationStep {
    this.samples[this.step] = position;
    const next: Record<CalibrationStep, CalibrationStep> = { neutral: 'left', left: 'right', right: 'up', up: 'down', down: 'target', target: 'complete', complete: 'complete' };
    this.step = next[this.step];
    return this.step;
  }

  save(): CalibrationData | null {
    const neutral = this.samples.neutral;
    const left = this.samples.left;
    const right = this.samples.right;
    const up = this.samples.up;
    const down = this.samples.down;
    if (!neutral || !left || !right || !up || !down) return null;
    return { neutral, rangeX: { min: left.x - neutral.x, max: right.x - neutral.x }, rangeY: { min: up.y - neutral.y, max: down.y - neutral.y }, createdAt: Date.now() };
  }

  reset(): void { this.samples = {}; this.step = 'neutral'; }
}
