import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons';
import { sendMessage, subscribeToRuntimeMessages } from '../shared/runtime';
import type { AnalyticsSummary, ControlMode, HandFreeSettings, RuntimeStatus } from '../shared/types';
import { SpeechController, type SpeechStatus } from '../voice/speechController';
import { recordAnalytics } from '../analytics/analytics';
import { formatConfidence } from '../shared/sessionState';

function Toggle({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

const modeLabels: Record<ControlMode, string> = { head: 'Head pointer', hand: 'Hand pointer', voice: 'Voice commands · experimental', dictation: 'Dictation · experimental', sense: 'HandFree Sense', touchview: 'TouchView' };

export function SenseControls({ settings, onSettings }: { settings: HandFreeSettings; onSettings: (patch: Partial<HandFreeSettings>) => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const responseVersion = useRef(0);
  const speaker = useRef<SpeechController | null>(null);
  const preferences = useRef(settings);
  preferences.current = settings;
  const enabled = settings.enabledModes.includes('sense');
  useEffect(() => {
    speaker.current = new SpeechController({ onTranscript: () => undefined, onStatus: () => undefined });
    const unsubscribe = subscribeToRuntimeMessages(incoming => {
      if (incoming.type !== 'SENSE_RESPONSE') return;
      responseVersion.current += 1;
      setMessage(incoming.message);
      if (preferences.current.enabledModes.includes('sense')) speaker.current?.speak(incoming.message, preferences.current.speechRate, preferences.current.speechVolume);
    });
    return () => { unsubscribe(); speaker.current?.destroy(); };
  }, []);
  function toggle(value: boolean) {
    onSettings({ enabledModes: value ? Array.from(new Set([...settings.enabledModes, 'sense' as const])) : settings.enabledModes.filter(mode => mode !== 'sense') });
    if (!value) { speaker.current?.stopSpeaking(); setMessage('Sense disabled.'); }
    void recordAnalytics({ type: value ? 'mode-enabled' : 'mode-disabled', timestamp: Date.now(), mode: 'sense' });
  }
  async function ask(query: string) {
    setBusy(true);
    const version = responseVersion.current;
    setMessage('Request sent. Waiting for the connected webpage response.');
    try {
      const response = await sendMessage({ type: 'SENSE_QUERY', query });
      if (responseVersion.current !== version) return;
      if (response?.type === 'SENSE_RESPONSE') { setMessage(response.message); speaker.current?.speak(response.message, preferences.current.speechRate, preferences.current.speechVolume); }
      else if (response?.type === 'PAGE_UNSUPPORTED' || response?.type === 'TOUCHVIEW_ERROR') setMessage(response.reason);
      else if (!response) setMessage('HandFree Sense could not connect to the active page. Open a supported webpage and retry.');
      else setMessage('HandFree Sense returned no readable page content.');
      // The dashboard owns audio output; content only extracts page structure.
    } catch {
      setMessage('HandFree Sense could not read this page. Check the active tab and retry.');
    } finally { setBusy(false); }
  }
  return <section data-audio-owner="dashboard" className="card sense-controls sense-controls--purple" aria-labelledby="sense-heading"><div className="section-heading"><span className="eyebrow">HandFree Sense</span><h2 id="sense-heading">Read the page structure</h2><p>Read the connected webpage’s headings, landmarks, and important information aloud. Audio is spoken once by this dashboard. Sense complements a screen reader.</p></div><div className="control-row"><div className="control-copy"><strong>Enable Sense</strong><span>Page reading and spoken feedback.</span></div><Toggle checked={enabled} label="Enable HandFree Sense" onChange={toggle} /></div><div className="button-row"><button className="button button--primary" disabled={!enabled || busy} onClick={() => void ask('what is this page about')}>What is this page about?</button><button className="button" disabled={!enabled || busy} onClick={() => void ask('read headings')}>Read headings</button><button className="button" disabled={!enabled || busy} onClick={() => void ask('important information')}>Read important information</button><button className="button" disabled={!enabled} onClick={() => { speaker.current?.stopSpeaking(); setMessage('Reading stopped.'); }}>Stop reading</button></div>{message && <p className="notice" role="status">{message}</p>}</section>;
}

function Diagnostics({ status, calibrated }: { status: RuntimeStatus; calibrated: boolean }) {
  const item = status.diagnostic;
  return <details className="card diagnostics-card"><summary>Diagnostics <span>Camera, models, engines, and page connection</span></summary><div className="section-heading"><span className="eyebrow">Diagnostics</span><h2>What HandFree sees</h2><p>Live status explains recoverable tracking and page-bridge issues without generic errors.</p></div><div className="diagnostics-grid"><div><span>Camera</span><strong>{status.cameraState}</strong></div><div><span>Engine</span><strong>{status.engineState}</strong></div><div><span>Pointer source</span><strong>{status.pointerSource}</strong></div><div><span>Models</span><strong>{status.trackingState === 'loading' ? 'Loading' : status.trackingState === 'error' ? 'Error' : status.cameraState === 'active' ? 'Ready' : 'Not started'}</strong></div><div><span>Face · estimated confidence</span><strong>{status.faceDetected ? formatConfidence(status.confidence) : 'Not detected'}</strong></div><div><span>Hand · estimated confidence</span><strong>{status.handTracking === 'tracking' ? formatConfidence(status.handConfidence) : 'Not detected'}</strong></div><div><span>Camera streams / loops</span><strong>{status.cameraTrackCount ?? 0} / F{status.activeFaceLoops} H{status.activeHandLoops} P{status.activePointerLoops}</strong></div><div><span>Active consumers</span><strong>{status.activeCameraConsumers.join(', ') || 'none'}</strong></div><div><span>Page bridge</span><strong>{status.currentTabSupported === false ? 'Unsupported' : status.currentTabSupported === true ? 'Available' : 'Unknown'}</strong></div><div><span>Calibration</span><strong>{calibrated ? 'Shared' : 'Required'}</strong></div></div>{item && <div className={`diagnostic-callout ${item.blocking ? 'diagnostic-callout--blocking' : ''}`} role="status"><strong>{item.title}</strong><span>{item.explanation}</span><small>{item.recovery} · {item.code}</small></div>}</details>;
}

export function AdvancedControls({ settings, status, onSettings, onStatus }: { settings: HandFreeSettings; status: RuntimeStatus; onSettings: (patch: Partial<HandFreeSettings>) => void; onStatus: (patch: Partial<RuntimeStatus>) => void }) {
  const preferences = useRef(settings);
  preferences.current = settings;
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [message, setMessage] = useState('');
  const speechRef = useRef<SpeechController | null>(null);
  const feedbackRef = useRef<SpeechController | null>(null);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState('');
  const mounted = useRef(true);
  const microphoneGeneration = useRef(0);
  const microphoneBusy = useRef(false);
  const microphoneTest = useRef<{ stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> } | null>(null);
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;
  function publishMicrophone(microphone: RuntimeStatus['microphone'], error?: string) {
    if (mounted.current) statusCallback.current({ microphone, ...(error ? { error } : {}) });
    void sendMessage({ type: 'MIC_PERMISSION_STATUS', microphone, error });
  }
  function releaseMicrophone() {
    microphoneGeneration.current += 1;
    microphoneBusy.current = false;
    const active = microphoneTest.current;
    microphoneTest.current = null;
    if (active) {
      clearInterval(active.interval);
      clearTimeout(active.timeout);
      active.stream.getTracks().forEach(track => track.stop());
      active.source.disconnect();
      void active.context.close().catch(() => undefined);
    }
    if (mounted.current) { setTestingMicrophone(false); setMicrophoneLevel(0); }
  }
  function stopMicrophoneTest() {
    releaseMicrophone();
    publishMicrophone('stopped');
    if (mounted.current) setMessage('Microphone test stopped. All test tracks released.');
  }
  useEffect(() => {
    mounted.current = true;
    const closeTest = () => { if (microphoneBusy.current) { releaseMicrophone(); publishMicrophone('stopped'); } };
    window.addEventListener('pagehide', closeTest);
    return () => { mounted.current = false; window.removeEventListener('pagehide', closeTest); closeTest(); };
  }, []);
  async function testMicrophone() {
    if (microphoneBusy.current) return;
    speechRef.current?.destroy();
    speechRef.current = null;
    statusCallback.current({ voice: 'idle' });
    void sendMessage({ type: 'VOICE_STATUS', voice: 'idle' });
    const generation = ++microphoneGeneration.current;
    microphoneBusy.current = true;
    setTestingMicrophone(true);
    setMessage('Speak for five seconds. This measures microphone input only; it does not record audio or test recognition.');
    publishMicrophone('prompt');
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser context.');
      context = new AudioContext();
      await context.resume();
      if (!mounted.current || generation !== microphoneGeneration.current) { await context.close(); return; }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!mounted.current || generation !== microphoneGeneration.current) { stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const active = { stream, context, source } as NonNullable<typeof microphoneTest.current>;
      microphoneTest.current = active;
      let peak = 0;
      active.interval = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        peak = Math.max(peak, rms);
        setMicrophoneLevel(Math.min(100, rms * 100));
      }, 100);
      active.timeout = setTimeout(() => {
        releaseMicrophone();
        publishMicrophone('stopped');
        setMessage(peak > .001 ? 'Microphone input detected. Test finished and all tracks released. Test speech recognition separately.' : 'No measurable input detected. All tracks released. Check your microphone and input volume.');
      }, 5000);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', stopMicrophoneTest, { once: true }));
      publishMicrophone('active');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      if (!mounted.current || generation !== microphoneGeneration.current) return;
      releaseMicrophone();
      const detail = error instanceof Error ? error.message : 'Microphone test could not start.';
      publishMicrophone(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'unavailable', detail);
      setMessage(detail);
    }
  }
  async function refreshAnalytics() {
    const response = await sendMessage({ type: 'ANALYTICS_SUMMARY_REQUEST' });
    if (!mounted.current) return;
    if (response?.type === 'ANALYTICS_SUMMARY_RESPONSE') { setSummary(response.summary); setAnalyticsMessage(''); }
    else { setSummary(null); setAnalyticsMessage('Session analytics are unavailable in this context.'); }
  }
  async function resetAnalytics() {
    setAnalyticsBusy(true);
    try { await sendMessage({ type: 'ANALYTICS_RESET' }); await refreshAnalytics(); }
    finally { if (mounted.current) setAnalyticsBusy(false); }
  }
  useEffect(() => {
    void refreshAnalytics();
    feedbackRef.current = new SpeechController({ onTranscript: () => undefined, onStatus: () => undefined });
    const stopMessages = subscribeToRuntimeMessages((incoming) => {
      if (incoming.type === 'VOICE_COMMAND_RESULT') {
        setMessage(incoming.message);
        if (incoming.speak) feedbackRef.current?.speak(incoming.message, preferences.current.speechRate, preferences.current.speechVolume);
        else if (incoming.message === 'Reading stopped.') feedbackRef.current?.stopSpeaking();
      }
    });
    const closeSpeech = () => {
      if (!speechRef.current) return;
      speechRef.current.destroy();
      speechRef.current = null;
      publishMicrophone('stopped');
      void sendMessage({ type: 'VOICE_STATUS', voice: 'idle' });
    };
    window.addEventListener('pagehide', closeSpeech);
    return () => { stopMessages(); window.removeEventListener('pagehide', closeSpeech); closeSpeech(); feedbackRef.current?.destroy(); };
  }, []);

  function updateModes(mode: ControlMode, enabled: boolean) {
    const next = enabled ? Array.from(new Set([...settings.enabledModes, mode])) : settings.enabledModes.filter((current) => current !== mode);
    onSettings({ enabledModes: next, enabled: next.length > 0, headControlEnabled: mode === 'head' ? enabled : settings.headControlEnabled });
    void recordAnalytics({ type: enabled ? 'mode-enabled' : 'mode-disabled', timestamp: Date.now(), mode });
  }

  function startSpeech(mode: 'command' | 'dictation') {
    if (microphoneBusy.current) stopMicrophoneTest();
    speechRef.current?.destroy();
    const controller = new SpeechController({
      onTranscript: (transcript, isFinal, recognitionMode) => {
        if (recognitionMode === 'command' && isFinal) { void sendMessage({ type: 'VOICE_COMMAND', transcript }); void recordAnalytics({ type: 'voice-command-received', timestamp: Date.now(), mode: 'voice', metadata: { length: transcript.length } }); }
        if (recognitionMode === 'dictation' && isFinal) { void sendMessage({ type: 'DICTATION_TEXT', text: transcript, isFinal }); }
      },
      onStatus: (nextStatus: SpeechStatus, nextMessage) => {
        const voice = nextStatus === 'listening' ? 'listening' : nextStatus === 'error' ? 'error' : nextStatus === 'unavailable' ? 'unavailable' : 'idle';
        if (mounted.current) statusCallback.current({ voice, voiceMessage: nextMessage });
        publishMicrophone(nextStatus === 'listening' ? 'active' : nextStatus === 'unavailable' ? 'unavailable' : nextStatus === 'error' && /not.allowed|service.not.allowed/i.test(nextMessage ?? '') ? 'denied' : 'stopped');
        if (mounted.current) setMessage(nextMessage || (nextStatus === 'listening' ? `${mode === 'command' ? 'Voice command' : 'Dictation'} is listening.` : ''));
        void sendMessage({ type: 'VOICE_STATUS', voice, message: nextMessage });
      }
    });
    speechRef.current = controller;
    onStatus({ microphone: 'prompt', voice: 'processing' });
    publishMicrophone('prompt');
    controller.start(mode);
  }

  function stopSpeech() { speechRef.current?.stop(); publishMicrophone('stopped'); onStatus({ voice: 'idle' }); void sendMessage({ type: 'VOICE_STATUS', voice: 'idle' }); setMessage('Voice input stopped.'); }

  return <>
    <section className="card"><div className="section-heading"><span className="eyebrow">Control modes</span><h2>Choose how HandFree listens</h2><p>Head and hand modes can be changed while the camera is running; HandFree reloads only the affected tracking models.</p></div>{(['hand', 'voice', 'dictation'] as ControlMode[]).map((mode) => <div className="control-row" key={mode}><div className="control-copy"><strong>{modeLabels[mode]}</strong><span>{mode === 'hand' ? 'Index-finger pointer, pinch click, and open-palm pause.' : mode === 'voice' ? 'Deterministic navigation and interaction commands.' : mode === 'dictation' ? 'Insert speech into the focused field without logging text.' : mode === 'sense' ? 'Extract page structure and read real page content aloud.' : 'Relative head movement with calibrated dwell selection.'}</span></div><Toggle checked={mode === 'head' ? settings.headControlEnabled && settings.enabledModes.includes(mode) : settings.enabledModes.includes(mode)} label={`Enable ${modeLabels[mode]}`} onChange={(value) => updateModes(mode, value)} /></div>)}</section>
    <section className="card"><div className="section-heading"><span className="eyebrow">Experimental · voice and dictation</span><h2>Test microphone and speech input</h2><p>Voice and dictation have not been manually tested. A microphone level test checks audio input only; use the speech controls to test recognition separately. Speech recognition stays browser-based. Commands are parsed deterministically, and dictated text is sent only to the focused local webpage field.</p></div><div className="metric-grid"><div className="metric"><span>Microphone</span><strong>{status.microphone}</strong></div><div className="metric"><span>Recognition</span><strong>{status.voice}</strong></div></div><div className="button-row" style={{ marginTop: 16 }}><button className="button" disabled={testingMicrophone || status.voice === 'listening'} onClick={() => void testMicrophone()}>Test microphone · 5 seconds</button><button className="button" disabled={!testingMicrophone} onClick={stopMicrophoneTest}>Stop microphone test</button><button className="button button--primary" onClick={() => startSpeech('command')} disabled={testingMicrophone || status.voice === 'listening'}><Icon name="play" />Start voice commands</button><button className="button" onClick={() => startSpeech('dictation')} disabled={testingMicrophone || status.voice === 'listening'}>Start dictation</button><button className="button button--danger" onClick={stopSpeech} disabled={status.voice !== 'listening'}>Stop listening</button></div>{testingMicrophone && <div className="slider-label"><span>Measured input</span><meter min="0" max="100" value={microphoneLevel} aria-label="Measured microphone input level" /><output>{microphoneLevel.toFixed(1)}% RMS</output></div>}{message && <p className="notice" role="status" style={{ marginTop: 14 }}><Icon name="info" /><span>{message}</span></p>}</section>
    <Diagnostics status={status} calibrated={Boolean(settings.calibration)} /><section className="card"><div className="section-heading"><span className="eyebrow">Local analytics</span><h2>Recent session signals</h2><p>Only event metadata is stored locally. Camera frames, microphone recordings, sensitive dictated text, and full browsing history are not stored.</p></div><div className="metric-grid"><div className="metric"><span>Completed tasks</span><strong>{summary?.completedTasks ?? '—'}</strong></div><div className="metric"><span>Cancelled activations</span><strong>{summary?.touchViewCancelledActivations ?? '—'}</strong></div><div className="metric"><span>Events</span><strong>{summary?.totalEvents ?? '—'}</strong></div><div className="metric"><span>Completed dwells</span><strong>{summary?.completedDwells ?? '—'}</strong></div><div className="metric"><span>Voice commands</span><strong>{summary?.voiceCommands ?? '—'}</strong></div><div className="metric"><span>Tracking interruptions</span><strong>{summary?.trackingInterruptions ?? '—'}</strong></div><div className="metric"><span>TouchView sessions</span><strong>{summary?.touchViewUsage ?? '—'}</strong></div><div className="metric"><span>TouchView activations</span><strong>{summary?.touchViewSuccessfulActivations ?? '—'}</strong></div><div className="metric"><span>Calibration success</span><strong>{summary ? `${Math.round(summary.touchViewCalibrationSuccessRate * 100)}%` : '—'}</strong></div><div className="metric"><span>TouchView avg. hold</span><strong>{summary ? `${Math.round(summary.touchViewAverageActivationTime)} ms` : '—'}</strong></div></div><h3>Recent events</h3>{summary && summary.recent.length > 0 ? <ol className="analytics-recent">{summary.recent.slice(0, 8).map((event, index) => <li key={`${event.id ?? event.timestamp}-${index}`}><time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString()}</time> · {event.type.replaceAll('-', ' ').replaceAll('_', ' ')}{event.mode ? ` · ${event.mode}` : ''}{event.outcome ? ` · ${event.outcome}` : ''}</li>)}</ol> : <p className="privacy-copy">{summary ? 'No recent events.' : 'Session summary unavailable.'}</p>}<div className="button-row" style={{ marginTop: 16 }}><button className="button" disabled={analyticsBusy} onClick={() => void refreshAnalytics()}>Refresh summary</button><button className="button button--danger" disabled={analyticsBusy} onClick={() => void resetAnalytics()}>{analyticsBusy ? 'Resetting…' : 'Reset local session'}</button></div>{analyticsMessage && <p className="notice" role="status">{analyticsMessage}</p>}</section>
  </>;
}
