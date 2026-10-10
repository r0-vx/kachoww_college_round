import type { TouchViewCalibration, TouchViewCalibrationCorner, TouchViewCalibrationPoint } from '../shared/types';

export const TOUCH_VIEW_CORNERS: TouchViewCalibrationCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const TOUCH_VIEW_PAGE_POINTS: Record<TouchViewCalibrationCorner, { x: number; y: number }> = {
  'top-left': { x: 0.08, y: 0.12 },
  'top-right': { x: 0.92, y: 0.12 },
  'bottom-left': { x: 0.08, y: 0.88 },
  'bottom-right': { x: 0.92, y: 0.88 }
};

const clamp = (value: number): number => Math.max(0.01, Math.min(0.99, value));
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

export function normalizeTouchViewPoint(point: { x: number; y: number }, mirrored: boolean): { x: number; y: number } {
  return { x: clamp(mirrored ? point.x : 1 - point.x), y: clamp(point.y) };
}

export function createTouchViewCalibration(points: Partial<Record<TouchViewCalibrationCorner, TouchViewCalibrationPoint>>, mirrored: boolean): TouchViewCalibration | null {
  if (TOUCH_VIEW_CORNERS.some((corner) => !points[corner])) return null;
  const complete = points as Record<TouchViewCalibrationCorner, TouchViewCalibrationPoint>;
  const horizontal = Math.min(
    Math.abs(complete['top-right'].camera.x - complete['top-left'].camera.x),
    Math.abs(complete['bottom-right'].camera.x - complete['bottom-left'].camera.x)
  );
  const vertical = Math.min(
    Math.abs(complete['bottom-left'].camera.y - complete['top-left'].camera.y),
    Math.abs(complete['bottom-right'].camera.y - complete['top-right'].camera.y)
  );
  const quality = Math.max(0, Math.min(1, Math.min(horizontal / 0.42, vertical / 0.42)));
  return { mirrored, points: complete, quality, createdAt: Date.now() };
}

export function mapTouchViewPoint(point: { x: number; y: number }, calibration: TouchViewCalibration | null): { x: number; y: number } {
  if (!calibration) return { x: clamp(point.x), y: clamp(point.y) };
  const topLeft = calibration.points['top-left'].camera;
  const topRight = calibration.points['top-right'].camera;
  const bottomLeft = calibration.points['bottom-left'].camera;
  const bottomRight = calibration.points['bottom-right'].camera;
  const width = Math.max(0.08, (topRight.x - topLeft.x + bottomRight.x - bottomLeft.x) / 2);
  const height = Math.max(0.08, (bottomLeft.y - topLeft.y + bottomRight.y - topRight.y) / 2);
  const tx = clamp((point.x - (topLeft.x + bottomLeft.x) / 2) / width);
  const ty = clamp((point.y - (topLeft.y + topRight.y) / 2) / height);
  const topX = lerp(TOUCH_VIEW_PAGE_POINTS['top-left'].x, TOUCH_VIEW_PAGE_POINTS['top-right'].x, tx);
  const bottomX = lerp(TOUCH_VIEW_PAGE_POINTS['bottom-left'].x, TOUCH_VIEW_PAGE_POINTS['bottom-right'].x, tx);
  const topY = lerp(TOUCH_VIEW_PAGE_POINTS['top-left'].y, TOUCH_VIEW_PAGE_POINTS['bottom-left'].y, ty);
  const bottomY = lerp(TOUCH_VIEW_PAGE_POINTS['top-right'].y, TOUCH_VIEW_PAGE_POINTS['bottom-right'].y, ty);
  return { x: clamp(lerp(topX, bottomX, ty)), y: clamp(lerp(topY, bottomY, tx)) };
}

export function calibrationQualityLabel(calibration: TouchViewCalibration | null): string {
  if (!calibration) return 'Calibration required';
  if (calibration.quality >= 0.8) return 'Excellent calibration';
  if (calibration.quality >= 0.55) return 'Usable calibration';
  return 'Low quality · recalibrate';
}
