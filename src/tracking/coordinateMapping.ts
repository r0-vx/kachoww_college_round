import type { CalibrationData, CalibrationGeometry, CalibrationInput, CalibrationPoint, TouchViewCalibrationCorner } from '../shared/types';

export const CALIBRATION_VERSION = 2 as const;
export const CALIBRATION_CORNERS: TouchViewCalibrationCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface CoordinatePoint { x: number; y: number; }

export type MappingFallbackReason = 'missing-landmark' | 'missing-calibration' | 'invalid-calibration' | 'inverse-failed';

export interface CoordinateMappingDebug {
  point: CoordinatePoint | null;
  correctedCameraPoint: CoordinatePoint | null;
  calibrationInputPoint: CoordinatePoint | null;
  fallbackUsed: boolean;
  fallbackReason?: MappingFallbackReason;
}

export interface CalibrationBuildOptions {
  mirrored: boolean;
  input: CalibrationInput;
  cameraDeviceId?: string;
  geometry: CalibrationGeometry;
}

export const CALIBRATION_TARGETS: Record<TouchViewCalibrationCorner, CoordinatePoint> = {
  'top-left': { x: 0.08, y: 0.10 },
  'top-right': { x: 0.92, y: 0.10 },
  'bottom-left': { x: 0.08, y: 0.90 },
  'bottom-right': { x: 0.92, y: 0.90 }
};

const clamp = (value: number, min = 0.01, max = 0.99): number => Math.max(min, Math.min(max, value));
const finite = (value: number): boolean => Number.isFinite(value);

export function normalizedCameraPoint(point: CoordinatePoint, mirrored: boolean): CoordinatePoint {
  return { x: clamp(mirrored ? 1 - point.x : point.x), y: clamp(point.y) };
}

export function visibleCameraPoint(point: CoordinatePoint, geometry: CalibrationGeometry, objectFit: 'cover' | 'contain' = 'cover'): CoordinatePoint {
  const sourceAspect = geometry.cameraWidth > 0 && geometry.cameraHeight > 0 ? geometry.cameraWidth / geometry.cameraHeight : 16 / 9;
  const displayAspect = geometry.displayWidth > 0 && geometry.displayHeight > 0 ? geometry.displayWidth / geometry.displayHeight : sourceAspect;
  if (Math.abs(sourceAspect - displayAspect) < 0.001) return { x: clamp(point.x), y: clamp(point.y) };
  const cover = objectFit === 'cover';
  if ((sourceAspect > displayAspect) === cover) {
    const visibleWidth = cover ? displayAspect / sourceAspect : sourceAspect / displayAspect;
    const offset = (1 - visibleWidth) / 2;
    return { x: clamp(cover ? (point.x - offset) / visibleWidth : point.x * visibleWidth + offset), y: clamp(point.y) };
  }
  const visibleHeight = cover ? sourceAspect / displayAspect : displayAspect / sourceAspect;
  const offset = (1 - visibleHeight) / 2;
  return { x: clamp(point.x), y: clamp(cover ? (point.y - offset) / visibleHeight : point.y * visibleHeight + offset) };
}

export function readCalibrationGeometry(video: HTMLVideoElement, viewport: Window = window, surface: Element = video): CalibrationGeometry {
  const rect = video.getBoundingClientRect();
  const surfaceRect = surface.getBoundingClientRect();
  // The calibration workspace is a viewport surface even though the same
  // video element normally lives inside the dashboard card. Use viewport
  // geometry whenever a separate calibration surface is supplied; this also
  // avoids reading the pre-transition card rect during the first animation
  // frame after the workspace opens.
  const fullSurface = surface !== video;
  const displayWidth = fullSurface ? viewport.innerWidth : rect.width || viewport.innerWidth;
  const displayHeight = fullSurface ? viewport.innerHeight : rect.height || viewport.innerHeight;
  return {
    cameraWidth: video.videoWidth || 1280,
    cameraHeight: video.videoHeight || 720,
    videoWidth: video.clientWidth || rect.width || viewport.innerWidth,
    videoHeight: video.clientHeight || rect.height || viewport.innerHeight,
    displayWidth,
    displayHeight,
    surfaceWidth: fullSurface ? viewport.innerWidth : surfaceRect.width || displayWidth,
    surfaceHeight: fullSurface ? viewport.innerHeight : surfaceRect.height || displayHeight,
    objectFit: (getComputedStyle(video).objectFit === 'contain' ? 'contain' : 'cover'),
    viewportWidth: viewport.innerWidth,
    viewportHeight: viewport.innerHeight,
    devicePixelRatio: viewport.devicePixelRatio || 1,
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY
  };
}

export function calibrationGeometryCompatible(calibration: CalibrationData | null, geometry: CalibrationGeometry, cameraDeviceId?: string, mirrored?: boolean): boolean {
  if (!calibration || calibration.version !== CALIBRATION_VERSION) return false;
  if (!calibration.geometry || !calibration.points || !Number.isFinite(calibration.quality) || calibration.quality < .35 || CALIBRATION_CORNERS.some(corner => !validPoint(calibration.points[corner]))) return false;
  if (cameraDeviceId && calibration.cameraDeviceId && cameraDeviceId !== calibration.cameraDeviceId) return false;
  if (mirrored !== undefined && calibration.mirrored !== mirrored) return false;
  const cameraWidthRatio = geometry.cameraWidth / Math.max(1, calibration.geometry.cameraWidth);
  const cameraHeightRatio = geometry.cameraHeight / Math.max(1, calibration.geometry.cameraHeight);
  if (cameraWidthRatio < 0.92 || cameraWidthRatio > 1.08 || cameraHeightRatio < 0.92 || cameraHeightRatio > 1.08) return false;
  const widthRatio = geometry.viewportWidth / Math.max(1, calibration.geometry.viewportWidth);
  const heightRatio = geometry.viewportHeight / Math.max(1, calibration.geometry.viewportHeight);
  return widthRatio > 0.92 && widthRatio < 1.08 && heightRatio > 0.92 && heightRatio < 1.08;
}

function validPoint(point: CalibrationPoint | undefined): point is CalibrationPoint {
  return Boolean(point && finite(point.camera.x) && finite(point.camera.y) && finite(point.viewport.x) && finite(point.viewport.y));
}

export function buildCalibration(points: Partial<Record<TouchViewCalibrationCorner, CalibrationPoint>>, options: CalibrationBuildOptions): CalibrationData | null {
  if (CALIBRATION_CORNERS.some((corner) => !validPoint(points[corner]))) return null;
  // Store calibration samples in the same visible-camera coordinate space used
  // during live mapping. Without this conversion, a `cover` crop is applied to
  // live points but not to the saved corners, producing a large edge offset.
  const complete = Object.fromEntries(CALIBRATION_CORNERS.map((corner) => {
    const rawCamera = (points[corner] as CalibrationPoint).rawCamera ?? (points[corner] as CalibrationPoint).camera;
    const normalized = normalizedCameraPoint(rawCamera, options.mirrored);
    return [corner, { camera: visibleCameraPoint(normalized, options.geometry, options.geometry.objectFit ?? 'cover'), rawCamera, viewport: (points[corner] as CalibrationPoint).viewport }];
  })) as Record<TouchViewCalibrationCorner, CalibrationPoint>;
  // Reject a folded quadrilateral: its inverse mapping can jump across the
  // page even though the four samples have a seemingly large spread.
  const polygon = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => complete[corner as TouchViewCalibrationCorner].camera);
  const turns = polygon.map((a, i) => { const b = polygon[(i + 1) % 4], c = polygon[(i + 2) % 4]; return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); });
  if (turns.some(turn => Math.abs(turn) < .001) || !turns.every(turn => Math.sign(turn) === Math.sign(turns[0]))) return null;
  const horizontal = Math.min(
    Math.abs(complete['top-right'].camera.x - complete['top-left'].camera.x),
    Math.abs(complete['bottom-right'].camera.x - complete['bottom-left'].camera.x)
  );
  const vertical = Math.min(
    Math.abs(complete['bottom-left'].camera.y - complete['top-left'].camera.y),
    Math.abs(complete['bottom-right'].camera.y - complete['top-right'].camera.y)
  );
  const spread = Math.min(horizontal / 0.42, vertical / 0.42);
  const quality = clamp(Math.max(0, Math.min(1, spread)), 0, 1);
  if (quality < 0.35) return null;
  return { version: CALIBRATION_VERSION, mirrored: options.mirrored, input: options.input, cameraDeviceId: options.cameraDeviceId, geometry: options.geometry, points: complete, quality, createdAt: Date.now() };
}

function bilinear(corners: Record<TouchViewCalibrationCorner, CoordinatePoint>, u: number, v: number): CoordinatePoint {
  const tl = corners['top-left'];
  const tr = corners['top-right'];
  const bl = corners['bottom-left'];
  const br = corners['bottom-right'];
  return {
    x: tl.x * (1 - u) * (1 - v) + tr.x * u * (1 - v) + bl.x * (1 - u) * v + br.x * u * v,
    y: tl.y * (1 - u) * (1 - v) + tr.y * u * (1 - v) + bl.y * (1 - u) * v + br.y * u * v
  };
}

function inverseBilinear(point: CoordinatePoint, corners: Record<TouchViewCalibrationCorner, CoordinatePoint>): CoordinatePoint | null {
  const left = corners['top-left'];
  const right = corners['top-right'];
  const top = corners['bottom-left'];
  const initialWidth = Math.max(0.08, Math.abs(right.x - left.x));
  const initialHeight = Math.max(0.08, Math.abs(top.y - left.y));
  let u = (point.x - left.x) / initialWidth;
  let v = (point.y - left.y) / initialHeight;
  for (let index = 0; index < 8; index += 1) {
    const estimate = bilinear(corners, u, v);
    // Use derivatives, not the raw finite difference. Without dividing by
    // the probe step, Newton's update overshoots by 1000x and valid mirrored
    // calibrations collapse toward an edge or fail the inverse entirely.
    const step = 0.001;
    const duSample = bilinear(corners, u + step, v);
    const dvSample = bilinear(corners, u, v + step);
    const du = { x: (duSample.x - estimate.x) / step, y: (duSample.y - estimate.y) / step };
    const dv = { x: (dvSample.x - estimate.x) / step, y: (dvSample.y - estimate.y) / step };
    const determinant = du.x * dv.y - du.y * dv.x;
    if (Math.abs(determinant) < 0.000000000001) return null;
    const error = { x: point.x - estimate.x, y: point.y - estimate.y };
    u += (error.x * dv.y - error.y * dv.x) / determinant;
    v += (du.x * error.y - du.y * error.x) / determinant;
  }
  return { x: Math.max(0, Math.min(1, u)), y: Math.max(0, Math.min(1, v)) };
}

function defaultGeometry(): CalibrationGeometry {
  return { cameraWidth: 1, cameraHeight: 1, videoWidth: 1, videoHeight: 1, displayWidth: 1, displayHeight: 1, viewportWidth: 1, viewportHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0, objectFit: 'cover' };
}

export function mapCameraToViewportDebug(point: CoordinatePoint | null, calibration: CalibrationData | null, geometry?: CalibrationGeometry, mirrored = calibration?.mirrored ?? false): CoordinateMappingDebug {
  if (!point || !finite(point.x) || !finite(point.y)) return { point: null, correctedCameraPoint: null, calibrationInputPoint: null, fallbackUsed: false, fallbackReason: 'missing-landmark' };
  const calibrationInputPoint = normalizedCameraPoint(point, mirrored);
  if (!calibration || calibration.version !== CALIBRATION_VERSION) {
    const activeGeometry = geometry ?? defaultGeometry();
    const corrected = visibleCameraPoint(calibrationInputPoint, activeGeometry, activeGeometry.objectFit ?? 'cover');
    return { point: { x: clamp(corrected.x), y: clamp(corrected.y) }, correctedCameraPoint: corrected, calibrationInputPoint, fallbackUsed: false, fallbackReason: 'missing-calibration' };
  }
  // Calibration samples are raw camera landmarks. Reuse the calibration
  // surface transform for every later frame so the dashboard's small camera
  // card can feed the same full-screen mapping without applying a second crop.
  const activeGeometry = calibration.geometry;
  const corrected = visibleCameraPoint(calibrationInputPoint, activeGeometry, activeGeometry.objectFit ?? 'cover');
  const cameraCorners = Object.fromEntries(CALIBRATION_CORNERS.map((corner) => [corner, calibration.points[corner].camera])) as Record<TouchViewCalibrationCorner, CoordinatePoint>;
  const viewportCorners = Object.fromEntries(CALIBRATION_CORNERS.map((corner) => [corner, calibration.points[corner].viewport])) as Record<TouchViewCalibrationCorner, CoordinatePoint>;
  const uv = inverseBilinear(corrected, cameraCorners);
  if (!uv) return { point: null, correctedCameraPoint: corrected, calibrationInputPoint, fallbackUsed: true, fallbackReason: 'inverse-failed' };
  const mapped = bilinear(viewportCorners, uv.x, uv.y);
  return { point: { x: clamp(mapped.x), y: clamp(mapped.y) }, correctedCameraPoint: corrected, calibrationInputPoint, fallbackUsed: false };
}

/**
 * Maps a live landmark without inventing a center point when the inverse
 * calibration is unavailable. Callers should retain their last valid point
 * or pause interaction when this returns null.
 */
export function mapCameraToViewport(point: CoordinatePoint, calibration: CalibrationData | null, geometry?: CalibrationGeometry, mirrored = calibration?.mirrored ?? false): CoordinatePoint | null {
  return mapCameraToViewportDebug(point, calibration, geometry, mirrored).point;
}

export function viewportToClient(point: CoordinatePoint, geometry: CalibrationGeometry): CoordinatePoint {
  return { x: clamp(point.x) * geometry.viewportWidth, y: clamp(point.y) * geometry.viewportHeight };
}

export function clientToPage(point: CoordinatePoint, viewport: Window = window): CoordinatePoint {
  return { x: point.x + viewport.scrollX, y: point.y + viewport.scrollY };
}

export function calibrationQualityLabel(calibration: CalibrationData | null): string {
  if (!calibration) return 'Calibration required';
  if (calibration.quality >= 0.8) return 'Excellent calibration';
  if (calibration.quality >= 0.55) return 'Usable calibration';
  return 'Low quality · recalibrate';
}
