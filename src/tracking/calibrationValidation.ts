import { CALIBRATION_TARGETS, type CoordinatePoint } from './coordinateMapping';

export const CALIBRATION_TEST_POINTS: CoordinatePoint[] = [
  CALIBRATION_TARGETS['top-left'],
  CALIBRATION_TARGETS['top-right'],
  { x: .5, y: .5 },
  CALIBRATION_TARGETS['bottom-left'],
  CALIBRATION_TARGETS['bottom-right']
];
export const CALIBRATION_TEST_LABELS = ['Top-left', 'Top-right', 'Center', 'Bottom-left', 'Bottom-right'] as const;
export const CALIBRATION_TOLERANCE = .065;
export const CALIBRATION_HOLD_DURATION = 700;

export interface CalibrationValidationSnapshot {
  completed: number;
  total: number;
  position: number;
  target: CoordinatePoint | null;
  error: number;
  threshold: number;
  progress: number;
  confidence: number;
  averageError: number;
  maximumError: number;
  quality: number;
  valid: boolean;
  state: 'waiting' | 'outside-target' | 'holding' | 'complete';
}

export class CalibrationValidation {
  completed = 0;
  readonly errors: number[] = [];
  lastError = 1;
  lastConfidence = 0;
  private enteredAt: number | null = null;
  private lastFrame = 0;
  update(point: CoordinatePoint, confidence: number, now: number): CalibrationValidationSnapshot {
    const target = CALIBRATION_TEST_POINTS[this.completed];
    if (!target) return this.snapshot();
    const error = Math.hypot(point.x - target.x, point.y - target.y);
    this.lastError = error;
    this.lastConfidence = confidence;
    if (confidence < .55 || now - this.lastFrame > 250 || error > CALIBRATION_TOLERANCE) this.enteredAt = null;
    this.lastFrame = now;
    if (confidence < .55 || error > CALIBRATION_TOLERANCE) return this.snapshot();
    this.enteredAt ??= now;
    if (now - this.enteredAt >= CALIBRATION_HOLD_DURATION) { this.errors.push(error); this.completed++; this.enteredAt = null; }
    return this.snapshot();
  }
  get valid(): boolean { return this.completed === CALIBRATION_TEST_POINTS.length && this.errors.length === CALIBRATION_TEST_POINTS.length; }
  get averageError(): number { return this.errors.length ? this.errors.reduce((sum, error) => sum + error, 0) / this.errors.length : 0; }
  get maximumError(): number { return this.errors.length ? Math.max(...this.errors) : 0; }
  get progress(): number { return this.enteredAt === null ? 0 : Math.max(0, Math.min(1, (this.lastFrame - this.enteredAt) / CALIBRATION_HOLD_DURATION)); }
  get quality(): number { return this.errors.length ? Math.max(0, 1 - this.averageError / CALIBRATION_TOLERANCE) : 0; }
  snapshot(): CalibrationValidationSnapshot {
    const target = CALIBRATION_TEST_POINTS[this.completed] ?? null;
    const valid = this.valid;
    return {
      completed: this.completed,
      total: CALIBRATION_TEST_POINTS.length,
      position: Math.min(this.completed + 1, CALIBRATION_TEST_POINTS.length),
      target,
      error: this.lastError,
      threshold: CALIBRATION_TOLERANCE,
      progress: valid ? 1 : this.progress,
      confidence: this.lastConfidence,
      averageError: this.averageError,
      maximumError: this.maximumError,
      quality: this.quality,
      valid,
      state: valid ? 'complete' : this.lastConfidence < .55 ? 'waiting' : this.lastError > CALIBRATION_TOLERANCE ? 'outside-target' : this.progress > 0 ? 'holding' : 'waiting'
    };
  }
}
