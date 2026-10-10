import { describe, expect, it } from 'vitest';
import { HeadMapper, relativeHeadPosition } from './headMapper';

describe('head position mapping', () => {
  it('recenters to the next stable neutral sample and maps relative motion', () => {
    const mapper = new HeadMapper(); mapper.reset(true);
    const neutral = mapper.map({ x: .7, y: .4 }, null, 1, .2, .01, .9, undefined, false);
    expect(neutral.x).toBeCloseTo(.5);
    expect(neutral.y).toBeCloseTo(.5);
    expect(mapper.map({ x: .8, y: .4 }, null, 1, .2, .01, .9, undefined, false).x).toBeGreaterThan(.5);
  });
  it('keeps camera-frame movement instead of cancelling it with the face box', () => {
    const sample = { landmarks: [{ x: .5, y: .5, z: 0 }, { x: .25, y: .4, z: 0 }] as never[], confidence: .9, time: 1 };
       const position = relativeHeadPosition(sample);
       expect(position.x).toBeCloseTo(.25);
       expect(position.y).toBeCloseTo(.4);
  });
});
