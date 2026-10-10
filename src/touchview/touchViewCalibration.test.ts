import { describe, expect, it } from 'vitest';
import { createTouchViewCalibration, mapTouchViewPoint, normalizeTouchViewPoint, TOUCH_VIEW_PAGE_POINTS } from './touchViewCalibration';

describe('TouchView calibration', () => {
  const points = Object.fromEntries(Object.entries(TOUCH_VIEW_PAGE_POINTS).map(([corner, page]) => [corner, { page, camera: page }])) as never;

  it('normalizes mirrored camera coordinates', () => {
    expect(normalizeTouchViewPoint({ x: .2, y: .7 }, false)).toEqual({ x: .8, y: .7 });
    expect(normalizeTouchViewPoint({ x: .2, y: .7 }, true)).toEqual({ x: .2, y: .7 });
  });

  it('maps calibrated center and clamps viewport edges', () => {
    const calibration = createTouchViewCalibration(points, true);
    expect(calibration).not.toBeNull();
    expect(mapTouchViewPoint({ x: .5, y: .5 }, calibration)).toEqual({ x: .5, y: .5 });
    const clamped = mapTouchViewPoint({ x: -2, y: 2 }, calibration);
    expect(clamped.x).toBeGreaterThanOrEqual(.01);
    expect(clamped.x).toBeLessThanOrEqual(.99);
    expect(clamped.y).toBeGreaterThanOrEqual(.01);
    expect(clamped.y).toBeLessThanOrEqual(.99);
  });

  it('rejects incomplete calibration', () => {
    expect(createTouchViewCalibration({ 'top-left': points['top-left'] }, true)).toBeNull();
  });
});
