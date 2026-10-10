import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, SectionHeading, StatusPill } from '../ui/AppShell';
import { Icon } from '../shared/icons';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { extensionUrl, sendMessage } from '../shared/runtime';
import { DEFAULT_STATUS, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { TrackingController, type TrackingCallbacks } from '../tracking/trackingController';

const statusText: Record<RuntimeStatus['trackingPhase'], string> = { idle: 'Not started', 'camera-ready': 'Camera ready', 'loading-model': 'Loading face model', 'face-detected': 'Face detected', 'face-not-detected': 'Face not detected', tracking: 'Tracking', paused: 'Tracking paused', lost: 'Tracking lost', reinitializing: 'Reinitializing tracker', error: 'Tracking error' };

function Toggle({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

export function Dashboard() {
  const [settings, setSettings] = useState<HandFreeSettings>({ enabled: false, paused: false, headControlEnabled: false, sensitivity: 1, smoothing: .72, dwellDuration: 1200, dwellEnabled: true, cooldownDuration: 900, deadZone: .08, calibration: null });
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  const [cameraList, setCameraList] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [notice, setNotice] = useState('');
  const [startingCamera, setStartingCamera] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<'idle' | 'neutral' | 'left' | 'right' | 'up' | 'down' | 'target' | 'complete'>('idle');
  const [calibrationHint, setCalibrationHint] = useState('Start when you are sitting comfortably in front of the camera.');
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<TrackingController | null>(null);
  const latestPosition = useRef({ x: 0, y: 0 });
  const lossPauseSent = useRef(false);

  const persist = useCallback(async (patch: Partial<HandFreeSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
    await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch });
  }, [settings]);

  const callbacks = useMemo<TrackingCallbacks>(() => ({
    onStatus: (partial) => {
      setStatus((current) => ({ ...current, ...partial }));
      if (partial.trackingPhase === 'lost' && !lossPauseSent.current) {
        lossPauseSent.current = true;
        setNotice('Tracking lost. Interaction is paused until your face is detected and stabilized again.');
        void sendMessage({ type: 'PAUSE_INTERACTION', reason: 'Tracking lost' });
      }
      if (partial.trackingPhase === 'tracking' && partial.faceDetected) lossPauseSent.current = false;
    },
    onPointer: (position) => void sendMessage({ type: 'POINTER_MOVEMENT', position }),
    onPosition: (position) => { latestPosition.current = position; }
  }), []);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void sendMessage({ type: 'GET_STATE' }).then((response) => { if (response?.type === 'STATE_RESPONSE') { setSettings(response.settings); setStatus(response.status); } });
    void sendMessage({ type: 'GET_ACTIVE_TAB_STATUS' }).then((response) => { if (response?.type === 'ACTIVE_TAB_STATUS') setStatus((current) => ({ ...current, ...response.status })); });
    return subscribeToSettings(setSettings);
  }, []);

  useEffect(() => {
    trackerRef.current = new TrackingController(callbacks);
    return () => { if (videoRef.current) trackerRef.current?.destroy(videoRef.current); trackerRef.current = null; };
  }, [callbacks]);

  const updateStatus = (partial: Partial<RuntimeStatus>) => setStatus((current) => ({ ...current, ...partial }));

  async function startCamera() {
    const video = videoRef.current;
    const tracker = trackerRef.current;
    if (!video || !tracker || startingCamera) return;
    setStartingCamera(true);
    try {
      updateStatus({ permission: 'prompt', trackingPhase: 'camera-ready', error: undefined });
      const cameras = await tracker.camera.listCameras();
      if (cameras) setCameraList(cameras);
      await tracker.start(video, settings, selectedCamera || undefined);
      await persist({ headControlEnabled: true, enabled: true, paused: false });
      setNotice('Camera and head tracking are ready. Face reacquisition pauses interaction until the view stabilizes.');
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in Chrome settings, then try again.' : error instanceof Error ? error.message : 'Camera could not be started.';
      updateStatus({ permission: error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'unavailable', trackingPhase: 'error', error: message });
      setNotice(message);
    } finally {
      setStartingCamera(false);
    }
  }

  function stopCamera() {
    if (videoRef.current) trackerRef.current?.stop(videoRef.current);
    void persist({ headControlEnabled: false, paused: false });
    setNotice('Camera stopped. No camera stream remains active.');
  }

  function togglePause() {
    const nextPaused = !settings.paused;
    void persist({ paused: nextPaused });
    if (nextPaused) { if (videoRef.current) trackerRef.current?.pause(videoRef.current); setNotice('Interaction paused. Dwell selection is cancelled immediately.'); }
    else { if (videoRef.current) trackerRef.current?.resume(videoRef.current); setNotice('Interaction resumed; stabilization is required before pointer movement continues.'); }
  }

  function startCalibration() { setCalibrationStep('neutral'); setCalibrationHint('Look straight ahead and keep your head still, then capture the neutral position.'); trackerRef.current?.calibration.reset(); }
  function captureCalibrationStep() {
    const next = trackerRef.current?.calibration.capture(latestPosition.current);
    if (!next) return;
    setCalibrationStep(next);
    const hints: Record<typeof next, string> = { neutral: '', left: 'Move slightly left, without leaning, then capture.', right: 'Move slightly right, then capture.', up: 'Move slightly up, then capture.', down: 'Move slightly down, then capture.', target: 'Move the in-page pointer to the target shown below, then save.', complete: 'Calibration is ready to save.' };
    setCalibrationHint(hints[next]);
    if (next === 'complete') { const calibration = trackerRef.current?.calibration.save(); if (calibration) void persist({ calibration }); }
  }
  function cancelCalibration() { trackerRef.current?.calibration.reset(); setCalibrationStep('idle'); setCalibrationHint('Calibration cancelled.'); }
  function recenter() { trackerRef.current?.recenter(); void sendMessage({ type: 'RECENTER_POINTER' }); setNotice('Pointer recentered to the middle of the webpage.'); }

  const phase = statusText[status.trackingPhase];
  const trackingTone = status.trackingPhase === 'tracking' ? 'good' : ['lost', 'error'].includes(status.trackingPhase) ? 'bad' : status.trackingPhase === 'paused' ? 'warn' : 'neutral';

  return <AppShell>
    <main className="dashboard-main">
      <section className="hero"><div><span className="eyebrow">Accessible browser interaction</span><h1>Move through the web at your own pace.</h1><p>HandFree turns deliberate head movement into an in-page pointer. It never controls the operating-system mouse, and every click is gated by confidence, pause state, and dwell safety.</p></div><div className="status-strip"><StatusPill label={settings.enabled ? 'HandFree on' : 'HandFree off'} tone={settings.enabled ? 'good' : 'neutral'} /><StatusPill label={phase} tone={trackingTone} /></div></section>
      {status.error && <div className="error-banner" role="alert"><Icon name="warning" /><span>{status.error}</span></div>}
      <div className="dashboard-grid">
        <div className="stack">
          <section className="card card--accent"><SectionHeading eyebrow="01 · Control" title="Head control" description="Start camera setup only when you are ready. HandFree stays idle when this dashboard opens." /><div className="control-row"><div className="control-copy"><strong>HandFree enabled</strong><span>Allow the in-page pointer to receive tracking updates.</span></div><Toggle checked={settings.enabled} label="Enable HandFree" onChange={(value) => void persist({ enabled: value, paused: value ? settings.paused : false })} /></div><div className="control-row"><div className="control-copy"><strong>Head Control</strong><span>Use face landmarks to move the virtual pointer.</span></div><Toggle checked={settings.headControlEnabled} label="Enable Head Control" disabled={status.permission !== 'active' && !settings.headControlEnabled} onChange={(value) => void persist({ headControlEnabled: value, enabled: value ? true : settings.enabled })} /></div><div className="button-row" style={{ marginTop: 18 }}><button className="button button--primary" onClick={startCamera} disabled={status.permission === 'active' || startingCamera}><Icon name="camera" />{startingCamera ? 'Requesting camera permission…' : status.permission === 'active' ? 'Camera active' : 'Start camera setup'}</button><button className="button button--danger" onClick={stopCamera} disabled={status.permission !== 'active'}>Stop camera</button></div>{notice && <p className="notice" role="status" style={{ margin: '16px 0 0' }}><Icon name="info" /><span>{notice}</span></p>}</section>
          <section className="card"><SectionHeading eyebrow="02 · Live view" title="Camera and tracking" description="The preview is local to this dashboard. Camera resources are released when tracking stops." /><div className="camera-layout"><div className="camera-frame"><video ref={videoRef} playsInline aria-label="Live camera preview" />{status.permission !== 'active' && <div className="camera-placeholder"><div><Icon name="camera" /><strong>{status.permission === 'denied' ? 'Permission needed' : 'Camera is off'}</strong><span>Choose Start camera setup to request access.</span></div></div>}</div><div className="camera-side">{cameraList.length > 0 && <label className="select-label">Camera<select value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)}>{cameraList.map((camera) => <option value={camera.deviceId} key={camera.deviceId}>{camera.label}</option>)}</select></label>}<div className="metric"><span>Camera</span><strong>{status.permission === 'active' ? 'Active' : status.permission === 'denied' ? 'Denied' : status.permission === 'unavailable' ? 'Unavailable' : 'Stopped'}</strong></div><div className="metric"><span>Face</span><strong>{status.faceDetected ? 'Detected' : 'Not detected'}</strong></div><div className="metric"><span>Confidence</span><strong>{Math.round(status.confidence * 100)}%</strong><div className="quality-bar" aria-label={`Tracking confidence ${Math.round(status.confidence * 100)} percent`}><span style={{ width: `${status.confidence * 100}%` }} /></div></div></div></div></section>
          <section className="card"><SectionHeading eyebrow="03 · Calibration" title="Find your comfortable range" description="Calibration uses relative facial landmarks so small, deliberate movements are enough. Never force your neck or posture." />{calibrationStep === 'idle' ? <div className="step-card"><span className="step-number">1</span><div><strong>Guided calibration is ready</strong><p>It captures neutral, left, right, up, and down positions, then saves the usable movement range locally.</p><div className="button-row" style={{ marginTop: 12 }}><button className="button button--primary" onClick={startCalibration} disabled={status.permission !== 'active'}><Icon name="target" />Start calibration</button><button className="button" onClick={recenter} disabled={status.permission !== 'active'}><Icon name="crosshair" />Recenter</button></div></div></div> : <div className="stack" style={{ gap: 14 }}><div className="step-card"><span className="step-number">{calibrationStep === 'complete' ? '✓' : ['neutral','left','right','up','down','target'].indexOf(calibrationStep) + 1}</span><div><strong>{calibrationStep === 'complete' ? 'Calibration complete' : `Capture ${calibrationStep} position`}</strong><p>{calibrationHint}</p></div></div>{calibrationStep === 'target' && <div className="calibration-target" aria-label="Calibration target"><span /></div>}<div className="button-row"><button className="button button--primary" onClick={captureCalibrationStep} disabled={calibrationStep === 'complete'}>{calibrationStep === 'target' ? 'Confirm target reached' : 'Capture position'}</button><button className="button" onClick={cancelCalibration}>Cancel</button>{calibrationStep === 'complete' && <button className="button" onClick={startCalibration}><Icon name="refresh" />Retry</button>}</div></div>}</section>
        </div>
        <aside className="stack"><section className="card"><SectionHeading eyebrow="Quick controls" title="Interaction" /><div className="control-row"><div className="control-copy"><strong>{settings.paused ? 'Resume interaction' : 'Pause interaction'}</strong><span>{settings.paused ? 'Wait for a stable face before movement resumes.' : 'Stops pointer actions and cancels dwell now.'}</span></div><button className="button" onClick={togglePause} disabled={!settings.enabled}><Icon name={settings.paused ? 'play' : 'pause'} />{settings.paused ? 'Resume' : 'Pause'}</button></div><div className="button-row" style={{ marginTop: 14 }}><button className="button" onClick={recenter}><Icon name="crosshair" />Recenter pointer</button><button className="button button--danger" onClick={() => void persist({ enabled: false, headControlEnabled: false, paused: false })}>Emergency disable</button></div></section><section className="card"><SectionHeading eyebrow="Tuning" title="Comfort settings" description="Changes are saved locally and shared with the side panel." /><div className="slider-control"><label className="slider-label" htmlFor="sensitivity"><span>Sensitivity</span><output>{settings.sensitivity.toFixed(1)}×</output></label><input id="sensitivity" className="range" type="range" min=".5" max="1.8" step=".1" value={settings.sensitivity} onChange={(event) => void persist({ sensitivity: Number(event.target.value) })} /></div><div className="slider-control"><label className="slider-label" htmlFor="dwell"><span>Dwell duration</span><output>{settings.dwellDuration} ms</output></label><input id="dwell" className="range" type="range" min="500" max="2500" step="100" value={settings.dwellDuration} onChange={(event) => void persist({ dwellDuration: Number(event.target.value) })} /></div><div className="slider-control"><label className="slider-label" htmlFor="smoothing"><span>Pointer smoothing</span><output>{Math.round(settings.smoothing * 100)}%</output></label><input id="smoothing" className="range" type="range" min=".2" max=".92" step=".04" value={settings.smoothing} onChange={(event) => void persist({ smoothing: Number(event.target.value) })} /></div><div className="control-row"><div className="control-copy"><strong>Dwell selection</strong><span>Click only after the pointer stays on one valid target.</span></div><Toggle checked={settings.dwellEnabled} label="Enable dwell selection" onChange={(value) => void persist({ dwellEnabled: value })} /></div></section><section className="card"><SectionHeading eyebrow="Try it safely" title="Demo Lab" description="A small page with real controls for testing highlighting, dwell cancellation, and repeat-click prevention." /><a className="link-card" href={extensionUrl('demo.html')}><span><strong>Open HandFree Demo Lab</strong><span>Buttons, a form, and closely spaced targets.</span></span><Icon name="arrow" /></a></section><section className="card"><div className="notice"><Icon name="shield" /><span className="privacy-copy"><strong>Privacy by default.</strong> The camera starts only after your action, stays in the extension dashboard, and is stopped when tracking is disabled. HandFree sends pointer coordinates to the active webpage only while enabled.</span></div></section></aside>
      </div>
      <p className="live-region" aria-live="polite">{phase}. {status.faceDetected ? 'Face detected.' : 'Face not detected.'}</p>
    </main>
  </AppShell>;
}
