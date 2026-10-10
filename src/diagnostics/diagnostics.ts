import type { Diagnostic, DiagnosticCode } from '../shared/types';

const copy: Record<DiagnosticCode, Pick<Diagnostic, 'title' | 'explanation' | 'recovery' | 'blocking'>> = {
  CAMERA_ALREADY_IN_USE: { title: 'Camera already in use', explanation: 'Another application or HandFree window currently owns the camera.', recovery: 'Close the other camera user, then stop and start HandFree camera setup again.', blocking: true },
  CAMERA_UNAVAILABLE: { title: 'Camera unavailable', explanation: 'No camera stream can be opened in this browser session.', recovery: 'Connect a camera, close other camera apps, allow access, and retry camera setup.', blocking: true },
  VOICE_RECOGNITION_UNAVAILABLE: { title: 'Speech recognition unavailable', explanation: 'The browser speech recognition API or service could not start.', recovery: 'Use a supported Chrome build, allow microphone access, check your connection, and retry.', blocking: true },
  DICTATION_UNAVAILABLE: { title: 'Dictation unavailable', explanation: 'No editable text field or active speech recognizer is available.', recovery: 'Focus a text input, allow microphone access, and start dictation again.', blocking: true },
  CAMERA_PERMISSION_DENIED: { title: 'Camera permission denied', explanation: 'The browser did not grant camera access.', recovery: 'Allow camera access for HandFree, then start camera setup again.', blocking: true },
  CAMERA_NOT_FOUND: { title: 'Camera not found', explanation: 'No usable video input was found.', recovery: 'Connect a camera or choose another camera device.', blocking: true },
  CAMERA_STREAM_FAILED: { title: 'Camera stream failed', explanation: 'The browser could not obtain usable camera frames. The device may be busy or stopped.', recovery: 'Close other camera apps and restart camera setup.', blocking: true },
  MODEL_LOADING: { title: 'Loading tracking model', explanation: 'HandFree is preparing a local MediaPipe model.', recovery: 'Wait for model loading to finish.', blocking: false },
  MODEL_LOAD_FAILED: { title: 'Tracking model failed', explanation: 'A local MediaPipe model could not initialize.', recovery: 'Restart camera setup; if it persists, check browser WebGL support.', blocking: true },
  FACE_NOT_DETECTED: { title: 'Face not detected', explanation: 'No stable face landmarks are available right now.', recovery: 'Move into view, improve lighting, and keep your head still briefly.', blocking: false },
  HAND_NOT_DETECTED: { title: 'Hand not detected', explanation: 'No stable hand landmarks are available right now.', recovery: 'Raise one hand fully into view and keep it inside the camera frame.', blocking: false },
  LOW_TRACKING_CONFIDENCE: { title: 'Tracking confidence is low', explanation: 'The current landmarks are too uncertain for safe interaction.', recovery: 'Pause, improve lighting, and reacquire the face or hand.', blocking: false },
  CALIBRATION_REQUIRED: { title: 'Calibration required', explanation: 'There is no valid shared camera-to-viewport calibration.', recovery: 'Open the dashboard and complete the four-corner calibration.', blocking: true },
  CALIBRATION_INVALID: { title: 'Calibration is invalid', explanation: 'The saved calibration does not match the current mapping settings.', recovery: 'Recalibrate after confirming the camera and mirror setting.', blocking: true },
  CALIBRATION_QUALITY_LOW: { title: 'Calibration quality is low', explanation: 'The four captured corners are too close or unstable.', recovery: 'Keep the camera fixed and capture all four corners again.', blocking: true },
  MIRROR_CONFIGURATION_INVALID: { title: 'Mirror setting changed', explanation: 'The saved calibration was created with another preview orientation.', recovery: 'Recalibrate after choosing mirrored or non-mirrored preview.', blocking: true },
  VIEWPORT_MAPPING_FAILED: { title: 'Viewport mapping unavailable', explanation: 'HandFree could not convert camera coordinates into the current viewport.', recovery: 'Resize back to a stable browser window and recalibrate if needed.', blocking: true },
  UNSUPPORTED_PAGE: { title: 'Page unsupported', explanation: 'Chrome does not allow HandFree to inject its pointer on this page.', recovery: 'Open a normal HTTPS page or continue in the Demo Lab.', blocking: true },
  CONTENT_SCRIPT_UNAVAILABLE: { title: 'Page bridge unavailable', explanation: 'The active page did not respond to HandFree.', recovery: 'Reload the page, then enable HandFree again.', blocking: true },
  TARGET_NOT_FOUND: { title: 'No interactive target', explanation: 'The pointer is not over an enabled interactive element.', recovery: 'Move to a button, link, form field, or accessible control.', blocking: false },
  ACTION_CANCELLED: { title: 'Action cancelled', explanation: 'HandFree cancelled the pending action for safety.', recovery: 'Release the gesture, reposition, and try again.', blocking: false },
  DUPLICATE_TRACKING_LOOP: { title: 'Duplicate tracking loop', explanation: 'A second camera inference loop was detected and stopped.', recovery: 'Stop and restart camera setup if tracking does not recover.', blocking: true },
  VOICE_UNAVAILABLE: { title: 'Voice unavailable', explanation: 'Voice controls cannot start in this browser session.', recovery: 'Use a supported Chrome build and allow microphone access.', blocking: true },
  STALE_POINTER_SOURCE: { title: 'Stale pointer source', explanation: 'HandFree ignored a pointer update from an inactive engine source.', recovery: 'Pause and resume interaction to reacquire the active source.', blocking: false },
  DUPLICATE_MESSAGE: { title: 'Duplicate runtime message', explanation: 'HandFree ignored a repeated command so it cannot trigger a second action.', recovery: 'Release the gesture and retry once.', blocking: false },
  ENGINE_STATE_CONFLICT: { title: 'Engine state conflict', explanation: 'The tracking engine received a command that does not match its current state.', recovery: 'Stop camera setup, then start it again.', blocking: true },
  NEW_TAB_CAMERA_NOT_CONNECTED: { title: 'New Tab camera is not connected', explanation: 'The HandFree New Tab has not received a live camera frame from the single camera owner.', recovery: 'Open Control Center, start camera setup, and keep it running while this tab is active.', blocking: true },
  NEW_TAB_TRACKER_NOT_CONNECTED: { title: 'New Tab tracker is not connected', explanation: 'The camera owner is not sending MediaPipe tracking updates to this New Tab.', recovery: 'Reconnect camera setup from Control Center, then return to this tab.', blocking: true },
  NEW_TAB_NO_POINTER_UPDATES: { title: 'No pointer updates', explanation: 'No calibrated fingertip or head coordinates have arrived recently.', recovery: 'Confirm tracking is detected, complete calibration if needed, and move into camera view.', blocking: true },
  NEW_TAB_CAMERA_PERMISSION_DENIED: { title: 'New Tab camera permission denied', explanation: 'The browser denied camera access for this extension-owned page.', recovery: 'Allow camera access for HandFree, then use Reconnect camera.', blocking: true },
  NEW_TAB_CAMERA_STREAM_EMPTY: { title: 'New Tab camera stream is empty', explanation: 'The camera owner reported no usable video tracks or frames.', recovery: 'Stop camera setup, close other camera users, and reconnect.', blocking: true },
  NEW_TAB_MODEL_NOT_READY: { title: 'Tracking model is not ready', explanation: 'MediaPipe is still loading or failed to initialize in the camera owner.', recovery: 'Wait for model loading to finish, or restart camera setup.', blocking: true },
  NEW_TAB_CALIBRATION_MISSING: { title: 'New Tab calibration is missing', explanation: 'No shared camera-to-viewport calibration is available for safe pointer mapping.', recovery: 'Open Control Center and complete the four-corner calibration once.', blocking: true },
  NEW_TAB_STALE_TRACKING: { title: 'New Tab tracking is stale', explanation: 'The last camera/tracking update is older than the safe interaction window.', recovery: 'Keep the camera owner open and reconnect tracking before activating controls.', blocking: true }
};

export function diagnostic(code: DiagnosticCode, module: string, timestamp = Date.now()): Diagnostic {
  return { code, module, timestamp, ...copy[code] };
}
