export type TrackingPhase =
  | 'idle'
  | 'camera-ready'
  | 'loading-model'
  | 'face-detected'
  | 'face-not-detected'
  | 'tracking'
  | 'paused'
  | 'lost'
  | 'reinitializing'
  | 'error';

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable' | 'active' | 'paused' | 'stopped';

export interface CalibrationData {
  neutral: { x: number; y: number };
  rangeX: { min: number; max: number };
  rangeY: { min: number; max: number };
  createdAt: number;
}

export interface HandFreeSettings {
  enabled: boolean;
  paused: boolean;
  headControlEnabled: boolean;
  sensitivity: number;
  smoothing: number;
  dwellDuration: number;
  dwellEnabled: boolean;
  cooldownDuration: number;
  deadZone: number;
  calibration: CalibrationData | null;
}

export interface RuntimeStatus {
  trackingPhase: TrackingPhase;
  permission: PermissionState;
  faceDetected: boolean;
  confidence: number;
  currentTabSupported: boolean | null;
  currentTabTitle?: string;
  currentTabUrl?: string;
  error?: string;
}

export interface PointerPosition {
  x: number;
  y: number;
  confidence: number;
  source: 'head-tracking';
}

export interface TargetInfo {
  selectorHint: string;
  accessibleName: string;
  tagName: string;
}

export type HandFreeMessage =
  | { type: 'ENABLE_HAND_FREE'; settings?: Partial<HandFreeSettings> }
  | { type: 'DISABLE_HAND_FREE' }
  | { type: 'PAUSE_INTERACTION'; reason?: string }
  | { type: 'RESUME_INTERACTION' }
  | { type: 'RECENTER_POINTER' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<HandFreeSettings> }
  | { type: 'POINTER_MOVEMENT'; position: PointerPosition }
  | { type: 'TARGET_HIGHLIGHT'; target: TargetInfo | null }
  | { type: 'DWELL_STARTED'; target: TargetInfo; duration: number }
  | { type: 'DWELL_CANCELLED'; reason: string }
  | { type: 'DWELL_COMPLETED'; target: TargetInfo }
  | { type: 'TRACKING_STATUS'; status: Pick<RuntimeStatus, 'trackingPhase' | 'faceDetected' | 'confidence' | 'error'> }
  | { type: 'PERMISSION_STATUS'; permission: PermissionState; error?: string }
  | { type: 'ERROR_STATUS'; error: string }
  | { type: 'GET_STATE' }
  | { type: 'STATE_RESPONSE'; settings: HandFreeSettings; status: RuntimeStatus }
  | { type: 'GET_ACTIVE_TAB_STATUS' }
  | { type: 'ACTIVE_TAB_STATUS'; status: Pick<RuntimeStatus, 'currentTabSupported' | 'currentTabTitle' | 'currentTabUrl' | 'error'> }
  | { type: 'OPEN_SIDE_PANEL' };

export const DEFAULT_SETTINGS: HandFreeSettings = {
  enabled: false,
  paused: false,
  headControlEnabled: false,
  sensitivity: 1,
  smoothing: 0.72,
  dwellDuration: 1200,
  dwellEnabled: true,
  cooldownDuration: 900,
  deadZone: 0.08,
  calibration: null
};

export const DEFAULT_STATUS: RuntimeStatus = {
  trackingPhase: 'idle',
  permission: 'unknown',
  faceDetected: false,
  confidence: 0,
  currentTabSupported: null
};
