import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, SectionHeading, StatusPill } from '../ui/AppShell';
import { Icon } from '../shared/icons';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { extensionUrl, findSupportedWebpageTab, sendMessage } from '../shared/runtime';
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type CalibrationData, type CalibrationGeometry, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { TrackingController, type TrackingCallbacks } from '../tracking/trackingController';
import { CALIBRATION_TARGETS, calibrationGeometryCompatible, mapCameraToViewport, mapCameraToViewportDebug, readCalibrationGeometry, type CoordinateMappingDebug, type CoordinatePoint } from '../tracking/coordinateMapping';
import { summarizeStableSamples, type CalibrationSample, type CalibrationStep } from '../tracking/calibration';
import { clearTrackingOverlay, drawTrackingOverlay } from './trackingOverlay';
import { AdvancedControls, SenseControls } from './AdvancedControls';
import { TouchViewControls } from '../ui/TouchViewControls';
import { CameraOwnership } from './cameraOwnership';
import { CameraThumbnail } from './cameraThumbnail';
import { CalibrationValidation, CALIBRATION_TEST_LABELS, CALIBRATION_TEST_POINTS, CALIBRATION_TOLERANCE, type CalibrationValidationSnapshot } from '../tracking/calibrationValidation';
import '../ui/touchview-polish.css';
import { diagnostic } from '../diagnostics/diagnostics';

const statusText: Record<RuntimeStatus['trackingPhase'], string> = { idle: 'Not started', 'camera-ready': 'Camera ready', 'loading-model': 'Loading face model', 'face-detected': 'Face detected', 'face-not-detected': 'Face not detected', tracking: 'Tracking', paused: 'Tracking paused', lost: 'Tracking lost', reinitializing: 'Reinitializing tracker', error: 'Tracking error' };

function Toggle({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

export function Dashboard() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  const [cameraList, setCameraList] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [notice, setNotice] = useState('');
  const [startingCamera, setStartingCamera] = useState(false);
  const [touchViewBusy, setTouchViewBusy] = useState(false);
  const cameraBusy = useRef(false);
  const cameraGeneration = useRef(0);
  const cameraOwnership = useRef(new CameraOwnership());
  const cameraThumbnail = useRef(new CameraThumbnail());
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('idle');
  const calibrationStepRef = useRef(calibrationStep);
  calibrationStepRef.current = calibrationStep;
  const validator = useRef(new CalibrationValidation());
  const [validationCount, setValidationCount] = useState(0);
  const [validationProgress, setValidationProgress] = useState(0);
  const [validationError, setValidationError] = useState(1);
  const [validationConfidence, setValidationConfidence] = useState(0);
  const [validationAverageError, setValidationAverageError] = useState(0);
  const [validationMaximumError, setValidationMaximumError] = useState(0);
  const [validationState, setValidationState] = useState<CalibrationValidationSnapshot['state']>('waiting');
  const [validationMessage, setValidationMessage] = useState('Hold your fingertip over the highlighted target until the progress completes.');
  const [calibrationInput, setCalibrationInput] = useState<'head' | 'hand'>('hand');
  const [sampleCount, setSampleCount] = useState(0);
  const [sampleStability, setSampleStability] = useState(1);
  const [sampleConfidence, setSampleConfidence] = useState(0);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureMessage, setCaptureMessage] = useState('Waiting for a stable tracked point.');
  const [cornerErrors, setCornerErrors] = useState<number[]>([]);
  const [validationQuality, setValidationQuality] = useState(0);
  const [calibrationMappingReady, setCalibrationMappingReady] = useState(false);
  const [rawCalibrationPoint, setRawCalibrationPoint] = useState<CoordinatePoint | null>(null);
  const [liveCalibrationPoint, setLiveCalibrationPoint] = useState<CoordinatePoint | null>(null);
  const [mappingDebug, setMappingDebug] = useState<CoordinateMappingDebug | null>(null);
  const [calibrationGeometryState, setCalibrationGeometryState] = useState<CalibrationGeometry | null>(null);
  const [calibrationHint, setCalibrationHint] = useState('Start when you are sitting comfortably in front of the camera.');
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const calibrationSurfaceRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<TrackingController | null>(null);
  const stableSamples = useRef<Record<'head' | 'hand', CalibrationSample[]>>({ head: [], hand: [] });
  const pendingCalibration = useRef<CalibrationData | null>(null);
  const calibrationSource = useRef<'head' | 'hand'>('hand');
  const calibrationTelemetryAt = useRef(0);
  const lossPauseSent = useRef(false);
  const validationSession = useRef(0);
  const validationActive = useRef(false);
  const calibrationFrame = useRef<number | null>(null);
  const mounted = useRef(true);

  function geometryForVideo(video: HTMLVideoElement): CalibrationGeometry {
    const calibrationWorkspace = calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'complete';
    // During calibration the video is promoted to a fixed viewport surface.
    // Use the document surface immediately, even on the first render before
    // the overlay ref is attached, so samples never inherit the card rect.
    return readCalibrationGeometry(video, window, calibrationWorkspace ? document.documentElement : calibrationSurfaceRef.current ?? video);
  }

  const persist = useCallback(async (patch: Partial<HandFreeSettings>) => {
    const next = { ...settings, ...patch };
    settingsRef.current = next;
    setSettings(next);
    trackerRef.current?.updateSettings(next);
    await saveSettings(next);
    await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch });
  }, [settings]);

  const callbacks = useMemo<TrackingCallbacks>(() => ({
    onStatus: (partial) => {
      setStatus((current) => ({ ...current, ...partial }));
      if (calibrationStepRef.current === 'test' && pendingCalibration.current) {
        const sourceMissing = calibrationSource.current === 'hand'
          ? partial.handTracking === 'lost'
          : partial.faceDetected === false || partial.trackingPhase === 'face-not-detected' || partial.trackingPhase === 'lost';
        const sourceDetected = calibrationSource.current === 'hand'
          ? partial.handTracking === 'tracking'
          : partial.faceDetected === true;
        if (sourceMissing) {
          validationActive.current = false;
          setValidationState('waiting');
          setValidationMessage(`Waiting for your ${calibrationSource.current === 'hand' ? 'hand' : 'face'} to be detected. Validation is paused; you can reacquire it or skip validation.`);
        } else if (sourceDetected && validator.current.completed < CALIBRATION_TEST_POINTS.length) {
          validationActive.current = true;
        }
      }
      if (!cameraOwnership.current.owned) return;
      if (partial.permission) void sendMessage({ type: 'PERMISSION_STATUS', permission: partial.permission, error: partial.error });
      const video = videoRef.current;
      const stream = trackerRef.current?.camera.currentStream;
      const cameraFrame = settingsRef.current.touchViewEnabled && !settingsRef.current.touchViewPaused
        ? cameraThumbnail.current.frame(video)
        : undefined;
      void sendMessage({ type: 'TRACKING_STATUS', status: {
        engineState: partial.engineState,
        pointerSource: partial.pointerSource,
        trackingPhase: partial.trackingPhase,
        faceDetected: partial.faceDetected,
        confidence: partial.confidence,
        error: partial.error,
        diagnostic: partial.diagnostic,
        handTracking: partial.handTracking,
        handConfidence: partial.handConfidence,
        cameraOwner: 'dashboard',
        trackingOwner: 'dashboard',
        cameraDeviceId: trackerRef.current?.camera.currentDeviceId,
        cameraVideoWidth: video?.videoWidth || undefined,
        cameraVideoHeight: video?.videoHeight || undefined,
        cameraTrackCount: stream?.getTracks().length ?? 0,
        lastTrackingUpdate: Date.now(),
        ...(cameraFrame ? { cameraFrame } : {})
      } });
      if (partial.trackingPhase === 'lost' && !settingsRef.current.enabledModes.includes('hand') && !lossPauseSent.current) {
        lossPauseSent.current = true;
        setNotice('Tracking lost. Interaction is paused until your face is detected and stabilized again.');
        void sendMessage({ type: 'PAUSE_INTERACTION', reason: 'Tracking lost' });
      }
      if (partial.trackingPhase === 'tracking' && partial.faceDetected && lossPauseSent.current) {
        lossPauseSent.current = false;
        void sendMessage({ type: 'RESUME_INTERACTION' });
        setNotice('Face reacquired and stabilized. Interaction resumed safely.');
      }
      if (partial.permission === 'stopped' && !trackerRef.current?.camera.currentStream) {
        cameraOwnership.current.release();
        cameraThumbnail.current.reset();
      }
    },
    onPointer: (position) => {
      if (calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'complete') {
        if (calibrationStepRef.current === 'test' && calibrationSource.current === 'head') validatePoint(position);
        return;
      }
      if (!settingsRef.current.enabledModes.includes('hand')) {
        const cameraFrame = settingsRef.current.touchViewEnabled && !settingsRef.current.touchViewPaused ? cameraThumbnail.current.frame(videoRef.current) : undefined;
        void sendMessage({ type: 'POINTER_UPDATE', position, ...(cameraFrame ? { cameraFrame } : {}) });
      }
    },
    onPosition: () => undefined,
    onCoordinate: (sample) => {
      const history = stableSamples.current[sample.source];
      history.push({ point: sample.point, confidence: sample.confidence, time: performance.now() });
      if (history.length > 16) history.shift();
      if (sample.source === calibrationSource.current && calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'complete') {
        setRawCalibrationPoint(sample.point);
        if (videoRef.current) {
          const geometry = geometryForVideo(videoRef.current);
          setMappingDebug(mapCameraToViewportDebug(sample.point, pendingCalibration.current ?? settingsRef.current.calibration, geometry, settingsRef.current.mirrorCamera));
        }
      }
      if (sample.source === calibrationSource.current && calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'test' && calibrationStepRef.current !== 'complete') {
        const now = performance.now();
        const summary = summarizeStableSamples(history, now);
        if (now - calibrationTelemetryAt.current > 45) {
          calibrationTelemetryAt.current = now;
          setSampleCount(summary.count);
          setSampleStability(summary.stability);
          setSampleConfidence(summary.confidence);
          setCaptureReady(summary.ready);
          setCaptureMessage(summary.reason === 'ready' ? 'Sample ready. Capture now.' : summary.reason === 'unstable' ? 'Sample rejected. Keep the tracked point steady.' : summary.reason === 'low-confidence' ? 'Tracking confidence is too low.' : summary.reason === 'stale' ? 'Tracking paused. Reacquiring a fresh point.' : summary.reason === 'warming' ? 'Hold steady… collecting samples.' : 'No tracked point detected.');
        }
        if (summary.point && videoRef.current) {
          const geometry = geometryForVideo(videoRef.current);
          setRawCalibrationPoint(summary.point);
          const mapped = mapCameraToViewport(summary.point, null, geometry, settingsRef.current.mirrorCamera);
          if (mapped) setLiveCalibrationPoint(mapped);
        }
      }
    },
    onHand: (position, gesture) => {
      if (calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'complete') {
        if (calibrationStepRef.current === 'test' && calibrationSource.current === 'hand') validatePoint(position);
        return;
      }
      if (settingsRef.current.enabledModes.includes('hand')) {
        const cameraFrame = settingsRef.current.touchViewEnabled && !settingsRef.current.touchViewPaused ? cameraThumbnail.current.frame(videoRef.current) : undefined;
        void sendMessage({ type: 'POINTER_UPDATE', position, gesture, ...(cameraFrame ? { cameraFrame } : {}) });
      }
    },
    onLandmarks: (frame) => drawTrackingOverlay(overlayRef.current, { ...frame, faceOpacity: settingsRef.current.touchViewFaceOpacity, handOpacity: settingsRef.current.touchViewHandOpacity, geometry: videoRef.current ? geometryForVideo(videoRef.current) : undefined, mirrored: settingsRef.current.mirrorCamera })
  }), []);

  function validatePoint(point: { x: number; y: number; confidence: number }) {
    if (!mounted.current || !validationActive.current || calibrationStepRef.current !== 'test') return;
    const previousCompleted = validator.current.completed;
    const snapshot = validator.current.update(point, point.confidence, performance.now());
    setLiveCalibrationPoint({ x: point.x, y: point.y });
    setValidationCount(snapshot.completed);
    setValidationProgress(snapshot.progress);
    setValidationError(snapshot.error);
    setValidationConfidence(snapshot.confidence);
    setValidationAverageError(snapshot.averageError);
    setValidationMaximumError(snapshot.maximumError);
    setValidationQuality(snapshot.quality);
    setValidationState(snapshot.state);
    const sourceLabel = calibrationSource.current === 'hand' ? 'fingertip' : 'head reference';
    if (snapshot.valid) {
      validationActive.current = false;
      setValidationMessage('Validation complete. All five positions are verified. Accept calibration when ready.');
      setNotice('Validation complete. The shared calibration is ready to accept.');
    } else if (snapshot.state === 'holding') {
      setValidationMessage(`Hold your ${sourceLabel} over the highlighted target until the progress completes.`);
    } else if (snapshot.state === 'outside-target') {
      setValidationMessage(`Move to the highlighted ${CALIBRATION_TEST_LABELS[snapshot.completed]} target.`);
    } else {
      setValidationMessage(`Hold your ${sourceLabel} over the highlighted target until the progress completes.`);
    }
    if (snapshot.completed > previousCompleted && snapshot.completed < snapshot.total) {
      setNotice(`Next validation target: ${CALIBRATION_TEST_LABELS[snapshot.completed]}.`);
    }
  }

  useEffect(() => {
    void loadSettings().then(setSettings);
    void sendMessage({ type: 'GET_STATE' }).then((response) => { if (response?.type === 'STATE_RESPONSE') { setSettings(response.settings); setStatus(response.status); } });
    void sendMessage({ type: 'GET_ACTIVE_TAB_STATUS' }).then((response) => { if (response?.type === 'ACTIVE_TAB_STATUS') setStatus((current) => ({ ...current, ...response.status })); });
    return subscribeToSettings(setSettings);
  }, []);

  useEffect(() => {
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (calibrationStepRef.current === 'idle' || calibrationStepRef.current === 'complete')) return;
      event.preventDefault();
      cancelCalibration();
      setNotice('Calibration cancelled with Escape. Your previous saved calibration was kept.');
    };
    window.addEventListener('keydown', cancelWithEscape);
    return () => window.removeEventListener('keydown', cancelWithEscape);
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    invalidateValidation();
  }, []);

  useEffect(() => {
    const tracker = new TrackingController(callbacks);
    const video = videoRef.current;
    trackerRef.current = tracker;
    const closeCamera = () => {
      cameraGeneration.current += 1;
      invalidateValidation();
      if (video && (cameraOwnership.current.owned || tracker.camera.currentStream)) tracker.destroy(video);
      if (!cameraBusy.current) cameraOwnership.current.release();
      cameraThumbnail.current.reset();
    };
    window.addEventListener('pagehide', closeCamera);
    return () => { window.removeEventListener('pagehide', closeCamera); closeCamera(); trackerRef.current = null; };
  }, [callbacks]);

  const updateStatus = (partial: Partial<RuntimeStatus>) => setStatus((current) => ({ ...current, ...partial }));

  useEffect(() => {
    trackerRef.current?.updateSettings(settings);
    // The side panel can enable TouchView before the dashboard owns a camera.
    if (settings.touchViewEnabled && settings.enabledModes.includes('hand') && !touchViewBusy && !trackerRef.current?.camera.currentStream && !cameraBusy.current) {
      void startCamera(settings);
    }
  }, [settings.touchViewEnabled, settings.enabledModes.join(','), touchViewBusy]);

  useEffect(() => {
    if (!settings.enabled && trackerRef.current?.camera.currentStream && !cameraBusy.current) stopCamera();
  }, [settings.enabled]);

  useEffect(() => {
    if (settings.enabledModes.includes(calibrationInput)) return;
    const fallback = settings.enabledModes.includes('hand') ? 'hand' : 'head';
    setCalibrationInput(fallback);
    calibrationSource.current = fallback;
  }, [settings.enabledModes.join(','), calibrationInput]);

  async function claimCamera(): Promise<boolean> {
    const result = await cameraOwnership.current.claim(navigator.locks);
    if (result === 'owned') return true;
    setNotice(result === 'busy'
      ? 'Another HandFree dashboard owns the camera. Return to that dashboard, or stop its camera before starting here.'
      : 'Camera ownership protection is unavailable in this browser context. Open the extension dashboard in a browser with Web Locks support.');
    return false;
  }

  async function startCamera(cameraSettings = settings): Promise<boolean> {
    const video = videoRef.current;
    const tracker = trackerRef.current;
    if (!video || !tracker || cameraBusy.current) return false;
    cameraBusy.current = true;
    const generation = cameraGeneration.current;
    setStartingCamera(true);
    try {
      if (!await claimCamera()) return false;
      if (generation !== cameraGeneration.current || trackerRef.current !== tracker) return false;
      drawTrackingOverlay(overlayRef.current, { face: null, hand: null, headEnabled: cameraSettings.enabledModes.includes('head'), handEnabled: cameraSettings.enabledModes.includes('hand'), faceOpacity: cameraSettings.touchViewFaceOpacity, handOpacity: cameraSettings.touchViewHandOpacity });
      updateStatus({ permission: 'prompt', trackingPhase: 'camera-ready', error: undefined });
      const cameras = await tracker.camera.listCameras();
      if (cameras) setCameraList(cameras);
      settingsRef.current = cameraSettings;
      await tracker.start(video, cameraSettings, selectedCamera || undefined);
      if (generation !== cameraGeneration.current || trackerRef.current !== tracker) {
        tracker.stop(video);
        return false;
      }
      const next = { ...cameraSettings, headControlEnabled: cameraSettings.enabledModes.includes('head'), enabled: true, paused: false };
      setSettings(next);
      tracker.updateSettings(next);
      await saveSettings(next);
      await sendMessage({ type: 'UPDATE_SETTINGS', settings: next });
      setNotice('Camera started. Keep your hand visible, then calibrate the four corners.');
      return true;
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      const code = denied ? 'CAMERA_PERMISSION_DENIED' : error instanceof DOMException && error.name === 'NotFoundError' ? 'CAMERA_UNAVAILABLE' : error instanceof DOMException && error.name === 'NotReadableError' ? 'CAMERA_ALREADY_IN_USE' : 'CAMERA_STREAM_FAILED';
      const detail = error instanceof Error ? error.message : 'Camera could not be started.';
      const problem = diagnostic(code, 'dashboard.camera');
      const message = denied ? problem.explanation : detail;
      if (!denied) tracker.stop(video);
      cameraOwnership.current.release();
      cameraThumbnail.current.reset();
      updateStatus({ permission: denied ? 'denied' : 'stopped', trackingPhase: 'error', error: message, diagnostic: problem });
      await sendMessage({ type: 'TRACKING_STATUS', status: { trackingPhase: 'error', error: `${error instanceof DOMException ? error.name + ': ' : ''}${detail}`, diagnostic: problem } });
      setNotice(`${problem.title}: ${detail}. ${problem.recovery}`);
      return false;
    } finally {
      if (!tracker.camera.currentStream) cameraOwnership.current.release();
      cameraBusy.current = false;
      setStartingCamera(false);
    }
  }

  function stopCamera() {
    lossPauseSent.current = false;
    if (calibrationStepRef.current !== 'idle' && calibrationStepRef.current !== 'complete') cancelCalibration();
    if (!cameraOwnership.current.owned && !trackerRef.current?.camera.currentStream) {
      setNotice('This dashboard has no camera stream. If another dashboard owns capture, use Stop camera there.');
      return;
    }
    cameraGeneration.current += 1;
    if (videoRef.current) trackerRef.current?.stop(videoRef.current);
    cameraOwnership.current.release();
    cameraThumbnail.current.reset();
    clearTrackingOverlay(overlayRef.current);
    void sendMessage({ type: 'DISABLE_TOUCHVIEW' });
    void persist({ headControlEnabled: false, enabled: false, touchViewEnabled: false, touchViewPaused: false, paused: false });
    setNotice('Camera stopped. No camera stream remains active.');
  }

  async function updateControlModes(patch: Partial<HandFreeSettings>) {
    const next = { ...settings, ...patch };
    settingsRef.current = next;
    setSettings(next);
    trackerRef.current?.updateSettings(next);
    await saveSettings(next);
    await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch });
    if (status.permission !== 'active' || !videoRef.current || !trackerRef.current || !patch.enabledModes || patch.enabledModes.join(',') === settings.enabledModes.join(',')) return true;
    try {
      await trackerRef.current.restart(videoRef.current, next);
      setNotice('Tracking modes updated. The active camera stream was kept running.');
      return true;
    } catch (error) {
      if (!trackerRef.current?.camera.currentStream) cameraOwnership.current.release();
      const message = error instanceof Error ? error.message : 'Tracking modes could not be updated.';
      updateStatus({ trackingPhase: 'error', error: message });
      setNotice(message);
      return false;
    }
  }

  async function setTouchView(enabled: boolean, pointerPatch?: Partial<HandFreeSettings>) {
    if (touchViewBusy) return;
    setTouchViewBusy(true);
    try {
      if (enabled && !await claimCamera()) return;
      const target = enabled ? await findSupportedWebpageTab() : undefined;
      if (enabled && target?.id === undefined) {
        setNotice('Open a normal HTTPS webpage in another tab, then enable TouchView.');
        return;
      }
      const response = enabled
        ? await sendMessage({ type: 'ENABLE_TOUCHVIEW', tabId: target!.id! })
        : await sendMessage({ type: 'DISABLE_TOUCHVIEW' });
      if (enabled && response?.type !== 'PAGE_SUPPORTED' && !(response?.type === 'STATE_RESPONSE' && response.settings.touchViewEnabled)) {
        setNotice(response?.type === 'PAGE_UNSUPPORTED' ? response.reason : response?.type === 'TOUCHVIEW_ERROR' ? response.reason : 'TouchView could not connect. Open a supported webpage and retry.');
        return;
      }
      const base = response?.type === 'STATE_RESPONSE' ? response.settings : settings;
      const next = { ...base, ...pointerPatch, touchViewEnabled: enabled, touchViewPaused: false, ...(enabled ? { enabled: true, paused: false, enabledModes: pointerPatch?.enabledModes ?? Array.from(new Set([...base.enabledModes, 'hand' as const])) } : {}) };
      if (enabled && status.permission !== 'active') {
        if (!await startCamera(next)) {
          await sendMessage({ type: 'DISABLE_TOUCHVIEW' });
          await persist({ touchViewEnabled: false, touchViewPaused: false });
          return;
        }
      } else if (!await updateControlModes(next)) {
        await sendMessage({ type: 'DISABLE_TOUCHVIEW' });
        await persist({ touchViewEnabled: false, touchViewPaused: false });
        return;
      }
      setStatus(current => ({ ...current, currentTabSupported: enabled ? true : current.currentTabSupported }));
      setNotice(enabled ? next.calibration ? 'TouchView connected. Check the shared mapping before interacting.' : 'TouchView connected, but calibration is required. Capture and validate all four corners before relying on pointer accuracy.' : 'TouchView disabled.');
    } finally {
      if (!trackerRef.current?.camera.currentStream) cameraOwnership.current.release();
      setTouchViewBusy(false);
    }
  }

  function togglePause() {
    lossPauseSent.current = false;
    const nextPaused = !settings.paused;
    void sendMessage({ type: nextPaused ? 'PAUSE_TOUCHVIEW' : 'RESUME_TOUCHVIEW' });
    void persist({ paused: nextPaused, touchViewPaused: nextPaused });
    if (nextPaused) { if (videoRef.current) trackerRef.current?.pause(videoRef.current); setNotice('Interaction paused. Dwell selection is cancelled immediately.'); }
    else { if (videoRef.current) trackerRef.current?.resume(videoRef.current); setNotice('Interaction resumed; stabilization is required before pointer movement continues.'); }
  }

  async function selectCalibrationSource(source: 'head' | 'hand') {
    setCalibrationInput(source);
    calibrationSource.current = source;
    if (!settings.enabledModes.includes(source)) {
      await updateControlModes({ enabledModes: Array.from(new Set([...settings.enabledModes, source])) });
    }
  }

  function beginValidation() {
    validationSession.current += 1;
    validationActive.current = true;
    return validationSession.current;
  }

  function invalidateValidation() {
    validationSession.current += 1;
    validationActive.current = false;
    if (calibrationFrame.current !== null) {
      cancelAnimationFrame(calibrationFrame.current);
      calibrationFrame.current = null;
    }
  }

  function resetValidationUi(message = 'Hold your fingertip over the highlighted target until the progress completes.') {
    validator.current = new CalibrationValidation();
    setValidationCount(0);
    setValidationProgress(0);
    setValidationError(1);
    setValidationConfidence(0);
    setValidationAverageError(0);
    setValidationMaximumError(0);
    setValidationQuality(0);
    setValidationState('waiting');
    setValidationMessage(message);
    setCornerErrors([]);
    setRawCalibrationPoint(null);
    setLiveCalibrationPoint(null);
    setMappingDebug(null);
  }

  async function startCalibration() {
    const video = videoRef.current;
    if (!video || !trackerRef.current) return;
    const input = calibrationInput;
    if (!settings.enabledModes.includes(input)) {
      await selectCalibrationSource(input);
      if (!settingsRef.current.enabledModes.includes(input)) {
        setNotice(`${input === 'hand' ? 'Hand' : 'Head'} tracking could not be enabled. Check the camera and retry.`);
        return;
      }
    }
    calibrationSource.current = input;
    invalidateValidation();
    pendingCalibration.current = null;
    setCalibrationMappingReady(false);
    resetValidationUi(`Hold your ${input === 'hand' ? 'fingertip' : 'head reference'} over the highlighted target until the progress completes.`);
    setSampleCount(0); setSampleStability(1); setSampleConfidence(0); setCaptureReady(false); setCaptureMessage('Waiting for a stable tracked point.');
    stableSamples.current = { head: [], hand: [] };
    trackerRef.current.updateSettings(settingsRef.current);
    setCalibrationStep('top-left');
    setCalibrationHint(`Move your ${input === 'hand' ? 'fingertip' : 'head reference'} to the top-left target, then keep it steady.`);
    // The calibration overlay becomes the camera surface on the next paint.
    // Capture its real geometry after that layout change so object-fit and
    // viewport mapping are based on the visible calibration workspace.
    const calibrationRun = validationSession.current;
    calibrationFrame.current = requestAnimationFrame(() => {
      calibrationFrame.current = null;
      const activeVideo = videoRef.current;
      if (!activeVideo || !trackerRef.current || validationSession.current !== calibrationRun || calibrationStepRef.current === 'idle') return;
      const geometry = geometryForVideo(activeVideo);
      setCalibrationGeometryState(geometry);
      trackerRef.current.calibration.begin({ mirrored: settingsRef.current.mirrorCamera, input, cameraDeviceId: trackerRef.current.camera.currentDeviceId, geometry });
    });
  }
  function captureCalibrationStep() {
    const tracker = trackerRef.current;
    const video = videoRef.current;
    const now = performance.now();
    const summary = summarizeStableSamples(stableSamples.current[calibrationSource.current], now);
    if (!tracker || !video || !summary.ready || !summary.point) { setCaptureReady(false); setNotice(summary.reason === 'unstable' ? 'Sample rejected. Move closer to the target and hold still.' : 'Hold the tracked point still until the live sample indicator is ready.'); return; }
    const point = summary.point;
    const next = tracker.calibration.capture(point, geometryForVideo(video));
    stableSamples.current = { head: [], hand: [] };
    setSampleCount(0); setSampleStability(1); setSampleConfidence(0); setCaptureReady(false); setCaptureMessage('Sample accepted. Move to the next target.');
    setCalibrationStep(next);
    const hints: Record<CalibrationStep, string> = { idle: '', 'top-left': 'Continue to the top-right marker.', 'top-right': 'Continue to the bottom-left marker.', 'bottom-left': 'Continue to the bottom-right marker.', 'bottom-right': 'All corners captured. Run the calibration test.', test: 'Test the cursor at the center and corners, then accept it.', complete: 'Calibration is ready and shared across HandFree modes.' };
    setCalibrationHint(hints[next]);
    if (next === 'test') {
      const calibration = tracker.calibration.save();
      if (!calibration) { setCalibrationStep('idle'); setNotice('Calibration quality is too low. Keep the camera steady and capture all four corners again.'); return; }
      pendingCalibration.current = calibration;
      setCalibrationMappingReady(true);
      tracker.updateSettings({ ...settingsRef.current, calibration, touchViewCalibration: calibration });
      beginValidation();
      setValidationMessage(`Hold your ${calibrationInput === 'hand' ? 'fingertip' : 'head reference'} over the highlighted target until the progress completes.`);
      setNotice('Calibration preview only. Test the center and corners, then accept to save it.');
    }
  }
  async function acceptCalibration(validationMode: 'passed' | 'skipped' = validator.current.valid ? 'passed' : 'skipped') {
    const calibration = pendingCalibration.current;
    const tracker = trackerRef.current;
    const video = videoRef.current;
    if (!calibration || !tracker || !video || !calibrationGeometryCompatible(calibration, geometryForVideo(video), tracker.camera.currentDeviceId, settings.mirrorCamera)) {
      setNotice('Camera or viewport changed. Recalibrate before saving.');
      return;
    }
    try {
      const passed = validationMode === 'passed' && validator.current.valid;
      const acceptedCalibration: CalibrationData = {
        ...calibration,
        validation: {
          errors: [...validator.current.errors],
          averageError: validator.current.averageError,
          maximumError: validator.current.maximumError,
          threshold: CALIBRATION_TOLERANCE,
          completed: validator.current.completed
        },
        validationStatus: passed ? 'passed' : 'skipped',
        qualityStatus: passed ? 'validated' : 'estimated'
      };
      await persist({ calibration: acceptedCalibration, touchViewCalibration: acceptedCalibration });
      tracker.updateSettings({ ...settingsRef.current, calibration: acceptedCalibration, touchViewCalibration: acceptedCalibration });
      await sendMessage({ type: 'CALIBRATION_UPDATED', calibration: acceptedCalibration });
      invalidateValidation();
      pendingCalibration.current = null;
      setCalibrationStep('complete');
      setCalibrationHint(passed ? 'Validated calibration saved for every mode.' : 'Calibration saved from the four-point map. Optional validation was skipped.');
      setNotice(passed
        ? `Shared calibration saved after your mapping test. Quality: ${Math.round(validationQuality * 100)}%. Average error: ${validationAverageErrorPercent}%.`
        : `Shared calibration saved with estimated quality (${Math.round(calibration.quality * 100)}%). You can run Test calibration any time.`);
    } catch (error) {
      cancelCalibration();
      setNotice(`Calibration could not be saved: ${error instanceof Error ? error.message : 'storage or messaging failed'}. Your previous calibration was kept.`);
    }
  }
  function cancelCalibration() {
    invalidateValidation();
    trackerRef.current?.calibration.reset();
    trackerRef.current?.updateSettings(settingsRef.current);
    pendingCalibration.current = null;
    setCalibrationMappingReady(false);
    resetValidationUi('Validation cancelled. Your previous saved calibration was kept.');
    setCalibrationStep('idle');
    setCalibrationGeometryState(null);
    setCaptureReady(false);
    setCalibrationHint('Calibration cancelled. Your previous saved calibration remains active.');
  }
  function testCalibration() {
    if (!settings.calibration || !videoRef.current || !trackerRef.current?.camera.currentStream) { setNotice('Start the camera and save a calibration before testing it.'); return; }
    pendingCalibration.current = settings.calibration;
    setCalibrationMappingReady(true);
    invalidateValidation();
    resetValidationUi(`Hold your ${calibrationInput === 'hand' ? 'fingertip' : 'head reference'} over the highlighted target until the progress completes.`);
    calibrationSource.current = calibrationInput;
    beginValidation();
    setCalibrationStep('test');
  }

  function changeModes(patch: Partial<HandFreeSettings>) {
    if (!settings.touchViewEnabled && (patch.headControlEnabled && !settings.headControlEnabled || patch.enabledModes?.includes('hand') && !settings.enabledModes.includes('hand'))) void setTouchView(true, patch);
    else void updateControlModes(patch);
  }
  function recenter() { trackerRef.current?.recenter(); void sendMessage({ type: 'RECENTER_POINTER' }); setNotice('Pointer recentered to the middle of the webpage.'); }

  const phase = statusText[status.trackingPhase];
  const trackingTone = status.trackingPhase === 'tracking' ? 'good' : ['lost', 'error'].includes(status.trackingPhase) ? 'bad' : status.trackingPhase === 'paused' ? 'warn' : 'neutral';
  const calibrationActive = calibrationStep !== 'idle' && calibrationStep !== 'complete';
  const calibrationDetected = calibrationInput === 'hand' ? status.handTracking === 'tracking' : status.faceDetected;
  const calibrationGeometry = calibrationGeometryState ?? (videoRef.current ? geometryForVideo(videoRef.current) : undefined);
  const calibrationTarget = calibrationStep === 'test' ? CALIBRATION_TEST_POINTS[validationCount] : calibrationStep !== 'idle' && calibrationStep !== 'complete' ? CALIBRATION_TARGETS[calibrationStep] : undefined;
  const validationComplete = validationCount >= CALIBRATION_TEST_POINTS.length;
  const validationPositionName = validationComplete ? 'Complete' : CALIBRATION_TEST_LABELS[validationCount];
  const validationErrorPercent = Math.round(validationError * 1000) / 10;
  const validationThresholdPercent = Math.round(CALIBRATION_TOLERANCE * 1000) / 10;
  const validationAverageErrorPercent = Math.round(validationAverageError * 1000) / 10;
  const validationMaximumErrorPercent = Math.round(validationMaximumError * 1000) / 10;
  const rawPointText = rawCalibrationPoint ? `${Math.round(rawCalibrationPoint.x * 100)}%, ${Math.round(rawCalibrationPoint.y * 100)}%` : 'waiting for a sample';
  const mappedPointText = liveCalibrationPoint ? `${Math.round(liveCalibrationPoint.x * 100)}%, ${Math.round(liveCalibrationPoint.y * 100)}%` : 'waiting for a sample';
  const correctedPointText = mappingDebug?.correctedCameraPoint ? `${Math.round(mappingDebug.correctedCameraPoint.x * 100)}%, ${Math.round(mappingDebug.correctedCameraPoint.y * 100)}%` : 'waiting for a sample';
  const calibrationInputText = mappingDebug?.calibrationInputPoint ? `${Math.round(mappingDebug.calibrationInputPoint.x * 100)}%, ${Math.round(mappingDebug.calibrationInputPoint.y * 100)}%` : 'waiting for a sample';
  const mappingFallbackText = mappingDebug ? `${mappingDebug.fallbackUsed ? 'yes' : 'no'}${mappingDebug.fallbackReason ? ` · ${mappingDebug.fallbackReason}` : ''}` : 'no';
  const targetPointText = calibrationTarget ? `${Math.round(calibrationTarget.x * 100)}%, ${Math.round(calibrationTarget.y * 100)}%` : 'none';

  return <AppShell headerStatus={<><StatusPill label={settings.touchViewEnabled ? settings.touchViewPaused ? 'TouchView paused' : 'TouchView enabled' : 'TouchView off'} tone={settings.touchViewEnabled ? 'good' : 'neutral'} /><StatusPill label={status.currentTabSupported ? 'Page supported' : 'Page unsupported'} tone={status.currentTabSupported ? 'good' : 'warn'} /></>}>
    <main className="dashboard-main">
      <section className="hero"><div><span className="eyebrow">TouchView control center</span><h1>Your hand. Your web.</h1><p>Enable TouchView, keep your hand in view, and calibrate once. Point to a webpage control and pinch or hold to select it.</p></div><div className="status-strip"><StatusPill label={settings.enabled ? 'HandFree on' : 'HandFree off'} tone={settings.enabled ? 'good' : 'neutral'} /><StatusPill label={phase} tone={trackingTone} /></div></section>
      {status.error && <div className="error-banner" role="alert"><Icon name="warning" /><span><strong>{status.diagnostic?.title ?? 'HandFree needs attention'}</strong><span>{status.diagnostic?.explanation ?? status.error}</span>{status.diagnostic?.recovery && <small>{status.diagnostic.recovery}</small>}</span></div>}
      {notice && <p className="notice" role="status"><Icon name="info" /><span>{notice}</span></p>}
      <TouchViewControls settings={settings} busy={touchViewBusy || startingCamera} setTouchView={setTouchView} onSettings={patch => void persist(patch)} />
      <div className="dashboard-grid">
        <div className="stack">
          <section className="card card--accent"><SectionHeading eyebrow="01 · Control" title="Main controls" description="Camera setup and optional head tracking share the TouchView overlay." /><div className="control-row"><div className="control-copy"><strong>HandFree enabled</strong><span>Allow the in-page pointer to receive tracking updates.</span></div><Toggle checked={settings.enabled} label="Enable HandFree" disabled={touchViewBusy || startingCamera} onChange={(value) => value ? void setTouchView(true, { enabledModes: settings.enabledModes }) : stopCamera()} /></div><div className="control-row"><div className="control-copy"><strong>Head Control</strong><span>Use face landmarks to move the virtual pointer. You can change this before or after camera setup.</span></div><Toggle checked={settings.headControlEnabled} label="Enable Head Control" disabled={touchViewBusy || startingCamera} onChange={(value) => changeModes({ headControlEnabled: value, enabledModes: value ? Array.from(new Set([...settings.enabledModes, 'head'])) : settings.enabledModes.filter(mode => mode !== 'head') })} /></div><div className="button-row" style={{ marginTop: 18 }}><button className="button button--primary" onClick={() => void startCamera()} disabled={status.permission === 'active' || startingCamera}><Icon name="camera" />{startingCamera ? 'Requesting camera permission…' : status.permission === 'active' ? 'Camera active' : 'Start camera setup'}</button><button className="button button--danger" onClick={stopCamera} disabled={status.permission !== 'active' && status.permission !== 'paused'}>Stop camera</button></div></section>
           <section className="card"><SectionHeading eyebrow="02 · Live view" title="Camera and tracking" description="The colored dots show live model landmarks: cyan for head tracking and green for hand tracking." /><div className="camera-layout"><div className={`camera-visual${calibrationActive ? ' camera-visual--calibrating' : ''}`}><video ref={videoRef} style={{ transform: settings.mirrorCamera ? 'scaleX(-1)' : 'none', opacity: settings.touchViewCameraOpacity }} playsInline aria-label="Live camera preview" /><canvas ref={overlayRef} className="tracking-overlay" aria-hidden="true" /><div className="tracking-legend" aria-live="polite">{settings.enabledModes.includes('head') && <span className={`tracking-chip ${status.faceDetected ? '' : 'tracking-chip--searching'}`}><span className="tracking-chip__dot" aria-hidden="true" />Head dots <span className="tracking-chip__state">{status.faceDetected ? 'detected' : status.permission === 'active' ? 'searching' : 'ready'}</span></span>}<span className={`tracking-chip tracking-chip--hand ${settings.enabledModes.includes('hand') && status.handTracking !== 'tracking' ? 'tracking-chip--searching' : ''}`}><span className="tracking-chip__dot" aria-hidden="true" />Hand dots <span className="tracking-chip__state">{!settings.enabledModes.includes('hand') ? 'off · enable TouchView' : status.handTracking === 'tracking' ? 'detected' : status.permission === 'active' ? 'searching' : 'ready'}</span></span></div>{status.permission === 'active' && <p className="tracking-capture-note">Live capture on · dots update with each camera frame</p>}{status.permission !== 'active' && <div className="camera-placeholder"><div><Icon name="camera" /><strong>{status.permission === 'denied' ? 'Permission needed' : 'Camera is off'}</strong><span>Choose Start camera setup to request access.</span></div></div>}</div><div className="camera-side">{cameraList.length > 0 && <label className="select-label">Camera<select disabled={status.permission === 'active' || startingCamera} title="Stop the camera before switching devices" value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)}>{cameraList.map((camera) => <option value={camera.deviceId} key={camera.deviceId}>{camera.label}</option>)}</select></label>}<div className="metric"><span>Camera</span><strong>{status.permission === 'active' ? 'Active' : status.permission === 'denied' ? 'Denied' : status.permission === 'unavailable' ? 'Unavailable' : 'Stopped'}</strong></div><div className="metric"><span>Face</span><strong>{status.faceDetected ? 'Detected' : 'Not detected'}</strong></div><div className="metric"><span>Hand</span><strong>{status.handTracking === 'tracking' ? 'Detected' : settings.enabledModes.includes('hand') ? 'Not detected' : 'Off'}</strong></div><div className="metric"><span>Estimated confidence</span><strong>{Math.round(status.confidence * 100)}%</strong><div className="quality-bar" aria-label={`Estimated tracking confidence ${Math.round(status.confidence * 100)} percent`}><span style={{ width: `${status.confidence * 100}%` }} /></div></div></div></div></section>
           <section className="card"><SectionHeading eyebrow="03 · Calibration" title="Calibrate once for every mode" description="The live camera and real face/hand coordinates are used to build one global mapping for TouchView, head tracking, hand tracking, and Demo Lab." /><p className="privacy-copy">Camera: {cameraList.find(camera => camera.deviceId === trackerRef.current?.camera.currentDeviceId)?.label ?? 'Not selected'} · Mirror: {settings.mirrorCamera ? 'On' : 'Off'} · Quality: {settings.calibration ? `${Math.round(settings.calibration.quality * 100)}%${settings.calibration.qualityStatus === 'estimated' ? ' · estimated' : ''}` : 'Required'} · Last saved: {settings.calibration ? new Date(settings.calibration.createdAt).toLocaleString() : 'Never'}</p><div className="calibration-source-control"><label className="select-label">Calibration source<select aria-label="Calibration source" value={calibrationInput} disabled={calibrationActive || startingCamera} onChange={(event) => void selectCalibrationSource(event.target.value as 'head' | 'hand')}><option value="hand">Hand · index fingertip</option><option value="head">Head · face reference</option></select></label><span className="calibration-source-status">{calibrationInput === 'hand' ? status.handTracking === 'tracking' ? 'Hand detected' : 'Hand not detected' : status.faceDetected ? 'Face detected' : 'Face not detected'}</span></div>{calibrationStep === 'idle' ? <div className="step-card"><span className="step-number">1</span><div><strong>{settings.calibration ? 'Shared calibration saved' : 'Capture four corners from the live camera'}</strong><p>Start the camera first, choose a real tracking source, then hold its landmark over each large target. Invalid or moving samples cannot be saved.</p><div className="button-row" style={{ marginTop: 12 }}><button className="button button--primary" onClick={() => void startCalibration()} disabled={status.permission !== 'active'}><Icon name="target" />Start calibration</button><button className="button" onClick={recenter} disabled={status.permission !== 'active'}><Icon name="crosshair" />Recenter</button><button className="button" onClick={testCalibration} disabled={!settings.calibration || status.permission !== 'active'}>Test calibration</button><button className="button button--danger" onClick={() => { cancelCalibration(); void persist({ calibration: null, touchViewCalibration: null }); }}>Reset calibration</button></div></div></div> : <div className="stack" style={{ gap: 14 }}><div className="step-card"><span className="step-number">{calibrationStep === 'complete' ? '✓' : calibrationStep === 'test' ? 'T' : ['top-left','top-right','bottom-left','bottom-right'].indexOf(calibrationStep) + 1}</span><div><strong>{calibrationStep === 'complete' ? 'Calibration complete' : calibrationStep === 'test' ? 'Test the mapping' : `Capture ${calibrationStep.replace('-', ' ')}`}</strong><p>{calibrationHint}</p></div></div><div className="calibration-sample-summary"><strong>{captureMessage}</strong><span>{sampleCount} samples · {Math.round(sampleConfidence * 100)}% confidence · {Math.round(sampleStability * 1000) / 10}% spread</span></div><div className="button-row"><button className="button button--primary" onClick={captureCalibrationStep} disabled={calibrationStep === 'test' || !captureReady}>{calibrationStep === 'test' ? 'Mapping ready' : 'Capture stable sample'}</button><button className="button" onClick={cancelCalibration}>Cancel</button>{calibrationStep === 'test' && <><button className="button button--primary" disabled={!calibrationMappingReady} onClick={() => void acceptCalibration()}>Accept calibration</button><button className="button" disabled={!calibrationMappingReady} onClick={() => void acceptCalibration('skipped')}>Skip validation</button></>}</div></div>}</section>
        </div>
        <aside className="stack"><section className="card"><SectionHeading eyebrow="Quick controls" title="Interaction" /><div className="control-row"><div className="control-copy"><strong>{settings.paused ? 'Resume interaction' : 'Pause interaction'}</strong><span>{settings.paused ? 'Wait for a stable face before movement resumes.' : 'Stops pointer actions and cancels dwell now.'}</span></div><button className="button" onClick={togglePause} disabled={!settings.enabled}><Icon name={settings.paused ? 'play' : 'pause'} />{settings.paused ? 'Resume' : 'Pause'}</button></div><div className="button-row" style={{ marginTop: 14 }}><button className="button" onClick={recenter}><Icon name="crosshair" />Recenter pointer</button><button className="button button--danger" onClick={stopCamera}>Emergency disable</button></div></section><section id="tuning" className="card"><SectionHeading eyebrow="Tuning" title="Comfort settings" description="Changes are saved locally and shared with the side panel." /><div className="slider-control"><label className="slider-label" htmlFor="sensitivity"><span>Sensitivity</span><output>{settings.sensitivity.toFixed(1)}×</output></label><input id="sensitivity" className="range" type="range" min=".5" max="1.8" step=".1" value={settings.sensitivity} onChange={(event) => void persist({ sensitivity: Number(event.target.value) })} /></div><div className="slider-control"><label className="slider-label" htmlFor="dwell"><span>Dwell duration</span><output>{settings.dwellDuration} ms</output></label><input id="dwell" className="range" type="range" min="500" max="2500" step="100" value={settings.dwellDuration} onChange={(event) => void persist({ dwellDuration: Number(event.target.value) })} /></div><div className="slider-control"><label className="slider-label" htmlFor="smoothing"><span>Pointer smoothing</span><output>{Math.round(settings.smoothing * 100)}%</output></label><input id="smoothing" className="range" type="range" min=".2" max=".92" step=".04" value={settings.smoothing} onChange={(event) => void persist({ smoothing: Number(event.target.value) })} /></div><div className="control-row"><div className="control-copy"><strong>Dwell selection</strong><span>Click only after the pointer stays on one valid target.</span></div><Toggle checked={settings.dwellEnabled} label="Enable dwell selection" onChange={(value) => void persist({ dwellEnabled: value })} /></div></section><section className="card"><SectionHeading eyebrow="Try it safely" title="Demo Lab" description="A small page with real controls for testing highlighting, dwell cancellation, and repeat-click prevention." /><a className="link-card" href={extensionUrl('demo.html')}><span><strong>Open HandFree Demo Lab</strong><span>Buttons, a form, and closely spaced targets.</span></span><Icon name="arrow" /></a></section><section className="card"><div className="notice"><Icon name="shield" /><span className="privacy-copy"><strong>Privacy by default.</strong> One dashboard owns the camera at a time. Use Stop camera to end capture. While TouchView is enabled, pointer coordinates and a small camera thumbnail are sent to the connected webpage.</span></div></section></aside>
      </div>
      <SenseControls settings={settings} onSettings={patch => void persist(patch)} />
      <section className="card" id="help"><h2>Demo Lab guides</h2><details><summary>TouchView, hand and head control</summary><p>Open a supported webpage before opening the dashboard. Enable TouchView and keep this camera tab open. Hand mode takes priority when both hand and head are on. Pinch and hold steadily to activate once; release before repeating. Head mode uses dwell when hand mode is off.</p></details><details><summary>Calibration and recovery</summary><p>Capture four stable corners, then optionally test the center and each test corner. Accept saves a valid four-point map immediately; Skip validation records estimated quality. Stop the camera before changing its device. Changing mirror orientation requires recalibration. Pause cancels activation; exit removes the overlay. Browser settings, protected pages and native Windows apps are not supported. Desktop control requires a separate companion agent.</p></details><details><summary>Voice, dictation and Sense</summary><p>Use Start voice commands, then say focus full name, start dictation, stop dictation, next field, clear field, review form or confirm. Dictation enters only final transcripts. Demo form submissions stay local. HandFree Sense reads actual page headings and important content; it is not a screen reader replacement.</p></details></section>
      <details className="secondary-controls"><summary>More controls <span>Head pointer, experimental voice, page reading, and diagnostics</span></summary><div className="advanced-grid"><AdvancedControls settings={settings} status={status} onSettings={(patch) => void (patch.enabledModes ? changeModes(patch) : persist(patch))} onStatus={updateStatus} /></div></details>
      {calibrationActive && <div ref={calibrationSurfaceRef} className="global-calibration-overlay" role="dialog" aria-label="Global HandFree calibration"><button className="button calibration-overlay-close" onClick={cancelCalibration} aria-label="Exit calibration">Exit calibration</button><div className="calibration-status-strip" role="status"><strong>Calibration workspace</strong><span>Camera: {status.permission === 'active' ? 'active' : status.permission}</span><span>Tracking: {calibrationDetected ? 'ready' : calibrationInput === 'hand' ? 'hand not detected' : 'face not detected'}</span><span>Source: {calibrationInput === 'hand' ? 'hand fingertip' : 'head reference'}</span><span>Mirror: {settings.mirrorCamera ? 'on' : 'off'}</span></div>{calibrationTarget && <div className={`global-calibration-target${captureReady ? ' global-calibration-target--ready' : ''}${calibrationStep === 'test' ? ' global-validation-target' : ''}`} style={{ left: `${calibrationTarget.x * 100}%`, top: `${calibrationTarget.y * 100}%` }}>{calibrationStep === 'test' ? <><div className="validation-target-ring" style={{ background: `conic-gradient(#4ade80 ${validationProgress * 100}%, rgba(125,211,252,.2) 0)` }}><div className="validation-target-core"><strong>{Math.round(validationProgress * 100)}%</strong><span>hold</span></div></div><span className="validation-target-label">{validationPositionName}</span></> : <span />}</div>}{liveCalibrationPoint && <div className="calibration-live-pointer" style={{ left: `${liveCalibrationPoint.x * 100}%`, top: `${liveCalibrationPoint.y * 100}%` }} aria-label="Live tracked pointer" />}<div className="calibration-debug" aria-live="polite"><strong>Live mapping debug</strong><span>Camera: {videoRef.current?.videoWidth || 0} × {videoRef.current?.videoHeight || 0}</span><span>Display: {Math.round(calibrationGeometry?.displayWidth ?? 0)} × {Math.round(calibrationGeometry?.displayHeight ?? 0)}</span><span>Surface: {Math.round(calibrationGeometry?.surfaceWidth ?? 0)} × {Math.round(calibrationGeometry?.surfaceHeight ?? 0)}</span><span>DPR: {window.devicePixelRatio || 1} · Mirror: {settings.mirrorCamera ? 'on' : 'off'}</span><span>Source: {calibrationInput === 'hand' ? 'hand fingertip' : 'head reference'}</span><span>Raw landmark: {rawPointText}</span><span>Mapped pointer: {mappedPointText}</span><span>Target: {targetPointText} · Error: {calibrationStep === 'test' ? `${validationErrorPercent}%` : 'n/a'}</span><span>Validation: {calibrationStep === 'test' ? `${validationPositionName} · ${validationCount + (validationComplete ? 0 : 1)} of 5 · ${Math.round(validationProgress * 100)}% · ${validationState}` : calibrationStep.replace('-', ' ')}</span><span>Session: {validationSession.current}</span></div>{calibrationStep !== 'test' ? <div className="global-calibration-panel"><strong>Move your {calibrationInput === 'hand' ? 'fingertip' : 'head reference'} to the {calibrationStep.replace('-', ' ')} target</strong><span>{calibrationHint}</span><span className="calibration-live-status">{captureMessage} · {sampleCount} samples · {Math.round(sampleConfidence * 100)}% confidence · {Math.round(sampleStability * 1000) / 10}% spread</span><button className="button button--primary" disabled={!captureReady} onClick={captureCalibrationStep}>{captureReady ? 'Capture stable sample' : 'Hold steady to enable capture'}</button><button className="button" onClick={cancelCalibration}>Cancel calibration</button></div> : <div className="global-calibration-test" role="dialog" aria-label="Test global calibration"><strong>{validationComplete ? 'Validation complete' : 'Four-point mapping ready · validation optional'}</strong><span>{validationComplete ? '5 of 5 positions verified' : 'Four corners captured · calibration can be accepted now'}</span><span>{validationComplete ? 'All targets were held within the required accuracy.' : `Position ${validationCount + 1} of 5: ${validationPositionName}`}</span><span>{validationComplete ? 'Calibration quality: ' + (validationQuality >= .8 ? 'Good' : validationQuality >= .55 ? 'Acceptable' : 'Low') : validationMessage}</span><div className="validation-progress-bar" aria-label={`Validation progress ${Math.round(validationProgress * 100)} percent`}><span style={{ width: `${validationProgress * 100}%` }} /></div><span>Current error: {validationErrorPercent}% · Required accuracy: ≤ {validationThresholdPercent}% · Confidence: {Math.round(validationConfidence * 100)}%</span><span>Average error: {validationAverageErrorPercent}% · Maximum error: {validationMaximumErrorPercent}% · Mapping quality: {Math.round((pendingCalibration.current?.quality ?? 0) * 100)}% · Validation quality: {Math.round(validationQuality * 100)}%</span><span className="calibration-live-status">{validationComplete ? 'Validation complete. Accept calibration is available.' : `Hold your ${calibrationInput === 'hand' ? 'fingertip' : 'head reference'} over the highlighted target to test it, or accept the four-point map now.`}</span><button className="button button--primary" disabled={!calibrationMappingReady} onClick={() => void acceptCalibration()}>{validationComplete ? 'Accept validated calibration' : 'Accept calibration'}</button><button className="button" disabled={!calibrationMappingReady} onClick={() => void acceptCalibration('skipped')}>Skip validation</button><button className="button" onClick={cancelCalibration}>Cancel validation</button><button className="button" onClick={() => void startCalibration()}>Recalibrate</button><button className="button button--danger" onClick={cancelCalibration}>Exit calibration</button></div>}</div>}
      <p className="live-region" aria-live="polite">{phase}. {status.faceDetected ? 'Face detected.' : 'Face not detected.'}</p>
    </main>
  </AppShell>;
}
