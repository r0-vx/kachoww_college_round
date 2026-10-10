import { expect, it } from 'vitest';
import { landmarkQuality } from './landmarkQuality';
it('derives quality from actual landmark geometry rather than a fixed confidence', () => {
  expect(landmarkQuality([], 21)).toBe(0);
  const good = Array.from({ length: 21 }, (_, i) => ({ x: .2 + i * .02, y: .3 + i * .01, z: 0, visibility: 1 }));
  expect(landmarkQuality(good, 21)).toBe(1);
  expect(landmarkQuality(good.map(p => ({ ...p, x: Number.NaN })), 21)).toBe(0);
  expect(landmarkQuality(good.map(p => ({ ...p, x: .5, y: .5 })), 21)).toBe(0);
});
