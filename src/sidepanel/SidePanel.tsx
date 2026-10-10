import { useEffect, useState } from 'react';
import { AppShell, StatusPill } from '../ui/AppShell';
import { Icon } from '../shared/icons';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { extensionUrl, sendMessage, subscribeToRuntimeMessages } from '../shared/runtime';
import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeSettings, type RuntimeStatus } from '../shared/types';

export function SidePanel() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const [status, setStatus] = useState<RuntimeStatus>(DEFAULT_STATUS);
  useEffect(() => {
    void loadSettings().then(setSettings);
    void sendMessage({ type: 'GET_STATE' }).then((response) => { if (response?.type === 'STATE_RESPONSE') { setSettings(response.settings); setStatus(response.status); } });
    const stopSettings = subscribeToSettings(setSettings);
    const stopMessages = subscribeToRuntimeMessages((message) => { if (message.type === 'VOICE_STATUS') setStatus((current) => ({ ...current, voice: message.voice, voiceMessage: message.message })); if (message.type === 'MIC_PERMISSION_STATUS') setStatus((current) => ({ ...current, microphone: message.microphone, error: message.error })); });
    return () => { stopSettings(); stopMessages(); };
  }, []);
  async function update(patch: Partial<HandFreeSettings>) { const next = { ...settings, ...patch }; setSettings(next); await saveSettings(next); await sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }); }
  const statusLabel = status.permission === 'active' ? (settings.paused ? 'Paused' : 'Camera active') : 'Camera off';
  return <AppShell compact><main className="compact-main"><span className="eyebrow">Quick controls</span><h1>Ready when you are.</h1><p>Head and hand movement stay inside the webpage. Use the full dashboard for setup, calibration, voice, and Sense.</p><section className="card compact-card"><div className="compact-status"><strong>HandFree</strong><StatusPill label={settings.enabled ? 'On' : 'Off'} tone={settings.enabled ? 'good' : 'neutral'} /></div><div className="control-row"><div className="control-copy"><strong>{settings.paused ? 'Interaction paused' : 'Interaction active'}</strong><span>{statusLabel}</span></div><button className="button" onClick={() => void update(settings.paused ? { paused: false, enabled: true } : { paused: true })} disabled={!settings.enabled}><Icon name={settings.paused ? 'play' : 'pause'} />{settings.paused ? 'Resume' : 'Pause'}</button></div><div className="button-row"><button className="button" onClick={() => void sendMessage({ type: 'RECENTER_POINTER' })}><Icon name="crosshair" />Recenter</button><button className="button button--danger" onClick={() => void update({ enabled: false, headControlEnabled: false, paused: false })}>Disable</button></div><div className="compact-metrics"><div className="compact-metric">Camera<strong>{statusLabel}</strong></div><div className="compact-metric">Microphone<strong>{status.microphone === 'active' ? 'Active' : 'Stopped'}</strong></div><div className="compact-metric">Hand<strong>{status.handTracking === 'tracking' ? 'Tracking' : 'Idle'}</strong></div><div className="compact-metric">Voice<strong>{status.voice === 'listening' ? 'Listening' : 'Idle'}</strong></div><div className="compact-metric">Sensitivity<strong>{settings.sensitivity.toFixed(1)}×</strong></div><div className="compact-metric">Dwell<strong>{settings.dwellDuration} ms</strong></div></div></section><a className="link-card" href={extensionUrl('dashboard.html')}><span><strong>Open full dashboard</strong><span>Camera, calibration, voice, Sense, and analytics</span></span><Icon name="arrow" /></a><p className="privacy-copy" style={{ marginTop: 18 }}><strong>Safe recovery:</strong> face or hand loss pauses interaction; the pointer will not jump or click until tracking stabilizes.</p></main></AppShell>;
}
