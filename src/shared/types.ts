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

export type EngineState = 'STOPPED' | 'STARTING' | 'READY' | 'RUNNING' | 'PAUSED' | 'TRACKING_LOST' | 'ERROR' | 'STOPPING';
export type PointerSource = 'none' | 'head' | 'hand' | 'touchview-hand' | 'voice';

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable' | 'active' | 'paused' | 'stopped';

export type ControlMode = 'head' | 'hand' | 'voice' | 'dictation' | 'sense' | 'touchview';
export type MicrophoneState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'active' | 'stopped' | 'unavailable';
export type VoiceState = 'unavailable' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type HandGesture = 'pinch' | 'open-palm' | 'release' | 'none';

export type DiagnosticCode =
  | 'CAMERA_PERMISSION_DENIED' | 'CAMERA_NOT_FOUND' | 'CAMERA_ALREADY_IN_USE' | 'CAMERA_STREAM_FAILED'
  | 'CAMERA_UNAVAILABLE' | 'VOICE_RECOGNITION_UNAVAILABLE' | 'DICTATION_UNAVAILABLE'
  | 'MODEL_LOADING' | 'MODEL_LOAD_FAILED' | 'FACE_NOT_DETECTED' | 'HAND_NOT_DETECTED'
  | 'LOW_TRACKING_CONFIDENCE' | 'CALIBRATION_REQUIRED' | 'CALIBRATION_INVALID'
  | 'CALIBRATION_QUALITY_LOW' | 'MIRROR_CONFIGURATION_INVALID' | 'VIEWPORT_MAPPING_FAILED'
  | 'UNSUPPORTED_PAGE' | 'CONTENT_SCRIPT_UNAVAILABLE' | 'TARGET_NOT_FOUND' | 'ACTION_CANCELLED'
  | 'DUPLICATE_TRACKING_LOOP' | 'VOICE_UNAVAILABLE' | 'STALE_POINTER_SOURCE' | 'DUPLICATE_MESSAGE' | 'ENGINE_STATE_CONFLICT'
  | 'NEW_TAB_CAMERA_NOT_CONNECTED' | 'NEW_TAB_TRACKER_NOT_CONNECTED' | 'NEW_TAB_NO_POINTER_UPDATES'
  | 'NEW_TAB_CAMERA_PERMISSION_DENIED' | 'NEW_TAB_CAMERA_STREAM_EMPTY' | 'NEW_TAB_MODEL_NOT_READY'
  | 'NEW_TAB_CALIBRATION_MISSING' | 'NEW_TAB_STALE_TRACKING';

export interface Diagnostic {
  code: DiagnosticCode;
  title: string;
  explanation: string;
  recovery: string;
  module: string;
  timestamp: number;
  blocking: boolean;
}

export type TouchViewCalibrationCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type CalibrationInput = 'head' | 'hand' | 'mixed';

export interface CalibrationGeometry {
  cameraWidth: number;
  cameraHeight: number;
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
  /** The surface used to display the camera during calibration. */
  surfaceWidth?: number;
  surfaceHeight?: number;
  objectFit?: 'cover' | 'contain';
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export interface CalibrationPoint {
  camera: { x: number; y: number };
  /** Raw MediaPipe coordinates retained for diagnostics and recalculation. */
  rawCamera?: { x: number; y: number };
  viewport: { x: number; y: number };
}

export interface TouchViewCalibration {
  version: 2;
  mirrored: boolean;
  input: CalibrationInput;
  cameraDeviceId?: string;
  geometry: CalibrationGeometry;
  points: Record<TouchViewCalibrationCorner, CalibrationPoint>;
  quality: number;
  validation?: {
    errors: number[];
    averageError: number;
    maximumError: number;
    threshold: number;
    completed: number;
  };
  /** Validation is an optional quality check after the four-point map is valid. */
  validationStatus?: 'passed' | 'skipped';
  qualityStatus?: 'validated' | 'estimated';
  createdAt: number;
}

export type CalibrationData = TouchViewCalibration;

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
  touchViewScrimOpacity: number;
  touchViewCursorSize: number;
  touchViewCursorOpacity: number;
  touchViewHighlightOpacity: number;
  touchViewFaceOpacity: number;
  touchViewHandOpacity: number;
  touchViewContrast: boolean;
  touchViewCursorColor: 'cyan' | 'lime' | 'amber' | 'magenta';
  touchViewHoldDuration: number;
  touchViewFeedbackEnabled: boolean;
  mirrorCamera: boolean;
  touchViewMirrorCamera: boolean;
  touchViewStableHoldEnabled: boolean;
  touchViewCalibration: TouchViewCalibration | null;
}

export interface RuntimeStatus {
  engineState: EngineState;
  pointerSource: PointerSource;
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
  diagnostic?: Diagnostic;
  cameraOwner: 'dashboard' | 'newtab' | 'none';
  trackingOwner: 'dashboard' | 'newtab' | 'none';
  cameraDeviceId?: string;
  cameraVideoWidth?: number;
  cameraVideoHeight?: number;
  cameraTrackCount?: number;
  lastTrackingUpdate?: number;
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
  | { type: 'ENABLE_TOUCHVIEW'; tabId?: number }
  | { type: 'DISABLE_TOUCHVIEW' }
  | { type: 'PAUSE_TOUCHVIEW' }
  | { type: 'RESUME_TOUCHVIEW' }
  | { type: 'SET_TOUCHVIEW_SETTINGS'; settings: Partial<HandFreeSettings> }
  // Positions are calibrated, normalized viewport coordinates from the dashboard.
  | { type: 'POINTER_UPDATE'; position: HandPointerPosition | PointerPosition; gesture?: HandGesture; cameraFrame?: string }
  | { type: 'TARGET_UPDATE'; target: TargetInfo | null }
  | { type: 'ACTIVATION_REQUEST'; target: TargetInfo }
  | { type: 'ACTIVATION_RESULT'; success: boolean; method?: 'pinch' | 'stable-hold'; duration?: number }
  | { type: 'CALIBRATION_UPDATED'; calibration: CalibrationData | null }
  | { type: 'CONTENT_SCRIPT_READY' }
  | { type: 'NEW_TAB_READY' }
  | { type: 'NEW_TAB_STATE'; settings: HandFreeSettings; status?: Partial<RuntimeStatus> }
  | { type: 'NEW_TAB_CAMERA_FRAME'; frame?: string; status?: Partial<RuntimeStatus> }
  | { type: 'NEW_TAB_POINTER_UPDATE'; position: HandPointerPosition | PointerPosition; gesture?: HandGesture; cameraFrame?: string }
  | { type: 'PAGE_SUPPORTED' }
  | { type: 'PAGE_UNSUPPORTED'; reason: string }
  | { type: 'TOUCHVIEW_ERROR'; reason: string; diagnostic?: Diagnostic }
  | { type: 'ENABLE_HAND_FREE'; settings?: Partial<HandFreeSettings> }
  | { type: 'DISABLE_HAND_FREE' }
  | { type: 'PAUSE_INTERACTION'; reason?: string }
  | { type: 'RESUME_INTERACTION' }
  | { type: 'RECENTER_POINTER' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<HandFreeSettings> }
  | { type: 'TARGET_HIGHLIGHT'; target: TargetInfo | null }
  | { type: 'DWELL_STARTED'; target: TargetInfo; duration: number }
  | { type: 'DWELL_CANCELLED'; reason: string }
  | { type: 'DWELL_COMPLETED'; target: TargetInfo }
  | { type: 'TRACKING_STATUS'; status: Partial<Pick<RuntimeStatus, 'engineState' | 'pointerSource' | 'trackingPhase' | 'faceDetected' | 'confidence' | 'error' | 'diagnostic' | 'handTracking' | 'handConfidence' | 'cameraOwner' | 'trackingOwner' | 'cameraDeviceId' | 'cameraVideoWidth' | 'cameraVideoHeight' | 'cameraTrackCount' | 'lastTrackingUpdate'>> & { cameraFrame?: string } }
  | { type: 'PERMISSION_STATUS'; permission: PermissionState; error?: string }
  | { type: 'ERROR_STATUS'; error: string; diagnostic?: Diagnostic }
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
  | { type: 'ACTIVE_TAB_STATUS'; status: Pick<RuntimeStatus, 'currentTabSupported' | 'currentTabTitle' | 'currentTabUrl' | 'error' | 'diagnostic'> }
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
  touchViewScrimOpacity: 0.5,
  touchViewCursorSize: 28,
  touchViewCursorOpacity: 1,
  touchViewHighlightOpacity: 1,
  touchViewFaceOpacity: 0.9,
  touchViewHandOpacity: 0.95,
  touchViewContrast: false,
  touchViewCursorColor: 'cyan',
  touchViewHoldDuration: 650,
  touchViewFeedbackEnabled: true,
  mirrorCamera: true,
  touchViewMirrorCamera: true,
  touchViewStableHoldEnabled: true,
  touchViewCalibration: null
};

export const DEFAULT_STATUS: RuntimeStatus = {
  engineState: 'STOPPED',
  pointerSource: 'none',
  trackingPhase: 'idle',
  permission: 'unknown',
  faceDetected: false,
  confidence: 0,
  currentTabSupported: null,
  microphone: 'unknown',
  handTracking: 'idle',
  handConfidence: 0,
  voice: 'unavailable',
  cameraOwner: 'none',
  trackingOwner: 'none'
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
