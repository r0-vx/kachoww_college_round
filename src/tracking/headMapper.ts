import type { CalibrationData, PointerPosition } from '../shared/types';
import type { FaceSample } from './faceLandmarker';

export interface RelativeHeadPosition { x: number; y: number; }

export function relativeHeadPosition(sample: FaceSample): RelativeHeadPosition {
  const xs = sample.landmarks.map((point) => point.x);
  const ys = sample.landmarks.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const nose = sample.landmarks[1] ?? sample.landmarks[4];
  return { x: (nose.x - minX) / Math.max(0.001, maxX - minX) - 0.5, y: (nose.y - minY) / Math.max(0.001, maxY - minY) - 0.5 };
}

export class HeadMapper {
  private previous = { x: 0.5, y: 0.5 };

  map(relative: RelativeHeadPosition, calibration: CalibrationData | null, sensitivity: number, smoothing: number, deadZone: number, confidence: number): PointerPosition {
    const neutral = calibration?.neutral ?? { x: 0, y: 0 };
    const rangeX = calibration?.rangeX ?? { min: -0.22, max: 0.22 };
    const rangeY = calibration?.rangeY ?? { min: -0.2, max: 0.2 };
    const deltaX = Math.abs(relative.x - neutral.x) < deadZone ? 0 : relative.x - neutral.x;
    const deltaY = Math.abs(relative.y - neutral.y) < deadZone ? 0 : relative.y - neutral.y;
    const targetX = 0.5 + ((deltaX < 0 ? deltaX / Math.max(0.05, Math.abs(rangeX.min)) : deltaX / Math.max(0.05, Math.abs(rangeX.max))) * sensitivity * 0.46);
    const targetY = 0.5 + ((deltaY < 0 ? deltaY / Math.max(0.05, Math.abs(rangeY.min)) : deltaY / Math.max(0.05, Math.abs(rangeY.max))) * sensitivity * 0.46);
    const blend = Math.max(0.05, Math.min(0.92, 1 - smoothing));
    this.previous = { x: this.previous.x + (Math.max(0.02, Math.min(0.98, targetX)) - this.previous.x) * blend, y: this.previous.y + (Math.max(0.02, Math.min(0.98, targetY)) - this.previous.y) * blend };
    return { x: this.previous.x, y: this.previous.y, confidence, source: 'head-tracking' };
  }

  reset(): void { this.previous = { x: 0.5, y: 0.5 }; }
}
