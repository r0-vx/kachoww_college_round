import { describe, expect, it } from 'vitest';
import { relativeHeadPosition } from './headMapper';

describe('head position mapping', () => {
  it('keeps camera-frame movement instead of cancelling it with the face box', () => {
    const sample = { landmarks: [{ x: .5, y: .5, z: 0 }, { x: .25, y: .4, z: 0 }] as never[], confidence: .9, time: 1 };
       const position = relativeHeadPosition(sample);
       expect(position.x).toBeCloseTo(.25);
       expect(position.y).toBeCloseTo(-.1);
  });
});
