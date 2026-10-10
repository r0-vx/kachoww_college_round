import type { CalibrationGeometry, TouchViewCalibration, TouchViewCalibrationCorner } from '../shared/types';
import { buildCalibration, CALIBRATION_CORNERS, CALIBRATION_TARGETS, mapCameraToViewport, normalizedCameraPoint } from '../tracking/coordinateMapping';

export const TOUCH_VIEW_CORNERS: TouchViewCalibrationCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const TOUCH_VIEW_PAGE_POINTS = CALIBRATION_TARGETS;

const clamp = (value: number): number => Math.max(0.01, Math.min(0.99, value));
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

export function normalizeTouchViewPoint(point: { x: number; y: number }, mirrored: boolean): { x: number; y: number } {
  return normalizedCameraPoint(point, mirrored);
}

export function createTouchViewCalibration(points: Partial<Record<TouchViewCalibrationCorner, { camera: { x: number; y: number }; page?: { x: number; y: number }; viewport?: { x: number; y: number } }>>, mirrored: boolean, geometry: CalibrationGeometry = defaultGeometry()): TouchViewCalibration | null {
  const mapped = Object.fromEntries(Object.entries(points).map(([corner, point]) => [corner, point && { camera: point.camera, viewport: point.viewport ?? point.page ?? TOUCH_VIEW_PAGE_POINTS[corner as TouchViewCalibrationCorner] }])) as never;
  return buildCalibration(mapped, { mirrored, input: 'hand', geometry });
}

export function mapTouchViewPoint(point: { x: number; y: number }, calibration: TouchViewCalibration | null): { x: number; y: number } | null {
  return mapCameraToViewport(point, calibration);
}

export function calibrationQualityLabel(calibration: TouchViewCalibration | null): string {
  if (!calibration) return 'Calibration required';
  if (calibration.quality >= 0.8) return 'Excellent calibration';
  if (calibration.quality >= 0.55) return 'Usable calibration';
  return 'Low quality · recalibrate';
}

function defaultGeometry(): CalibrationGeometry {
  return { cameraWidth: 1280, cameraHeight: 720, videoWidth: 1280, videoHeight: 720, displayWidth: 1280, displayHeight: 720, viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
}
