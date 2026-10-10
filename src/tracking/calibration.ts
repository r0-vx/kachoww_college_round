import type { CalibrationData, CalibrationGeometry, CalibrationInput, CalibrationPoint, TouchViewCalibrationCorner } from '../shared/types';
import { buildCalibration, CALIBRATION_CORNERS, CALIBRATION_TARGETS } from './coordinateMapping';

export type CalibrationStep = 'idle' | TouchViewCalibrationCorner | 'test' | 'complete';

export interface CalibrationSample {
  point: { x: number; y: number };
  confidence: number;
  time: number;
}

export interface StableSampleSummary {
  ready: boolean;
  reason: 'missing' | 'warming' | 'stale' | 'low-confidence' | 'unstable' | 'ready';
  point: { x: number; y: number } | null;
  count: number;
  stability: number;
  confidence: number;
}

/** Summarizes the live tracking window used by each real calibration target. */
export function summarizeStableSamples(samples: CalibrationSample[], now: number, windowMs = 700, minimumSamples = 6, minimumDurationMs = 220, maximumSpread = .025): StableSampleSummary {
  const recent = samples.filter(sample => now - sample.time <= windowMs).sort((a, b) => a.time - b.time);
  if (!recent.length) return { ready: false, reason: 'missing', point: null, count: 0, stability: 1, confidence: 0 };
  const latest = recent[recent.length - 1];
  const point = { x: recent.reduce((sum, sample) => sum + sample.point.x, 0) / recent.length, y: recent.reduce((sum, sample) => sum + sample.point.y, 0) / recent.length };
  const stability = Math.max(...recent.map(sample => Math.hypot(sample.point.x - point.x, sample.point.y - point.y)));
  const confidence = Math.min(...recent.map(sample => sample.confidence));
  if (now - latest.time > 180) return { ready: false, reason: 'stale', point, count: recent.length, stability, confidence };
  if (recent.length < minimumSamples || latest.time - recent[0].time < minimumDurationMs) return { ready: false, reason: 'warming', point, count: recent.length, stability, confidence };
  if (confidence < .55) return { ready: false, reason: 'low-confidence', point, count: recent.length, stability, confidence };
  if (stability > maximumSpread) return { ready: false, reason: 'unstable', point, count: recent.length, stability, confidence };
  return { ready: true, reason: 'ready', point, count: recent.length, stability, confidence };
}

export class CalibrationSession {
  private samples: Partial<Record<TouchViewCalibrationCorner, CalibrationPoint>> = {};
  private options: { mirrored: boolean; input: CalibrationInput; cameraDeviceId?: string; geometry?: CalibrationGeometry } = { mirrored: true, input: 'mixed' };
  step: CalibrationStep = 'idle';

  begin(options: { mirrored: boolean; input: CalibrationInput; cameraDeviceId?: string; geometry: CalibrationGeometry }): void {
    this.options = options;
    this.samples = {};
    this.step = 'top-left';
  }

  capture(camera: { x: number; y: number }, geometry?: CalibrationGeometry): CalibrationStep {
    if (this.step === 'idle' || this.step === 'test' || this.step === 'complete') return this.step;
    const corner = this.step as TouchViewCalibrationCorner;
    this.samples[corner] = { camera, rawCamera: camera, viewport: CALIBRATION_TARGETS[corner] };
    const index = CALIBRATION_CORNERS.indexOf(corner);
    this.step = index === CALIBRATION_CORNERS.length - 1 ? 'test' : CALIBRATION_CORNERS[index + 1];
    if (geometry) this.options.geometry = geometry;
    return this.step;
  }

  save(): CalibrationData | null {
    if (!this.options.geometry) return null;
    const calibration = buildCalibration(this.samples, { ...this.options, geometry: this.options.geometry });
    if (calibration) this.step = 'complete';
    return calibration;
  }

  get currentSamples(): Partial<Record<TouchViewCalibrationCorner, CalibrationPoint>> { return this.samples; }
  reset(): void { this.samples = {}; this.step = 'idle'; }
}
