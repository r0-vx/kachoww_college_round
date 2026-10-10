import { expect, it } from 'vitest';
import { CalibrationValidation, CALIBRATION_HOLD_DURATION, CALIBRATION_TEST_LABELS, CALIBRATION_TEST_POINTS, CALIBRATION_TOLERANCE } from './calibrationValidation';
it('requires fresh stable center and all corners before accepting calibration', () => {
  const validation = new CalibrationValidation(); let now = 0;
  for (const point of CALIBRATION_TEST_POINTS) { for (let i = 0; i < 8; i++) { validation.update(point, .9, now); now += 100; } }
  expect(validation.valid).toBe(true);
  expect(validation.completed).toBe(5);
  expect(validation.snapshot().progress).toBe(1);
});
it('rejects stale, low-confidence and off-target validation samples', () => {
  const validation = new CalibrationValidation();
  validation.update({ x: .5, y: .5 }, .9, 0);
  validation.update({ x: .5, y: .5 }, .9, 500);
  validation.update({ x: .5, y: .5 }, .2, 600);
  validation.update({ x: .9, y: .9 }, .9, 700);
  expect(validation.completed).toBe(0);
});
it('reports target order, hold progress and target reset', () => {
  const validation = new CalibrationValidation();
  expect(CALIBRATION_TEST_LABELS).toEqual(['Top-left', 'Top-right', 'Center', 'Bottom-left', 'Bottom-right']);
  expect(validation.snapshot().position).toBe(1);
  const first = CALIBRATION_TEST_POINTS[0];
  validation.update(first, .9, 0);
  validation.update(first, .9, 100);
  const holding = validation.update(first, .9, CALIBRATION_HOLD_DURATION / 2);
  expect(holding.state).toBe('holding');
  expect(holding.progress).toBeCloseTo(.5);
  const outside = validation.update({ x: first.x + CALIBRATION_TOLERANCE * 2, y: first.y }, .9, CALIBRATION_HOLD_DURATION / 2 + 50);
  expect(outside.state).toBe('outside-target');
  expect(outside.progress).toBe(0);
});
it('requires a fresh hold for each target and exposes error quality', () => {
  const validation = new CalibrationValidation();
  let now = 0;
  for (let frame = 0; frame <= CALIBRATION_HOLD_DURATION; frame += 100) {
    now = frame;
    validation.update(CALIBRATION_TEST_POINTS[0], .9, now);
  }
  const complete = validation.snapshot();
  expect(complete.completed).toBe(1);
  expect(complete.position).toBe(2);
  expect(complete.target).toEqual(CALIBRATION_TEST_POINTS[1]);
  expect(complete.averageError).toBe(0);
  expect(complete.maximumError).toBe(0);
});
