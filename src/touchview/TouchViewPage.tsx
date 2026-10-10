import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { HandFreeSettings, HandGesture, RuntimeStatus, TargetInfo, TouchViewCalibrationCorner } from '../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_STATUS } from '../shared/types';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { extensionUrl, openDashboardInTab, sendMessage } from '../shared/runtime';
import { recordAnalytics } from '../analytics/analytics';
import { TrackingController, type TrackingCallbacks } from '../tracking/trackingController';
import { calibrationQualityLabel, createTouchViewCalibration, TOUCH_VIEW_CORNERS, TOUCH_VIEW_PAGE_POINTS } from './touchViewCalibration';
import { readCalibrationGeometry } from '../tracking/coordinateMapping';
import { drawTrackingOverlay } from '../dashboard/trackingOverlay';
import { CameraOwnership } from '../dashboard/cameraOwnership';
import { TouchViewEngine, type TouchViewEngineEvent } from './touchViewEngine';
import '../ui/global.css';
import '../ui/touchview.css';

type CalibrationStep = 'idle' | TouchViewCalibrationCorner | 'test';

function safeName(target?: TargetInfo): string | undefined {
  const name = target?.accessibleName?.trim();
  return name && name.length <= 120 ? name : undefined;
}

function TouchViewScenario({ onAction }: { onAction: (label: string) => void }) {
  const [message, setMessage] = useState('TouchView is ready. Calibrate, then try a real control.');
  const [form, setForm] = useState({ name: '', choice: 'hand', category: 'accessibility', remember: false, range: 50 });
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const activate = (label: string) => { onAction(label); setMessage(`${label} activated.`); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!form.name.trim()) { setMessage('Enter a name before reviewing the submission.'); return; } setPendingSubmit(true); setMessage('Submission ready for confirmation.'); };
  const confirm = () => { setPendingSubmit(false); setMessage(`Local submission confirmed for ${form.name}. No data was sent.`); setForm({ name: '', choice: 'hand', category: 'accessibility', remember: false, range: 50 }); onAction('Confirm local submission'); };
  return <section className="touchview-interface" id="touchview-interface" aria-label="TouchView Demo Lab">
    <div className="touchview-interface__header"><div><span className="eyebrow">TouchView Demo Lab</span><h1>Point, pause, touch.</h1><p>These are real HTML controls. The camera estimates your fingertip; it does not detect physical screen contact.</p></div><div className="touchview-live-badge"><span className="status-dot status-pill--good" />local practice</div></div>
    <div className="touchview-scenario-grid">
      <article className="touchview-card touchview-card--hero"><span className="eyebrow">01 · Precision</span><h2>Try deliberate targets</h2><p>Hover a control, pinch and keep the pinch stable until the progress ring completes. Each target activates once.</p><div className="touchview-button-cloud"><button className="button button--primary" onClick={() => activate('Large primary button')}>Large primary button</button><button className="button" onClick={() => activate('Secondary button')}>Secondary button</button><button className="button touchview-small-target" onClick={() => activate('Small target A')}>Small A</button><button className="button touchview-small-target" onClick={() => activate('Small target B')}>Small B</button><button className="button touchview-small-target" onClick={() => activate('Small target C')}>Small C</button><button className="button touchview-distractor" onClick={() => activate('Distractor target')}>Distractor</button></div><div className="touchview-demo-status" role="status" aria-live="polite">{message}</div></article>
      <article className="touchview-card"><span className="eyebrow">02 · Form</span><h2>Confirm before submit</h2><p>Form submission stays local and requires a second confirmation step.</p><form className="touchview-form" onSubmit={submit}><label htmlFor="touchview-name">Name<input id="touchview-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your name" /></label><label htmlFor="touchview-category">Category<select id="touchview-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="accessibility">Accessibility</option><option value="calibration">Calibration</option><option value="feedback">Feedback</option></select></label><fieldset><legend>Preferred activation</legend><label className="checkbox-line" htmlFor="touchview-choice-hand"><input id="touchview-choice-hand" type="radio" name="touchview-choice" checked={form.choice === 'hand'} onChange={() => setForm({ ...form, choice: 'hand' })} /> Pinch</label><label className="checkbox-line" htmlFor="touchview-choice-hold"><input id="touchview-choice-hold" type="radio" name="touchview-choice" checked={form.choice === 'hold'} onChange={() => setForm({ ...form, choice: 'hold' })} /> Stable hold</label></fieldset><label className="touchview-range-label" htmlFor="touchview-range"><span>Range preference</span><output>{form.range}%</output></label><input id="touchview-range" type="range" min="0" max="100" value={form.range} onChange={(event) => setForm({ ...form, range: Number(event.target.value) })} /><label className="checkbox-line" htmlFor="touchview-remember"><input id="touchview-remember" type="checkbox" checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} /> Remember this practice session</label><button className="button button--primary" type="submit">Review submission</button></form></article>
      <article className="touchview-card touchview-card--wide"><span className="eyebrow">03 · Recovery</span><h2>Pause and recover safely</h2><p>Cover the camera, press Pause, or move away from a target. TouchView cancels pending activation and keeps normal keyboard input available.</p><div className="touchview-recovery-grid"><button className="button" onClick={() => activate('Recovery notice')}>Arm recovery notice</button><button className="button" onClick={() => activate('Normal input check')}>Normal input check</button><span className="touchview-status-note">No webcam frames or form values are stored.</span></div></article>
    </div>
    {pendingSubmit && <div className="touchview-confirmation" role="dialog" aria-modal="true" aria-labelledby="touchview-confirm-title"><div className="touchview-confirmation__panel"><span className="eyebrow">Review before action</span><h2 id="touchview-confirm-title">Confirm local submission?</h2><p>This action changes only this demo page. Nothing leaves the extension.</p><div className="button-row"><button className="button button--primary" onClick={confirm}>Confirm submission</button><button className="button" onClick={() => setPendingSubmit(false)}>Cancel</button></div></div></div>}
  </section>;
}

export function TouchViewPage() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<RuntimeStatus>({ ...DEFAULT_STATUS });
  const [cameraActive, setCameraActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('idle');
  const [draftPoints, setDraftPoints] = useState<Partial<Record<TouchViewCalibrationCorner, { camera: { x: number; y: number }; page: { x: number; y: number } }>>>({});
  const [notice, setNotice] = useState('TouchView is disabled until you enable it and start the camera.');
  const [targetLabel, setTargetLabel] = useState('No target');
  const [interactionState, setInteractionState] = useState('IDLE');
  const [pinchStatus, setPinchStatus] = useState<HandGesture>('none');
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<TrackingController | null>(null);
  const engineRef = useRef<TouchViewEngine | null>(null);
  const settingsRef = useRef(settings);
  const latestPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastHandStateRef = useRef<'tracking' | 'lost'>('lost');
  const cameraOwnership = useRef(new CameraOwnership());

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const analytics = (type: Parameters<typeof recordAnalytics>[0]['type'], details: Partial<Parameters<typeof recordAnalytics>[0]> = {}) => {
    if (!settingsRef.current.analyticsEnabled) return;
    void recordAnalytics({ type, timestamp: Date.now(), mode: 'touchview', ...details });
  };

  const callbacks = useMemo<TrackingCallbacks>(() => ({
    onStatus: (partial) => {
      setStatus((current) => ({ ...current, ...partial }));
      if (partial.handTracking === 'tracking') {
        if (lastHandStateRef.current !== 'tracking') analytics('TOUCHVIEW_HAND_DETECTED');
        lastHandStateRef.current = 'tracking';
      } else if (partial.handTracking === 'lost') {
        if (lastHandStateRef.current !== 'lost') analytics('TOUCHVIEW_HAND_LOST', { outcome: 'lost' });
        lastHandStateRef.current = 'lost';
        engineRef.current?.handLost();
      }
    },
    onPointer: () => undefined,
    onPosition: () => undefined,
    onCoordinate: (sample) => { if (sample.source === 'hand') latestPointRef.current = sample.point; },
    onLandmarks: (frame) => drawTrackingOverlay(landmarkRef.current, { ...frame, faceOpacity: settingsRef.current.touchViewFaceOpacity, handOpacity: settingsRef.current.touchViewHandOpacity }),
    onHand: (position, gesture) => {
      setPinchStatus(gesture);
      if (calibrationStepRef.current !== 'idle') return;
      engineRef.current?.update(position, gesture, position.confidence);
    }
  }), []);
  const calibrationStepRef = useRef<CalibrationStep>('idle');
  calibrationStepRef.current = calibrationStep;

  useEffect(() => {
    void loadSettings().then((loaded) => { setSettings(loaded); settingsRef.current = loaded; });
    return subscribeToSettings((next) => { setSettings(next); settingsRef.current = next; });
  }, []);

  useEffect(() => {
    const tracker = new TrackingController(callbacks);
    trackerRef.current = tracker;
    engineRef.current = new TouchViewEngine({
      holdDuration: settings.touchViewHoldDuration,
      cooldownDuration: settings.cooldownDuration,
      stableHoldEnabled: settings.touchViewStableHoldEnabled,
      cursorSize: settings.touchViewCursorSize,
      cursorColor: settings.touchViewCursorColor,
      feedbackEnabled: settings.touchViewFeedbackEnabled,
      onTarget: (target) => { setTargetLabel(target?.accessibleName ?? 'No target'); if (target) analytics('TOUCHVIEW_TARGET_HOVERED', { targetRole: target.tagName, targetName: safeName(target) }); },
      onEvent: (event: TouchViewEngineEvent) => {
        setInteractionState(event.state);
        if (event.type === 'pinch-started') analytics('TOUCHVIEW_PINCH_STARTED', { targetRole: event.target?.tagName, targetName: safeName(event.target) });
        if (event.type === 'hold-started') analytics('TOUCHVIEW_HOLD_STARTED', { targetRole: event.target?.tagName, targetName: safeName(event.target) });
        if (event.type === 'hold-cancelled') analytics('TOUCHVIEW_HOLD_CANCELLED', { duration: event.duration, outcome: 'cancelled' });
        if (event.type === 'activated') {
          const type = event.method === 'pinch' ? 'TOUCHVIEW_PINCH_ACTIVATED' : 'TOUCHVIEW_TARGET_ACTIVATED';
          analytics(type, { duration: event.duration, outcome: 'success', targetRole: event.target?.tagName, targetName: safeName(event.target), metadata: { activationMethod: event.method ?? 'stable-hold' } });
          if (event.method === 'pinch') analytics('TOUCHVIEW_TARGET_ACTIVATED', { duration: event.duration, outcome: 'success', targetRole: event.target?.tagName, targetName: safeName(event.target), metadata: { activationMethod: 'pinch' } });
          setNotice(`${event.target?.accessibleName ?? 'Target'} activated.`);
        }
      }
    });
    return () => { engineRef.current?.destroy(); engineRef.current = null; tracker.destroy(videoRef.current!); cameraOwnership.current.release(); trackerRef.current = null; };
  }, [callbacks]);

  useEffect(() => {
    engineRef.current?.setOptions({
      holdDuration: settings.touchViewHoldDuration,
      cooldownDuration: settings.cooldownDuration,
      stableHoldEnabled: settings.touchViewStableHoldEnabled,
      cursorSize: settings.touchViewCursorSize,
      cursorColor: settings.touchViewCursorColor,
      feedbackEnabled: settings.touchViewFeedbackEnabled,
      
    });
    engineRef.current?.setActive(settings.touchViewEnabled);
    engineRef.current?.setPaused(settings.touchViewPaused || calibrationStep !== 'idle');
    if (!settings.touchViewEnabled && cameraActive && videoRef.current) {
      trackerRef.current?.stop(videoRef.current);
      setCameraActive(false);
    }
  }, [settings.touchViewEnabled, settings.touchViewPaused, settings.touchViewHoldDuration, settings.cooldownDuration, settings.touchViewStableHoldEnabled, settings.touchViewCursorSize, settings.touchViewCursorColor, settings.touchViewFeedbackEnabled, calibrationStep, cameraActive]);

  async function update(patch: Partial<HandFreeSettings>) { const next = { ...settingsRef.current, ...patch }; settingsRef.current = next; setSettings(next); trackerRef.current?.updateSettings(next); await saveSettings(next); await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }); }

  async function startCamera() {
    if (!videoRef.current || !trackerRef.current || starting) return;
    setStarting(true);
    try {
      const ownership = await cameraOwnership.current.claim(navigator.locks);
      if (ownership !== 'owned') {
        setNotice(ownership === 'busy' ? 'Another HandFree window owns the camera. Stop it there before starting this workspace.' : 'Camera ownership is unavailable in this browser context. Use the dashboard camera workspace.');
        return;
      }
      await trackerRef.current.start(videoRef.current, { ...settingsRef.current, enabled: true, enabledModes: ['hand'], touchViewEnabled: true });
      await update({ touchViewEnabled: true, touchViewPaused: false });
      setCameraActive(true); setNotice('Camera active. Move your index fingertip over a control.'); analytics('TOUCHVIEW_ENABLED', { outcome: 'success' });
    } catch (error) { cameraOwnership.current.release(); setNotice(error instanceof Error ? error.message : 'Camera could not be started.'); }
    finally { setStarting(false); }
  }

  function stopCamera() { if (videoRef.current) trackerRef.current?.stop(videoRef.current); cameraOwnership.current.release(); setCameraActive(false); }
  function exitTouchView() { stopCamera(); void update({ touchViewEnabled: false, touchViewPaused: false }); setNotice('Demo stopped. Supported-tab controls are managed by the dashboard.'); analytics('TOUCHVIEW_DISABLED', { outcome: 'success' }); }
  function togglePause() { const paused = !settings.touchViewPaused; void update({ touchViewPaused: paused }); engineRef.current?.setPaused(paused); setNotice(paused ? 'Demo paused.' : 'Demo resumed.'); analytics(paused ? 'TOUCHVIEW_PAUSED' : 'TOUCHVIEW_RESUMED', { outcome: 'success' }); }
  function beginCalibration() { engineRef.current?.reset(); setDraftPoints({}); setCalibrationStep('top-left'); setNotice('Calibration started. Move your fingertip to the highlighted corner, then capture.'); analytics('TOUCHVIEW_CALIBRATION_STARTED'); }
  function captureCalibration() {
    if (calibrationStep === 'idle' || calibrationStep === 'test') return;
    const point = latestPointRef.current;
    if (!point) { setNotice('No fingertip detected yet. Keep your hand visible and try again.'); analytics('TOUCHVIEW_CALIBRATION_FAILED', { outcome: 'unavailable' }); return; }
    const next = { ...draftPoints, [calibrationStep]: { camera: point, page: TOUCH_VIEW_PAGE_POINTS[calibrationStep] } };
    setDraftPoints(next);
    const index = TOUCH_VIEW_CORNERS.indexOf(calibrationStep);
    if (index < TOUCH_VIEW_CORNERS.length - 1) { setCalibrationStep(TOUCH_VIEW_CORNERS[index + 1]); setNotice(`Corner captured. Continue to ${TOUCH_VIEW_CORNERS[index + 1].replace('-', ' ')}.`); return; }
    const calibration = createTouchViewCalibration(next, settingsRef.current.mirrorCamera, videoRef.current ? readCalibrationGeometry(videoRef.current) : undefined);
    if (!calibration || calibration.quality < 0.35) { setCalibrationStep('idle'); setNotice('Calibration quality is too low. Keep the camera steady and recalibrate.'); analytics('TOUCHVIEW_CALIBRATION_FAILED', { outcome: 'rejected' }); return; }
    setCalibrationStep('test'); setNotice(`${calibrationQualityLabel(calibration)}. Test the cursor, then accept or recalibrate.`); analytics('TOUCHVIEW_CALIBRATION_COMPLETED', { outcome: 'success', metadata: { quality: calibration.quality } });
    settingsRef.current = { ...settingsRef.current, calibration, touchViewCalibration: calibration }; setSettings(settingsRef.current);
  }
  function acceptCalibration() { const calibration = settingsRef.current.calibration ?? settingsRef.current.touchViewCalibration; if (calibration) void update({ calibration, touchViewCalibration: calibration }); setCalibrationStep('idle'); engineRef.current?.setPaused(settingsRef.current.touchViewPaused); analytics('TOUCHVIEW_RECALIBRATED', { outcome: 'success' }); setNotice('Global calibration accepted for head, hand, TouchView, and supported webpages.'); }
  function resetCalibration() { setCalibrationStep('idle'); setDraftPoints({}); void update({ calibration: null, touchViewCalibration: null }); engineRef.current?.reset(); setNotice('Calibration reset. Four points are required before precise mapping is available.'); }

  const currentCalibration = settings.calibration;
  const calibrationPreview = calibrationStep !== 'idle' && calibrationStep !== 'test' ? TOUCH_VIEW_PAGE_POINTS[calibrationStep] : null;
  return <main className="touchview-shell">
    <video ref={videoRef} className="touchview-camera" style={{ opacity: settings.touchViewCameraOpacity, transform: settings.mirrorCamera ? 'scaleX(-1)' : 'none' }} playsInline muted aria-label="TouchView camera background" /><canvas ref={landmarkRef} className="touchview-landmarks" aria-hidden="true" />
    <div className="touchview-scrim" aria-hidden="true" />
    <header className="touchview-toolbar"><div><span className="eyebrow">HandFree · TouchView</span><strong>Camera-assisted virtual touchscreen</strong></div><div className="touchview-toolbar__actions"><span className={`touchview-state-pill ${cameraActive ? 'is-good' : ''}`}><span className="status-dot" />{cameraActive ? 'Camera active' : 'Camera stopped'}</span><button className="button" onClick={togglePause} disabled={!settings.touchViewEnabled}>{settings.touchViewPaused ? 'Resume' : 'Pause'}</button><button className="button button--danger" onClick={exitTouchView}>Exit TouchView</button></div></header>
    <div className="touchview-layout"><aside className="touchview-panel"><span className="eyebrow">Setup</span><h2>Point without contact.</h2><p>TouchView estimates your fingertip over a real interface. It does not physically detect contact with the screen.</p><div className="touchview-panel__actions"><button className="button button--primary" onClick={startCamera} disabled={cameraActive || starting}>{starting ? 'Starting camera…' : cameraActive ? 'Camera active' : 'Enable TouchView camera'}</button><button className="button" onClick={() => void openDashboardInTab()}>Open dashboard calibration</button><button className="button" onClick={resetCalibration}>Reset shared calibration</button></div><div className="touchview-status-list"><div><span>Hand</span><strong>{status.handTracking === 'tracking' ? 'Detected' : 'Searching'}</strong></div><div><span>Pinch</span><strong>{pinchStatus === 'pinch' ? 'Detected' : 'Released'}</strong></div><div><span>Target</span><strong title={targetLabel}>{targetLabel}</strong></div><div><span>Gesture state</span><strong>{interactionState}</strong></div><div><span>Calibration</span><strong>{calibrationStep === 'test' ? 'Test ready' : calibrationQualityLabel(currentCalibration)}</strong></div></div><p className="touchview-notice" role="status">{notice}</p><div className="touchview-settings"><label>Camera opacity <output>{Math.round(settings.touchViewCameraOpacity * 100)}%</output><input type="range" min=".25" max="1" step=".05" value={settings.touchViewCameraOpacity} onChange={(event) => void update({ touchViewCameraOpacity: Number(event.target.value) })} /></label><label>Interface opacity <output>{Math.round(settings.touchViewWebsiteOpacity * 100)}%</output><input type="range" min=".55" max="1" step=".05" value={settings.touchViewWebsiteOpacity} onChange={(event) => void update({ touchViewWebsiteOpacity: Number(event.target.value) })} /></label><label>Pinch sensitivity <output>{settings.pinchThreshold.toFixed(2)}</output><input type="range" min=".04" max=".18" step=".01" value={settings.pinchThreshold} onChange={(event) => void update({ pinchThreshold: Number(event.target.value) })} /></label><label>Stable hold <output>{settings.touchViewHoldDuration} ms</output><input type="range" min="300" max="1600" step="50" value={settings.touchViewHoldDuration} onChange={(event) => void update({ touchViewHoldDuration: Number(event.target.value) })} /></label><label>Cursor size <output>{settings.touchViewCursorSize}px</output><input type="range" min="18" max="64" step="2" value={settings.touchViewCursorSize} onChange={(event) => void update({ touchViewCursorSize: Number(event.target.value) })} /></label><label className="checkbox-line"><input type="checkbox" checked={settings.touchViewStableHoldEnabled} onChange={(event) => void update({ touchViewStableHoldEnabled: event.target.checked })} /> Enable stable hold</label><label className="checkbox-line"><input type="checkbox" checked={settings.mirrorCamera} onChange={(event) => { void update({ mirrorCamera: event.target.checked, touchViewMirrorCamera: event.target.checked, calibration: null, touchViewCalibration: null }); setNotice('Mirror setting changed. Recalibrate from the dashboard.'); }} /> Mirror camera preview</label><label className="checkbox-line"><input type="checkbox" checked={settings.touchViewFeedbackEnabled} onChange={(event) => void update({ touchViewFeedbackEnabled: event.target.checked })} /> Touch ripple feedback</label><label>Cursor color <select value={settings.touchViewCursorColor} onChange={(event) => void update({ touchViewCursorColor: event.target.value as HandFreeSettings['touchViewCursorColor'] })}><option value="cyan">Cyan</option><option value="lime">Lime</option><option value="amber">Amber</option><option value="magenta">Magenta</option></select></label></div><a className="touchview-back-link" href={extensionUrl('dashboard.html')}>Back to HandFree dashboard</a></aside><div className="touchview-stage" style={{ opacity: settings.touchViewWebsiteOpacity }}><TouchViewScenario onAction={(label) => setNotice(`${label} activated.`)} /></div></div>
    {calibrationPreview && <div className="touchview-calibration-layer" aria-live="polite"><div className="touchview-calibration-marker" style={{ left: `${calibrationPreview.x * 100}%`, top: `${calibrationPreview.y * 100}%` }}><span /></div><div className="touchview-calibration-prompt"><strong>Capture {calibrationStep.replace('-', ' ')}</strong><span>Place your fingertip over the marker.</span><button className="button button--primary" onClick={captureCalibration}>Capture current fingertip</button></div></div>}
    {calibrationStep === 'test' && <div className="touchview-calibration-test"><span>{calibrationQualityLabel(currentCalibration)}</span><button className="button button--primary" onClick={acceptCalibration}>Accept calibration</button><button className="button" onClick={beginCalibration}>Recalibrate</button></div>}
  </main>;
}
