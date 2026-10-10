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

export type ControlMode = 'head' | 'hand' | 'voice' | 'dictation' | 'sense' | 'touchview';
export type MicrophoneState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'active' | 'stopped' | 'unavailable';
export type VoiceState = 'unavailable' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type HandGesture = 'pinch' | 'open-palm' | 'release' | 'none';

export type TouchViewCalibrationCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface TouchViewCalibrationPoint {
  camera: { x: number; y: number };
  page: { x: number; y: number };
}

export interface TouchViewCalibration {
  mirrored: boolean;
  points: Record<TouchViewCalibrationCorner, TouchViewCalibrationPoint>;
  quality: number;
  createdAt: number;
}

export type AnalyticsEventType =
  | 'mode-enabled' | 'mode-disabled' | 'pointer-movement' | 'target-highlighted'
  | 'dwell-started' | 'dwell-cancelled' | 'dwell-completed' | 'voice-command-received'
  | 'voice-command-executed' | 'voice-command-rejected' | 'clarification-requested'
  | 'tracking-lost' | 'tracking-restored' | 'recentered' | 'field-focused'
  | 'submission-confirmed' | 'task-started' | 'task-completed'
  | 'TOUCHVIEW_ENABLED' | 'TOUCHVIEW_DISABLED' | 'TOUCHVIEW_CALIBRATION_STARTED'
  | 'TOUCHVIEW_CALIBRATION_COMPLETED' | 'TOUCHVIEW_CALIBRATION_FAILED' | 'TOUCHVIEW_HAND_DETECTED'
  | 'TOUCHVIEW_HAND_LOST' | 'TOUCHVIEW_TARGET_HOVERED' | 'TOUCHVIEW_PINCH_STARTED'
  | 'TOUCHVIEW_PINCH_ACTIVATED' | 'TOUCHVIEW_HOLD_STARTED' | 'TOUCHVIEW_HOLD_CANCELLED'
  | 'TOUCHVIEW_TARGET_ACTIVATED' | 'TOUCHVIEW_ACTIVATION_REJECTED' | 'TOUCHVIEW_PAUSED'
  | 'TOUCHVIEW_RESUMED' | 'TOUCHVIEW_RECALIBRATED';

export interface AnalyticsEvent {
  id?: number;
  type: AnalyticsEventType;
  timestamp: number;
  mode?: ControlMode;
  outcome?: 'success' | 'cancelled' | 'rejected' | 'ambiguous' | 'lost' | 'unavailable';
  duration?: number;
  targetRole?: string;
  targetName?: string;
  metadata?: Record<string, string | number | boolean>;
}

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
  enabledModes: ControlMode[];
  handSensitivity: number;
  pinchThreshold: number;
  voiceActivation: 'manual' | 'wake-word';
  speechRate: number;
  speechVolume: number;
  audioFirstMode: boolean;
  analyticsEnabled: boolean;
  touchViewEnabled: boolean;
  touchViewPaused: boolean;
  touchViewCameraOpacity: number;
  touchViewWebsiteOpacity: number;
  touchViewCursorSize: number;
  touchViewCursorColor: 'cyan' | 'lime' | 'amber' | 'magenta';
  touchViewHoldDuration: number;
  touchViewFeedbackEnabled: boolean;
  touchViewMirrorCamera: boolean;
  touchViewStableHoldEnabled: boolean;
  touchViewCalibration: TouchViewCalibration | null;
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
  microphone: MicrophoneState;
  handTracking: 'idle' | 'tracking' | 'lost' | 'unavailable' | 'error';
  handConfidence: number;
  voice: VoiceState;
  voiceMessage?: string;
  recentAnalytics?: AnalyticsEvent[];
}

export interface PointerPosition {
  x: number;
  y: number;
  confidence: number;
  source: 'head-tracking';
}

export interface HandPointerPosition {
  x: number;
  y: number;
  confidence: number;
  source: 'hand-tracking';
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
  | { type: 'HAND_POINTER_MOVEMENT'; position: HandPointerPosition; gesture?: HandGesture }
  | { type: 'HAND_GESTURE'; gesture: HandGesture; confidence: number }
  | { type: 'TOUCHVIEW_POINTER_MOVEMENT'; position: HandPointerPosition; gesture: HandGesture; paused: boolean }
  | { type: 'TOUCHVIEW_CONTROL'; active: boolean; paused: boolean }
  | { type: 'TARGET_HIGHLIGHT'; target: TargetInfo | null }
  | { type: 'DWELL_STARTED'; target: TargetInfo; duration: number }
  | { type: 'DWELL_CANCELLED'; reason: string }
  | { type: 'DWELL_COMPLETED'; target: TargetInfo }
  | { type: 'TRACKING_STATUS'; status: Partial<Pick<RuntimeStatus, 'trackingPhase' | 'faceDetected' | 'confidence' | 'error' | 'handTracking' | 'handConfidence'>> }
  | { type: 'PERMISSION_STATUS'; permission: PermissionState; error?: string }
  | { type: 'ERROR_STATUS'; error: string }
  | { type: 'MIC_PERMISSION_STATUS'; microphone: MicrophoneState; error?: string }
  | { type: 'VOICE_STATUS'; voice: VoiceState; message?: string }
  | { type: 'VOICE_COMMAND'; transcript: string }
  | { type: 'VOICE_COMMAND_RESULT'; success: boolean; message: string; speak?: boolean }
  | { type: 'DICTATION_TEXT'; text: string; isFinal: boolean }
  | { type: 'FOCUS_FIELD'; query: string }
  | { type: 'CANCEL_DWELL' }
  | { type: 'PAGE_STRUCTURE_REQUEST' }
  | { type: 'PAGE_STRUCTURE_RESPONSE'; nodes: PageNode[] }
  | { type: 'SENSE_QUERY'; query: string }
  | { type: 'SENSE_RESPONSE'; message: string; nodes?: PageNode[] }
  | { type: 'ANALYTICS_EVENT'; event: AnalyticsEvent }
  | { type: 'ANALYTICS_SUMMARY_REQUEST' }
  | { type: 'ANALYTICS_RESET' }
  | { type: 'ANALYTICS_SUMMARY_RESPONSE'; summary: AnalyticsSummary }
  | { type: 'GET_STATE' }
  | { type: 'STATE_RESPONSE'; settings: HandFreeSettings; status: RuntimeStatus }
  | { type: 'GET_ACTIVE_TAB_STATUS' }
  | { type: 'ACTIVE_TAB_STATUS'; status: Pick<RuntimeStatus, 'currentTabSupported' | 'currentTabTitle' | 'currentTabUrl' | 'error'> }
  | { type: 'OPEN_SIDE_PANEL' }
  | { type: 'OPEN_NEW_TAB' };

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
  calibration: null,
  enabledModes: ['head'],
  handSensitivity: 1,
  pinchThreshold: 0.08,
  voiceActivation: 'manual',
  speechRate: 1,
  speechVolume: 1,
  audioFirstMode: false,
  analyticsEnabled: true,
  touchViewEnabled: false,
  touchViewPaused: false,
  touchViewCameraOpacity: 0.72,
  touchViewWebsiteOpacity: 0.9,
  touchViewCursorSize: 28,
  touchViewCursorColor: 'cyan',
  touchViewHoldDuration: 650,
  touchViewFeedbackEnabled: true,
  touchViewMirrorCamera: true,
  touchViewStableHoldEnabled: true,
  touchViewCalibration: null
};

export const DEFAULT_STATUS: RuntimeStatus = {
  trackingPhase: 'idle',
  permission: 'unknown',
  faceDetected: false,
  confidence: 0,
  currentTabSupported: null,
  microphone: 'unknown',
  handTracking: 'idle',
  handConfidence: 0,
  voice: 'unavailable'
};

export interface PageNode {
  id: string;
  role: string;
  accessibleName: string;
  text: string;
  visible: boolean;
  interactive: boolean;
  disabled: boolean;
  parentSection?: string;
  selectorHint: string;
}

export interface AnalyticsSummary {
  sessionStartedAt: number;
  totalEvents: number;
  completedTasks: number;
  completedDwells: number;
  cancelledDwells: number;
  voiceCommands: number;
  trackingInterruptions: number;
  byMode: Record<string, number>;
  byOutcome: Record<string, number>;
  recent: AnalyticsEvent[];
  touchViewUsage: number;
  touchViewCalibrationSuccessRate: number;
  touchViewSuccessfulActivations: number;
  touchViewCancelledActivations: number;
  touchViewTrackingInterruptions: number;
  touchViewAverageActivationTime: number;
  touchViewPinchActivations: number;
  touchViewHoldActivations: number;
}
