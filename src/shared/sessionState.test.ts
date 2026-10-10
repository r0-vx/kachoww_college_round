import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUS } from './types';
import { formatConfidence, normalizeRuntimeStatus, validConfidence } from './sessionState';

describe('canonical runtime session state', () => {
  it('rejects invalid confidence values and clamps valid values', () => {
    expect(validConfidence(Number.NaN)).toBeNull();
    expect(validConfidence(Number.POSITIVE_INFINITY)).toBeNull();
    expect(validConfidence(undefined)).toBeNull();
    expect(validConfidence(-1)).toBe(0);
    expect(validConfidence(2)).toBe(1);
    expect(formatConfidence(Number.NaN)).toBe('Unavailable');
    expect(formatConfidence(0.845)).toBe('85%');
  });

  it('cannot report a detected hand while the camera is stopped', () => {
    const status = normalizeRuntimeStatus({ ...DEFAULT_STATUS, handTracking: 'tracking', handConfidence: Number.NaN }, {
      permission: 'stopped',
      engineState: 'STOPPED',
      cameraState: 'stopped',
      trackingState: 'idle'
    });
    expect(status.cameraState).toBe('stopped');
    expect(status.handTracking).toBe('idle');
    expect(status.handConfidence).toBe(0);
    expect(status.faceDetected).toBe(false);
    expect(status.activeCameraConsumers).toEqual([]);
  });

  it('derives a shared active snapshot from lifecycle state', () => {
    const status = normalizeRuntimeStatus({ ...DEFAULT_STATUS }, {
      permission: 'active',
      engineState: 'RUNNING',
      trackingPhase: 'tracking',
      faceDetected: true,
      confidence: 0.72,
      handTracking: 'tracking',
      handConfidence: 0.63,
      activeCameraConsumers: ['dashboard', 'hand', 'hand', 'invalid' as never]
    });
    expect(status.cameraState).toBe('active');
    expect(status.trackingState).toBe('tracking');
    expect(status.faceDetected).toBe(true);
    expect(status.confidence).toBe(0.72);
    expect(status.handTracking).toBe('tracking');
    expect(status.activeCameraConsumers).toEqual(['dashboard', 'hand']);
  });

  it('maps paused lifecycle to paused camera and tracking state', () => {
    const status = normalizeRuntimeStatus({ ...DEFAULT_STATUS }, { permission: 'paused', engineState: 'PAUSED', trackingPhase: 'paused' });
    expect(status.cameraState).toBe('paused');
    expect(status.trackingState).toBe('paused');
  });
});
