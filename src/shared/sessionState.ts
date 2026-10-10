import type { CameraConsumer, CameraSessionState, RuntimeStatus, TrackingSessionState } from './types';

export function validConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

export function formatConfidence(value: unknown): string {
  const confidence = validConfidence(value);
  return confidence === null ? 'Unavailable' : `${Math.round(confidence * 100)}%`;
}

function cameraStateFrom(status: RuntimeStatus): CameraSessionState {
  if (status.permission === 'active' || status.engineState === 'RUNNING' || status.engineState === 'READY') return 'active';
  if (status.permission === 'prompt' || status.engineState === 'STARTING') return 'requesting';
  if (status.permission === 'paused' || status.engineState === 'PAUSED') return 'paused';
  if (status.permission === 'denied' || status.permission === 'unavailable' || status.engineState === 'ERROR') return 'error';
  if (status.permission === 'stopped' || status.engineState === 'STOPPED') return 'stopped';
  return status.cameraState;
}

function trackingStateFrom(status: RuntimeStatus): TrackingSessionState {
  if (status.trackingPhase === 'loading-model') return 'loading';
  if (status.trackingPhase === 'camera-ready') return 'ready';
  if (status.trackingPhase === 'tracking') return 'tracking';
  if (status.trackingPhase === 'lost' || status.trackingPhase === 'face-not-detected' || status.trackingPhase === 'reinitializing') return 'lost';
  if (status.trackingPhase === 'paused') return 'paused';
  if (status.trackingPhase === 'error') return 'error';
  return status.trackingState;
}

export function normalizeRuntimeStatus(current: RuntimeStatus, patch: Partial<RuntimeStatus>): RuntimeStatus {
  const next = { ...current } as RuntimeStatus;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined || key === 'error' || key === 'diagnostic' || key === 'voiceMessage' || key === 'currentTabTitle' || key === 'currentTabUrl') {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  const cameraState = cameraStateFrom(next);
  const trackingState = trackingStateFrom(next);
  const faceConfidence = validConfidence(next.confidence);
  const handConfidence = validConfidence(next.handConfidence);
  const consumers = Array.from(new Set((next.activeCameraConsumers ?? []).filter((consumer): consumer is CameraConsumer =>
    ['dashboard', 'sidepanel', 'calibration', 'touchview', 'newtab', 'head', 'hand'].includes(consumer))));
  const cameraActive = cameraState === 'active' || cameraState === 'paused';
  const handDetected = cameraActive && next.handTracking === 'tracking';
  const faceDetected = cameraActive && next.faceDetected === true;
  return {
    ...next,
    cameraState,
    trackingState: cameraActive ? trackingState : 'idle',
    faceDetected,
    confidence: faceDetected ? faceConfidence ?? 0 : 0,
    handTracking: handDetected ? 'tracking' : cameraActive && next.handTracking === 'error' ? 'error' : 'idle',
    handConfidence: handDetected ? handConfidence ?? 0 : 0,
    activeCameraConsumers: cameraActive ? consumers : [],
    activeFaceLoops: cameraActive ? Math.max(0, Number(next.activeFaceLoops) || 0) : 0,
    activeHandLoops: cameraActive ? Math.max(0, Number(next.activeHandLoops) || 0) : 0,
    activePointerLoops: cameraActive ? Math.max(0, Number(next.activePointerLoops) || 0) : 0
  };
}
