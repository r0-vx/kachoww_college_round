import type { CalibrationData, PointerPosition } from '../shared/types';
import type { FaceSample } from './faceLandmarker';
import type { CalibrationGeometry } from '../shared/types';
import { mapCameraToViewport, type CoordinatePoint } from './coordinateMapping';

export interface RelativeHeadPosition extends CoordinatePoint { }

export function relativeHeadPosition(sample: FaceSample): RelativeHeadPosition {
  const nose = sample.landmarks[1] ?? sample.landmarks[4];
  return { x: nose.x, y: nose.y };
}

export class HeadMapper {
  private previous = { x: 0.5, y: 0.5 };
  private neutral = { x: 0.5, y: 0.5 };
  private recenterPending = false;

  map(relative: RelativeHeadPosition, calibration: CalibrationData | null, sensitivity: number, smoothing: number, deadZone: number, confidence: number, geometry?: CalibrationGeometry, mirrored = true): PointerPosition {
    const calibrated = mapCameraToViewport(relative, calibration, geometry, mirrored);
    // A missing or invalid mapping must never teleport the pointer to the
    // center. Hold the last valid position until a fresh mapped sample exists.
    if (!calibrated) return { x: this.previous.x, y: this.previous.y, confidence, source: 'head-tracking' };
    if (this.recenterPending) { this.neutral = calibrated; this.recenterPending = false; }
    const relativeX = 0.5 + calibrated.x - this.neutral.x;
    const relativeY = 0.5 + calibrated.y - this.neutral.y;
    const deadZoneX = Math.abs(relativeX - 0.5) < deadZone ? 0.5 : relativeX;
    const deadZoneY = Math.abs(relativeY - 0.5) < deadZone ? 0.5 : relativeY;
    const targetX = 0.5 + (deadZoneX - 0.5) * Math.max(0.5, Math.min(1.8, sensitivity));
    const targetY = 0.5 + (deadZoneY - 0.5) * Math.max(0.5, Math.min(1.8, sensitivity));
    const blend = Math.max(0.05, Math.min(0.92, 1 - smoothing));
    this.previous = { x: this.previous.x + (Math.max(0.01, Math.min(0.99, targetX)) - this.previous.x) * blend, y: this.previous.y + (Math.max(0.01, Math.min(0.99, targetY)) - this.previous.y) * blend };
    return { x: this.previous.x, y: this.previous.y, confidence, source: 'head-tracking' };
  }

  reset(recenter = false): void { this.previous = { x: 0.5, y: 0.5 }; this.neutral = { x: 0.5, y: 0.5 }; this.recenterPending = recenter; }
}
