import { useEffect, useState } from 'react';
import { AppShell, StatusPill } from '../ui/AppShell';
import { Icon } from '../shared/icons';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { findSupportedWebpageTab, openDashboardInTab, sendMessage, subscribeToRuntimeMessages } from '../shared/runtime';
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeSettings, type RuntimeStatus } from '../shared/types';

export function SidePanel() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void loadSettings().then(setSettings);
    void sendMessage({ type: 'GET_STATE' }).then(response => {
      if (response?.type === 'STATE_RESPONSE') { setSettings(response.settings); setStatus(response.status); }
    });
    void sendMessage({ type: 'GET_ACTIVE_TAB_STATUS' }).then(response => {
      if (response?.type === 'ACTIVE_TAB_STATUS') setStatus(current => ({ ...current, ...response.status }));
    });
    const stopSettings = subscribeToSettings(setSettings);
    const stopMessages = subscribeToRuntimeMessages(message => {
      if (message.type === 'TRACKING_STATUS') setStatus(current => ({ ...current, ...message.status }));
      if (message.type === 'PERMISSION_STATUS') setStatus(current => ({ ...current, permission: message.permission, error: message.error }));
      if (message.type === 'STATE_RESPONSE') { setSettings(message.settings); setStatus(message.status); }
      if (message.type === 'VOICE_STATUS') setStatus(current => ({ ...current, voice: message.voice, voiceMessage: message.message }));
      if (message.type === 'MIC_PERMISSION_STATUS') setStatus(current => ({ ...current, microphone: message.microphone, error: message.error }));
      if (message.type === 'TOUCHVIEW_ERROR' || message.type === 'PAGE_UNSUPPORTED') setNotice(message.reason);
    });
    return () => { stopSettings(); stopMessages(); };
  }, []);
  async function update(patch: Partial<HandFreeSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
    const response = await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch });
    if (response?.type === 'STATE_RESPONSE') { setSettings(response.settings); setStatus(response.status); }
  }
  async function toggleTouchView() {
    if (busy) return;
    setBusy(true);
    try {
      const enabled = !settings.touchViewEnabled;
      const target = enabled ? await findSupportedWebpageTab() : undefined;
      if (enabled && target?.id === undefined) {
        setNotice('Open a normal HTTPS webpage in another tab, then enable TouchView.');
        return;
      }
      const response = enabled
        ? await sendMessage({ type: 'ENABLE_TOUCHVIEW', tabId: target!.id! })
        : await sendMessage({ type: 'DISABLE_TOUCHVIEW' });
      if (enabled && response?.type !== 'PAGE_SUPPORTED' && !(response?.type === 'STATE_RESPONSE' && response.settings.touchViewEnabled)) {
        setNotice(response?.type === 'PAGE_UNSUPPORTED' || response?.type === 'TOUCHVIEW_ERROR' ? response.reason : 'Open a supported webpage, then retry TouchView.');
        return;
      }
      const base = response?.type === 'STATE_RESPONSE' ? response.settings : settings;
      const next = { ...base, touchViewEnabled: enabled, touchViewPaused: false, ...(enabled ? { enabled: true, paused: false, enabledModes: Array.from(new Set([...base.enabledModes, 'hand' as const])) } : {}) };
      setSettings(next);
      await saveSettings(next);
      await sendMessage({ type: 'UPDATE_SETTINGS', settings: next });
      setNotice(enabled ? next.calibration ? 'TouchView connected. Check your shared mapping in the dashboard.' : 'TouchView connected, but calibration is required. Capture four corners and validate the mapping in the dashboard.' : 'TouchView disabled.');
      // Keep the side panel open after enabling. Opening the dashboard here
      // steals focus from the webpage and makes the user feel trapped in a
      // dashboard -> enable -> dashboard loop. The separate calibration
      // button remains the explicit way to open the full dashboard.
    } finally { setBusy(false); }
  }
  async function pauseTouchView() {
    const paused = !settings.touchViewPaused;
    await sendMessage({ type: paused ? 'PAUSE_TOUCHVIEW' : 'RESUME_TOUCHVIEW' });
    await update({ touchViewPaused: paused });
  }
  const cameraLabel = status.permission === 'active' ? 'Active' : status.permission === 'paused' ? 'Paused' : 'Off';
  const touchViewLabel = !settings.touchViewEnabled ? 'Off' : settings.touchViewPaused ? 'Paused' : settings.calibration ? 'Enabled' : 'Calibrate first';
  return <AppShell compact><main className="compact-main">
    <span className="eyebrow">TouchView</span><h1>Your hand. Your web.</h1>
    <p>Point, pinch, or hold to select webpage controls. Enable TouchView to start camera setup in the dashboard.</p>
    <section className="card compact-card">
      <div className="compact-status"><strong>TouchView</strong><StatusPill label={touchViewLabel} tone={settings.touchViewEnabled ? settings.touchViewPaused ? 'warn' : 'good' : 'neutral'} /></div>
      <div className="control-row"><div className="control-copy"><strong>Enable TouchView</strong><span>Hand tracking with one shared calibration.</span></div><button type="button" className="switch" role="switch" aria-label="Enable TouchView" aria-checked={settings.touchViewEnabled} disabled={busy} onClick={() => void toggleTouchView()}><span /></button></div>
      <div className="button-row"><button className="button button--primary" disabled={!settings.touchViewEnabled || busy} onClick={() => void pauseTouchView()}><Icon name={settings.touchViewPaused ? 'play' : 'pause'} />{settings.touchViewPaused ? 'Resume' : 'Pause'}</button><button className="button" disabled={!settings.touchViewEnabled} onClick={() => void sendMessage({ type: 'RECENTER_POINTER' })}><Icon name="crosshair" />Recenter</button></div>
      <div className="compact-metrics"><div className="compact-metric">Camera<strong>{cameraLabel}</strong></div><div className="compact-metric">Hand<strong>{status.handTracking === 'tracking' ? 'Detected' : status.handTracking === 'error' ? 'Error' : 'Not detected'}</strong></div><div className="compact-metric">Calibration<strong>{settings.calibration ? 'Saved' : 'Required'}</strong></div><div className="compact-metric">Page connection<strong>{status.currentTabSupported === true ? 'Available' : status.currentTabSupported === false ? 'Unsupported' : 'Unknown'}</strong></div></div>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
    {status.error && <p className="notice" role="alert">{status.error}</p>}
    <button className="button" style={{ width: '100%' }} onClick={() => void openDashboardInTab()}><Icon name="external" />Camera and calibration</button>
    <details className="card compact-card" style={{ marginTop: 16 }}><summary>Diagnostics <span>Tracking and experimental voice status</span></summary><div className="compact-metrics"><div className="compact-metric">Tracking<strong>{status.trackingPhase}</strong></div><div className="compact-metric">Estimated hand confidence<strong>{Math.round(status.handConfidence * 100)}%</strong></div><div className="compact-metric">Microphone<strong>{status.microphone}</strong></div><div className="compact-metric">Voice · experimental<strong>{status.voice}</strong></div></div><p className="privacy-copy">Voice and dictation have not been manually tested.</p></details>
    <p className="privacy-copy">Keep the camera dashboard open while tracking. Use Stop camera there to end capture.</p>
  </main></AppShell>;
}
