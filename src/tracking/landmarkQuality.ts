import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Observable landmark geometry quality, NOT a model posterior probability. */
export function landmarkQuality(points: NormalizedLandmark[], expectedCount: number): number {
  if (points.length < expectedCount) return 0;
  const valid = points.filter(point => [point.x, point.y, point.z].every(Number.isFinite) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  if (valid.length < expectedCount * .55) return 0;
  const xs = valid.map(point => point.x), ys = valid.map(point => point.y);
  const spread = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.max(0, Math.min(1, valid.length / points.length * Math.min(1, spread / .04)));
}
