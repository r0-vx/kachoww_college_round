import { describe, expect, it } from 'vitest';
import { interpretHand } from './handLandmarker';

function landmarks(pinch: boolean) {
  return Array.from({ length: 21 }, (_, index) => ({ x: .4 + index * .001, y: .4 + index * .001, z: 0 } as { x: number; y: number; z: number })).map((point, index) => index === 0 ? { x: .4, y: .4, z: 0 } : index === 4 ? { x: pinch ? .5 : .1, y: pinch ? .5 : .1, z: 0 } : index === 8 ? { x: .5, y: .5, z: 0 } : point) as unknown as import('@mediapipe/tasks-vision').NormalizedLandmark[];
}

describe('hand gesture interpretation', () => {
  it('detects a pinch from thumb and index distance', () => { expect(interpretHand({ landmarks: landmarks(true), confidence: .9 }, .08).gesture).toBe('pinch'); });
  it('returns a non-pinch state when the fingers are separated', () => { expect(interpretHand({ landmarks: landmarks(false), confidence: .9 }, .08).gesture).not.toBe('pinch'); });
});
