import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadSettings, subscribeToSettings } from '../shared/storage';
import { sendMessage } from '../shared/runtime';
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeMessage, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { diagnostic } from '../diagnostics/diagnostics';
import { TouchViewOverlay } from '../content/touchViewOverlay';

function formatTime(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now);
}

function formatDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

function cameraLabel(status: RuntimeStatus, localStream: boolean, cameraFrame: string): string {
  if (localStream) return 'Active · New Tab preview';
  if (status.permission === 'active' && status.cameraOwner === 'dashboard') return cameraFrame ? 'Active · Control Center owner' : 'Active · waiting for live frame';
  if (status.permission === 'prompt' || status.engineState === 'STARTING') return 'Starting';
  if (status.permission === 'denied') return 'Permission denied';
  if (status.permission === 'paused' || status.engineState === 'PAUSED') return 'Paused';
  if (status.diagnostic?.code.startsWith('NEW_TAB_CAMERA')) return 'Interrupted';
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
  const [cameraFrame, setCameraFrame] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState('TouchView is ready on this HandFree tab.');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoMetrics, setVideoMetrics] = useState({ readyState: 0, width: 0, height: 0, tracks: 0 });
  const overlayRef = useRef<TouchViewOverlay | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const releaseCameraLock = useRef<(() => void) | null>(null);
  const lastPointerAt = useRef(0);

  function updateStatus(next: Partial<RuntimeStatus>) {
    setStatus(current => ({ ...current, ...next }));
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

  function releaseLocalCamera() {
    const release = releaseCameraLock.current;
    if (release) {
      releaseCameraLock.current = null;
      release();
      return;
    }
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLocalStream(null);
    setVideoMetrics(current => ({ ...current, tracks: 0, readyState: 0, width: 0, height: 0 }));
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
        if (message.cameraFrame) setCameraFrame(message.cameraFrame);
        lastPointerAt.current = Date.now();
        updateStatus({ lastTrackingUpdate: Date.now() });
        overlayRef.current?.cameraFrame(message.cameraFrame);
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
    setVideoReady(Boolean(videoRef.current));
    return () => {
      alive = false;
      unsubscribe();
      chrome.runtime.onMessage.removeListener(onMessage);
      window.clearInterval(timer);
      releaseLocalCamera();
      overlayRef.current?.destroy();
      overlayRef.current = null;
    };
  }, []);

  async function reconnectCamera() {
    if (status.cameraOwner === 'dashboard' || status.engineState === 'RUNNING' || status.engineState === 'STARTING') {
      setNotice('The Control Center owns the single camera stream. Reconnect it there, then return to this tab.');
      await openControlCenter(true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !navigator.locks?.request) {
      const problem = diagnostic('NEW_TAB_CAMERA_NOT_CONNECTED', 'newtab.camera');
      updateStatus({ error: problem.explanation, diagnostic: problem });
      setNotice(`${problem.title}: ${problem.recovery}`);
      return;
    }
    await navigator.locks.request('handfree-dashboard-camera', { ifAvailable: true }, async lock => {
      if (!lock) {
        const problem = diagnostic('NEW_TAB_CAMERA_NOT_CONNECTED', 'newtab.camera');
        updateStatus({ error: problem.explanation, diagnostic: problem });
        setNotice(`${problem.title}: ${problem.recovery}`);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        const video = videoRef.current;
        if (!video) throw new Error('New Tab video element is unavailable.');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        localStreamRef.current = stream;
        setLocalStream(stream);
        setVideoMetrics({ readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, tracks: stream.getVideoTracks().length });
        updateStatus({ permission: 'active', cameraOwner: 'newtab', trackingOwner: 'none', cameraTrackCount: stream.getVideoTracks().length, cameraVideoWidth: video.videoWidth, cameraVideoHeight: video.videoHeight, error: undefined, diagnostic: undefined });
        setNotice('Camera active in this New Tab. Tracking remains owned by Control Center; use it to enable MediaPipe tracking.');
        await new Promise<void>(resolve => {
          releaseCameraLock.current = () => {
            localStreamRef.current?.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            if (videoRef.current) videoRef.current.srcObject = null;
            setLocalStream(null);
            setVideoMetrics(current => ({ ...current, tracks: 0, readyState: 0, width: 0, height: 0 }));
            resolve();
          };
        });
      } catch (error) {
        const problem = diagnostic(error instanceof DOMException && error.name === 'NotAllowedError' ? 'NEW_TAB_CAMERA_PERMISSION_DENIED' : 'NEW_TAB_CAMERA_STREAM_EMPTY', 'newtab.camera');
        updateStatus({ permission: error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'stopped', cameraOwner: 'none', error: problem.explanation, diagnostic: problem });
        setNotice(`${problem.title}: ${problem.recovery}`);
      }
    });
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
    releaseLocalCamera();
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
  const cameraState = cameraLabel(status, Boolean(localStream), cameraFrame);
  const trackingState = trackingLabel(status, lastPointerAt.current);
  const diagnosticText = status.diagnostic ? `${status.diagnostic.title}: ${status.diagnostic.explanation} ${status.diagnostic.recovery}` : '';

  return <main className="newtab-page">
    <video ref={videoRef} className="newtab-webcam-video" autoPlay muted playsInline aria-label="Live webcam background" style={{ opacity: localStream ? settings.touchViewCameraOpacity : 0 }} onLoadedMetadata={() => { setVideoReady(true); setVideoMetrics(current => ({ ...current, readyState: videoRef.current?.readyState ?? 0, width: videoRef.current?.videoWidth ?? 0, height: videoRef.current?.videoHeight ?? 0 })); }} />
    {cameraFrame && <img className="newtab-webcam" src={cameraFrame} alt="Live webcam background from Control Center" style={{ opacity: settings.touchViewCameraOpacity }} />}
    <div className="newtab-scrim" aria-hidden="true" style={{ opacity: settings.touchViewScrimOpacity }} />
    <section className="newtab-interface" style={{ opacity: settings.touchViewWebsiteOpacity }}>
      <header className="newtab-header"><div className="newtab-brand"><span className="newtab-logo" aria-hidden="true">+</span><div><strong>HandFree</strong><span>Accessible browser home</span></div></div><div className="newtab-clock"><strong>{formatTime(now)}</strong><span>{formatDate(now)}</span></div></header>
      <div className="newtab-hero"><span className="newtab-eyebrow">A calmer way to browse</span><h1>Move through the web at your own pace.</h1><p>Use your fingertip pointer to reach search, links and real controls. TouchView stays inside the page and keeps every action visible.</p><form className="newtab-search" onSubmit={submitSearch}><label htmlFor="handfree-newtab-search">Search the web</label><div><input id="handfree-newtab-search" name="query" placeholder="Search with TouchView" autoComplete="off" /><button type="submit">Search</button></div></form></div>
      <section className="newtab-status" aria-label="TouchView connection status"><div><span>Camera</span><strong>{cameraState}</strong></div><div><span>Tracking</span><strong>{trackingState}</strong></div><div><span>Calibration</span><strong>{settings.calibration ? `${Math.round(settings.calibration.quality * 100)}% ready` : 'Required'}</strong></div><div className="newtab-status-actions"><button className="newtab-button" onClick={() => void reconnectCamera()}>Reconnect camera</button><button className="newtab-button" onClick={() => void openControlCenter(true)}>Control Center</button></div></section>
      {diagnosticText && <p className="newtab-diagnostic" role="alert"><strong>{diagnosticText}</strong></p>}
      <section className="newtab-grid" aria-label="HandFree quick links"><article className="newtab-card"><span className="newtab-card-label">TouchView</span><h2>{enabled ? paused ? 'Paused' : 'Ready to point' : 'Off'}</h2><p>{enabled ? 'The overlay is available on this replacement New Tab page.' : 'Enable it here or open the Control Center to start the camera.'}</p><div className="newtab-actions"><button className="newtab-button newtab-button--primary" onClick={enabled ? togglePause : enableTouchView}>{enabled ? paused ? 'Resume TouchView' : 'Pause TouchView' : 'Enable TouchView'}</button><button className="newtab-button" onClick={() => void openControlCenter(!enabled)}>{enabled ? 'Open Control Center' : 'Start camera setup'}</button>{enabled && <button className="newtab-button newtab-button--danger" onClick={() => void stopCamera()}>Stop camera</button>}</div></article><article className="newtab-card"><span className="newtab-card-label">Calibration</span><h2>{settings.calibration ? `${Math.round(settings.calibration.quality * 100)}% mapped` : 'Not calibrated'}</h2><p>{settings.calibration ? settings.calibration.qualityStatus === 'estimated' ? 'Four-point map saved; optional validation is available.' : 'Shared calibration is ready across supported pages.' : 'Calibrate once in the Control Center and reuse it everywhere.'}</p><button className="newtab-link-button" onClick={() => void openControlCenter()}>Open calibration <span aria-hidden="true">→</span></button></article></section>
      <nav className="newtab-links" aria-label="Useful links"><a href="https://example.com">Example Domain</a><a href="https://www.wikipedia.org">Wikipedia</a><a href="https://github.com">GitHub</a><a href={chrome.runtime.getURL('demo.html')}>Demo Lab</a></nav>
      {notice && <p className="newtab-notice" role="status">{notice}</p>}
      <details className="newtab-debug"><summary>Connection diagnostics</summary><dl><dt>Video element</dt><dd>{videoReady ? 'ready' : 'present · waiting for metadata'}</dd><dt>Video source</dt><dd>{localStream ? 'MediaStream attached' : cameraFrame ? 'Control Center live frame bridge' : 'not connected'}</dd><dt>Video dimensions</dt><dd>{videoMetrics.width} × {videoMetrics.height}</dd><dt>Video ready state</dt><dd>{videoMetrics.readyState}</dd><dt>Camera tracks</dt><dd>{localStream ? videoMetrics.tracks : status.cameraTrackCount ?? 0}</dd><dt>Camera owner</dt><dd>{status.cameraOwner}</dd><dt>Tracking owner</dt><dd>{status.trackingOwner}</dd><dt>Last tracking update</dt><dd>{lastPointerAt.current ? new Date(lastPointerAt.current).toLocaleTimeString() : 'none'}</dd></dl></details>
    </section>
    <footer className="newtab-footer"><span>Camera opacity {Math.round(settings.touchViewCameraOpacity * 100)}%</span><span>Webpage opacity {Math.round(settings.touchViewWebsiteOpacity * 100)}%</span><button onClick={() => void openControlCenter()}>Settings</button></footer>
  </main>;
}
