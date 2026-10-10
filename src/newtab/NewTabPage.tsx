import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadSettings, subscribeToSettings } from '../shared/storage';
import { sendMessage } from '../shared/runtime';
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeMessage, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { normalizeRuntimeStatus } from '../shared/sessionState';
import { TouchViewOverlay } from '../content/touchViewOverlay';

function formatTime(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now);
}

function formatDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

function cameraLabel(status: RuntimeStatus, cameraFrame: boolean): string {
  if (status.cameraState === 'active') return cameraFrame ? 'Active · Control Center owner' : 'Active · waiting for live frame';
  if (status.cameraState === 'requesting') return 'Starting';
  if (status.cameraState === 'error' || status.permission === 'denied') return 'Camera unavailable';
  if (status.cameraState === 'paused') return 'Paused';
  return 'Stopped';
}

function trackingLabel(status: RuntimeStatus, pointerAt: number): string {
  if (status.handTracking === 'tracking') return 'Hand detected';
  if (status.faceDetected) return 'Face detected';
  if (status.trackingPhase === 'tracking') return 'Ready';
  if (status.trackingPhase === 'loading-model') return 'Loading model';
  if (status.trackingPhase === 'lost' || status.trackingPhase === 'face-not-detected' || status.trackingPhase === 'error') return 'Interrupted';
  if (pointerAt && Date.now() - pointerAt > 1500) return 'Interrupted';
  return status.engineState === 'STOPPED' ? 'Stopped' : 'Waiting for tracking';
}

export function NewTabPage() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [status, setStatus] = useState<RuntimeStatus>({ ...DEFAULT_STATUS });
  const statusRef = useRef(status);
  statusRef.current = status;
  const [hasCameraFrame, setHasCameraFrame] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState('TouchView is ready on this HandFree tab.');
  const overlayRef = useRef<TouchViewOverlay | null>(null);
  const lastPointerAt = useRef(0);
  const cameraFrameRef = useRef('');
  const webcamBridgeRef = useRef<HTMLImageElement>(null);
  const lastStatusPaintAt = useRef(0);

  function updateStatus(next: Partial<RuntimeStatus>) {
    const now = performance.now();
    const meaningful = next.error || next.diagnostic || (['cameraOwner', 'engineState', 'handTracking', 'trackingPhase'] as const).some(key => next[key] !== undefined && next[key] !== statusRef.current[key]);
    if (now - lastStatusPaintAt.current < 125 && !meaningful) return;
    lastStatusPaintAt.current = now;
    const merged = normalizeRuntimeStatus(statusRef.current, next);
    statusRef.current = merged;
    setStatus(merged);
  }

  function setCameraFrame(frame: string): void {
    if (!frame || frame === cameraFrameRef.current) return;
    cameraFrameRef.current = frame;
    if (webcamBridgeRef.current) webcamBridgeRef.current.src = frame;
    if (!hasCameraFrame) setHasCameraFrame(true);
  }

  function applySettings(next: HandFreeSettings) {
    settingsRef.current = next;
    setSettings(next);
    if (next.touchViewEnabled) {
      overlayRef.current ??= new TouchViewOverlay(next);
      overlayRef.current.configure(next);
      overlayRef.current.pause(Boolean(next.touchViewPaused || next.paused));
    } else if (overlayRef.current) {
      overlayRef.current.destroy();
      overlayRef.current = null;
    }
  }

  useEffect(() => {
    let alive = true;
    void loadSettings().then(next => { if (alive) applySettings(next); });
    const unsubscribe = subscribeToSettings(applySettings);
    const onMessage = (message: HandFreeMessage) => {
      if (message.type === 'NEW_TAB_STATE') {
        applySettings(message.settings);
        if (message.status) updateStatus(message.status);
      }
      if (message.type === 'NEW_TAB_CAMERA_FRAME') {
        if (message.frame) {
          setCameraFrame(message.frame);
          lastPointerAt.current = Date.now();
          overlayRef.current?.cameraFrame(message.frame);
        }
        if (message.status) updateStatus(message.status);
      }
      if (message.type === 'TRACKING_STATUS') {
        const { cameraFrame: frame, ...trackingStatus } = message.status;
        if (frame) {
          setCameraFrame(frame);
          lastPointerAt.current = Date.now();
        }
        updateStatus(trackingStatus);
        overlayRef.current?.trackingStatus(trackingStatus);
      }
      if (message.type === 'NEW_TAB_POINTER_UPDATE' && settingsRef.current.touchViewEnabled) {
        lastPointerAt.current = Date.now();
        overlayRef.current?.update(message.position, message.gesture);
      }
      if (message.type === 'CALIBRATION_UPDATED') {
        const next = { ...settingsRef.current, calibration: message.calibration, touchViewCalibration: message.calibration };
        applySettings(next);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void sendMessage({ type: 'NEW_TAB_READY' }).then(response => {
      if (response?.type === 'NEW_TAB_STATE') {
        applySettings(response.settings);
        if (response.status) updateStatus(response.status);
      }
    });
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      alive = false;
      unsubscribe();
      chrome.runtime.onMessage.removeListener(onMessage);
      window.clearInterval(timer);
      overlayRef.current?.destroy();
      overlayRef.current = null;
    };
  }, []);

  async function reconnectCamera() {
    setNotice('The Control Center owns the shared camera. Reconnecting it there…');
    await openControlCenter(true);
  }

  async function enableTouchView() {
    const current = await chrome.tabs.getCurrent();
    const response = await sendMessage({ type: 'ENABLE_TOUCHVIEW', tabId: current?.id });
    if (response?.type === 'PAGE_SUPPORTED') setNotice('TouchView enabled. Start the camera from Control Center to send live tracking here.');
    else setNotice(response?.type === 'PAGE_UNSUPPORTED' ? response.reason : 'TouchView could not be enabled on this tab.');
  }

  async function openControlCenter(start = false) {
    if (start) await sendMessage({ type: 'ENABLE_HAND_FREE', settings: { enabled: true, touchViewEnabled: true, enabledModes: ['hand', 'touchview'] } });
    await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }

  async function stopCamera() {
    await sendMessage({ type: 'DISABLE_HAND_FREE' });
    setNotice('Camera stopped. TouchView is disabled and the page remains usable normally.');
  }

  async function togglePause() {
    await sendMessage({ type: settings.touchViewPaused || settings.paused ? 'RESUME_TOUCHVIEW' : 'PAUSE_TOUCHVIEW' });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get('query') ?? '').trim();
    if (query) window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  const enabled = settings.touchViewEnabled;
  const paused = settings.touchViewPaused || settings.paused;
  const cameraState = cameraLabel(status, hasCameraFrame);
  const trackingState = trackingLabel(status, lastPointerAt.current);
  const diagnosticText = status.diagnostic ? `${status.diagnostic.title}: ${status.diagnostic.explanation} ${status.diagnostic.recovery}` : '';

  return <main className="newtab-page">
    <video className="newtab-webcam-video" autoPlay muted playsInline aria-label="Shared webcam preview" style={{ opacity: 0 }} />
    <img ref={webcamBridgeRef} className="newtab-webcam" alt="Live webcam background from Control Center" style={{ opacity: settings.touchViewCameraOpacity, display: hasCameraFrame ? 'block' : 'none' }} />
    <div className="newtab-scrim" aria-hidden="true" style={{ opacity: settings.touchViewScrimOpacity }} />
    <section className="newtab-interface" style={{ opacity: settings.touchViewWebsiteOpacity }}>
      <header className="newtab-header"><div className="newtab-brand"><span className="newtab-logo" aria-hidden="true">+</span><div><strong>HandFree</strong><span>Accessible browser home</span></div></div><div className="newtab-clock"><strong>{formatTime(now)}</strong><span>{formatDate(now)}</span></div></header>
      <div className="newtab-hero"><span className="newtab-eyebrow">A calmer way to browse</span><h1>Move through the web at your own pace.</h1><p>Use your fingertip pointer to reach search, links and real controls. TouchView stays inside the page and keeps every action visible.</p><form className="newtab-search" onSubmit={submitSearch}><label htmlFor="handfree-newtab-search">Search the web</label><div><input id="handfree-newtab-search" name="query" placeholder="Search with TouchView" autoComplete="off" /><button type="submit">Search</button></div></form></div>
      <section className="newtab-status" aria-label="TouchView connection status"><div><span>Camera</span><strong>{cameraState}</strong></div><div><span>Tracking</span><strong>{trackingState}</strong></div><div><span>Calibration</span><strong>{settings.calibration ? `${Math.round(settings.calibration.quality * 100)}% ready` : 'Required'}</strong></div><div className="newtab-status-actions"><button className="newtab-button" onClick={() => void reconnectCamera()}>Reconnect camera</button><button className="newtab-button" onClick={() => void openControlCenter(true)}>Control Center</button></div></section>
      {diagnosticText && <p className="newtab-diagnostic" role="alert"><strong>{diagnosticText}</strong></p>}
      <section className="newtab-grid" aria-label="HandFree quick links"><article className="newtab-card"><span className="newtab-card-label">TouchView</span><h2>{enabled ? paused ? 'Paused' : 'Ready to point' : 'Off'}</h2><p>{enabled ? 'The overlay is available on this replacement New Tab page.' : 'Enable it here or open the Control Center to start the camera.'}</p><div className="newtab-actions"><button className="newtab-button newtab-button--primary" onClick={enabled ? togglePause : enableTouchView}>{enabled ? paused ? 'Resume TouchView' : 'Pause TouchView' : 'Enable TouchView'}</button><button className="newtab-button" onClick={() => void openControlCenter(!enabled)}>{enabled ? 'Open Control Center' : 'Start camera setup'}</button>{enabled && <button className="newtab-button newtab-button--danger" onClick={() => void stopCamera()}>Stop camera</button>}</div></article><article className="newtab-card"><span className="newtab-card-label">Calibration</span><h2>{settings.calibration ? `${Math.round(settings.calibration.quality * 100)}% mapped` : 'Not calibrated'}</h2><p>{settings.calibration ? settings.calibration.qualityStatus === 'estimated' ? 'Four-point map saved; optional validation is available.' : 'Shared calibration is ready across supported pages.' : 'Calibrate once in the Control Center and reuse it everywhere.'}</p><button className="newtab-link-button" onClick={() => void openControlCenter()}>Open calibration <span aria-hidden="true">→</span></button></article></section>
      <nav className="newtab-links" aria-label="Useful links"><a href="https://example.com">Example Domain</a><a href="https://www.wikipedia.org">Wikipedia</a><a href="https://github.com">GitHub</a><a href={chrome.runtime.getURL('demo.html')}>Demo Lab</a></nav>
      {notice && <p className="newtab-notice" role="status">{notice}</p>}
      <details className="newtab-debug"><summary>Connection diagnostics</summary><dl><dt>Video source</dt><dd>{hasCameraFrame ? 'Control Center live frame bridge' : 'not connected'}</dd><dt>Video dimensions</dt><dd>{status.cameraVideoWidth ?? 0} × {status.cameraVideoHeight ?? 0}</dd><dt>Camera tracks</dt><dd>{status.cameraTrackCount ?? 0}</dd><dt>Camera owner</dt><dd>{status.cameraOwner}</dd><dt>Tracking owner</dt><dd>{status.trackingOwner}</dd><dt>Last tracking update</dt><dd>{lastPointerAt.current ? new Date(lastPointerAt.current).toLocaleTimeString() : 'none'}</dd>{status.performance && <><dt>Video FPS</dt><dd>{status.performance.videoFps.toFixed(1)}</dd><dt>Face inference FPS</dt><dd>{status.performance.faceInferenceFps.toFixed(1)} · {status.performance.faceInferenceMs.toFixed(1)} ms</dd><dt>Hand inference FPS</dt><dd>{status.performance.handInferenceFps.toFixed(1)} · {status.performance.handInferenceMs.toFixed(1)} ms</dd><dt>Pointer FPS</dt><dd>{status.performance.pointerFps.toFixed(1)}</dd><dt>Render FPS</dt><dd>{status.performance.renderFps.toFixed(1)}</dd><dt>Active animation loops</dt><dd>{status.performance.activeAnimationLoops}</dd><dt>Average inference</dt><dd>{status.performance.averageInferenceMs.toFixed(1)} ms</dd><dt>Active camera streams</dt><dd>{status.performance.activeCameraStreams}</dd><dt>Active tracking loops</dt><dd>{status.performance.activeTrackingLoops}</dd><dt>Active MediaPipe loops</dt><dd>{status.performance.activeMediaPipeLoops}</dd><dt>Dropped frames</dt><dd>{status.performance.droppedFrames}</dd><dt>Message rate</dt><dd>{status.performance.messageSendRate.toFixed(1)}/s</dd><dt>Main-thread block</dt><dd>{status.performance.mainThreadBlockingMs.toFixed(1)} ms</dd></>}</dl></details>
    </section>
    <footer className="newtab-footer"><span>Camera opacity {Math.round(settings.touchViewCameraOpacity * 100)}%</span><span>Webpage opacity {Math.round(settings.touchViewWebsiteOpacity * 100)}%</span><button onClick={() => void openControlCenter()}>Settings</button></footer>
  </main>;
}
