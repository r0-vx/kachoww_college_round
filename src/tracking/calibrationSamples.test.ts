import { describe, expect, it } from 'vitest';
import { summarizeStableSamples, type CalibrationSample } from './calibration';

const samples = (point: { x: number; y: number }, confidence = .9): CalibrationSample[] => Array.from({ length: 8 }, (_, index) => ({ point, confidence, time: index * 50 }));

describe('calibration sample stability', () => {
  it('accepts a fresh confident stable window', () => {
    const result = summarizeStableSamples(samples({ x: .1, y: .2 }), 400);
    expect(result.ready).toBe(true);
    expect(result.point?.x).toBeCloseTo(.1, 6);
    expect(result.point?.y).toBeCloseTo(.2, 6);
  });

  it('rejects missing and low-confidence samples', () => {
    expect(summarizeStableSamples([], 400).reason).toBe('missing');
    expect(summarizeStableSamples(samples({ x: .1, y: .2 }, .4), 400).reason).toBe('low-confidence');
  });

  it('rejects a moving window and stale samples', () => {
    const moving = samples({ x: .1, y: .2 });
    moving[7].point = { x: .2, y: .3 };
    expect(summarizeStableSamples(moving, 400).reason).toBe('unstable');
    expect(summarizeStableSamples(samples({ x: .1, y: .2 }), 1000).reason).toBe('stale');
  });
});
