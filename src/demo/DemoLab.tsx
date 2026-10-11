import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { HandFreeSettings, HandGesture, PageNode, RuntimeStatus, TargetInfo } from '../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_STATUS } from '../shared/types';
import { Icon } from '../shared/icons';
import { openDashboardInTab, sendMessage } from '../shared/runtime';
import { loadSettings, saveSettings, subscribeToSettings } from '../shared/storage';
import { formatConfidence, normalizeRuntimeStatus } from '../shared/sessionState';
import { answerPageQuery, extractPageIndex } from '../accessibility/pageExtractor';
import { CameraOwnership } from '../dashboard/cameraOwnership';
import { drawTrackingOverlay, clearTrackingOverlay } from '../dashboard/trackingOverlay';
import { SessionManager } from '../session/sessionManager';
import { DwellController } from '../content/dwellController';
import { findTargetAt } from '../content/targetDetector';
import { mapCameraToViewport, readCalibrationGeometry, type CoordinatePoint } from '../tracking/coordinateMapping';
import { SpeechController, type SpeechStatus } from '../voice/speechController';

function targetName(target?: TargetInfo | null): string {
  return target?.accessibleName?.trim() || 'Unnamed control';
}

function clampPoint(point: CoordinatePoint): CoordinatePoint {
  return { x: Math.max(0.01, Math.min(0.99, point.x)), y: Math.max(0.01, Math.min(0.99, point.y)) };
}

type SenseAction = 'read-page' | 'read-headings' | 'find-links' | 'find-deadlines' | 'summarize';

interface SenseReport {
  title: string;
  summary: string;
  headings: string[];
  actions: string[];
  deadlines: string[];
  fields: string[];
}

interface SenseResult {
  label: string;
  items: string[];
}

interface DemoConversationMessage {
  id: number;
  text: string;
  response: string;
  timestamp: number;
}

function hasSpeechRecognitionSupport(): boolean {
  if (typeof window === 'undefined') return false;
  const speechWindow = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

function normalizeVoicePhrase(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSendVoicePhrase(value: string): boolean {
  return /^(?:send|send (?:the )?message|send above (?:the )?(?:message|msg)|submit (?:the )?(?:message|msg))$/.test(normalizeVoicePhrase(value));
}

function isClearVoicePhrase(value: string): boolean {
  return /^(?:clear|clear (?:the )?(?:message|msg|field))$/.test(normalizeVoicePhrase(value));
}

function uniqueText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

function senseNodes(root: HTMLElement): PageNode[] {
  return extractPageIndex(root).filter((node) => node.visible && (node.text || node.accessibleName));
}

function buildSenseReport(root: HTMLElement): SenseReport {
  const nodes = senseNodes(root);
  const datePattern = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2}\b|\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b/i;
  const title = root.querySelector<HTMLElement>('[data-sense-title]')?.textContent?.trim() || 'HandFree Sense demonstration page';
  const headings = uniqueText(nodes.filter((node) => node.role === 'heading').map((node) => node.accessibleName || node.text));
  const actions = uniqueText(nodes.filter((node) => node.interactive && ['button', 'link'].includes(node.role)).map((node) => node.accessibleName || node.text));
  const deadlines = uniqueText(nodes.filter((node) => /deadline|due|opens|closes|review week/i.test(`${node.accessibleName} ${node.text}`) || datePattern.test(node.text)).map((node) => node.text || node.accessibleName));
  const fields = uniqueText(nodes.filter((node) => ['input', 'select', 'textarea'].includes(node.role)).map((node) => node.accessibleName || node.text || node.role));
  return { title, summary: answerPageQuery(nodes, 'page about'), headings, actions, deadlines, fields };
}

function SettingRange({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return <label className="demo-setting-range" htmlFor={id}>
    <span><strong>{label}</strong><output>{suffix}</output></span>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="demo-setting-switch">
    <span><strong>{label}</strong></span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

function StatusBadge({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`demo-status-badge demo-status-badge--${tone}`}>
    <i aria-hidden="true" />
    <span><small>{label}</small><strong>{value}</strong></span>
  </span>;
}

export function DemoLab() {
  const [settings, setSettings] = useState<HandFreeSettings>({ ...DEFAULT_SETTINGS });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [status, setStatus] = useState<RuntimeStatus>({ ...DEFAULT_STATUS });
  const statusRef = useRef(status);
  statusRef.current = status;
  const [cameraBusy, setCameraBusy] = useState(false);
  const cameraBusyRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState('Move your index finger over a control to begin.');
  const [cameraMessage, setCameraMessage] = useState('Camera off. Start the camera to begin live tracking.');
  const [cameraCode, setCameraCode] = useState('');
  const [targetLabel, setTargetLabel] = useState('No target under the pointer');
  const [dwellProgress, setDwellProgress] = useState(0);
  const [handGesture, setHandGesture] = useState<HandGesture>('release');
  const [formResult, setFormResult] = useState('No action yet.');
  const speechRecognitionSupported = hasSpeechRecognitionSupport();
  const [composerValue, setComposerValue] = useState('');
  const composerValueRef = useRef('');
  const [conversation, setConversation] = useState<DemoConversationMessage[]>([]);
  const [voiceState, setVoiceState] = useState<SpeechStatus>(() => hasSpeechRecognitionSupport() ? 'idle' : 'unavailable');
  const [voiceMessage, setVoiceMessage] = useState(() => hasSpeechRecognitionSupport()
    ? 'Click the microphone to dictate a local message.'
    : 'Voice recognition is unavailable in this browser. You can still type and send messages.');
  const [senseReport, setSenseReport] = useState<SenseReport | null>(null);
  const [senseResult, setSenseResult] = useState<SenseResult | null>(null);
  const [senseState, setSenseState] = useState<'idle' | 'reading' | 'ready'>('idle');
  const [senseMessage, setSenseMessage] = useState('Choose a local Sense action to inspect the visible demo webpage.');

  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const fingertipRef = useRef<HTMLDivElement>(null);
  const targetOutlineRef = useRef<HTMLDivElement>(null);
  const sensePageRef = useRef<HTMLElement>(null);
  const senseUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechRef = useRef<SpeechController | null>(null);
  const voiceSessionRef = useRef(0);
  const conversationIdRef = useRef(0);
  const sharedModesRef = useRef<HandFreeSettings['enabledModes']>(settings.enabledModes);
  const trackerRef = useRef<SessionManager | null>(null);
  const ownershipRef = useRef(new CameraOwnership());
  const dwellRef = useRef<DwellController | null>(null);
  const mountedRef = useRef(true);
  const visualFrameRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const pendingStatusRef = useRef<Partial<RuntimeStatus>>({});
  const pointerTargetRef = useRef<CoordinatePoint | null>(null);
  const pointerDisplayRef = useRef<CoordinatePoint>({ x: 0.5, y: 0.5 });
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const activeTargetInfoRef = useRef<TargetInfo | null>(null);
  const lastTrackingAtRef = useRef(0);
  const lastConfidenceRef = useRef(0);
  const handVisibleRef = useRef(false);
  const lastDwellUiAtRef = useRef(0);
  const cameraGenerationRef = useRef(0);

  const publishStatus = useCallback((patch: Partial<RuntimeStatus>) => {
    pendingStatusRef.current = { ...pendingStatusRef.current, ...patch };
    if (statusTimerRef.current !== null) return;
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      const nextPatch = pendingStatusRef.current;
      pendingStatusRef.current = {};
      if (!mountedRef.current) return;
      setStatus((current) => normalizeRuntimeStatus(current, nextPatch));
    }, 100);
  }, []);

  const updateHighlightedTarget = useCallback((next: { element: HTMLElement; info: TargetInfo } | null) => {
    const previous = activeTargetRef.current;
    if (previous === (next?.element ?? null)) return;
    if (previous) {
      previous.classList.remove('demo-target-highlight');
      previous.style.removeProperty('--handfree-demo-highlight-opacity');
    }
    if (targetOutlineRef.current) targetOutlineRef.current.style.display = 'none';
    activeTargetRef.current = next?.element ?? null;
    activeTargetInfoRef.current = next?.info ?? null;
    dwellRef.current?.resetCompletion();
    if (next) {
      next.element.classList.add('demo-target-highlight');
      next.element.style.setProperty('--handfree-demo-highlight-opacity', String(settingsRef.current.touchViewHighlightOpacity));
      if (targetOutlineRef.current) targetOutlineRef.current.style.display = 'block';
      setTargetLabel(`${targetName(next.info)} · ${next.info.tagName.toUpperCase()}`);
      setFeedback(`Target detected: ${targetName(next.info)}. Hold still to activate.`);
    } else {
      setTargetLabel('No target under the pointer');
    }
  }, []);

  const persist = useCallback(async (patch: Partial<HandFreeSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    if (trackerRef.current?.camera.currentStream) {
      sharedModesRef.current = Array.from(new Set([...sharedModesRef.current, 'hand', 'touchview']));
    }
    settingsRef.current = next;
    setSettings(next);
    trackerRef.current?.updateSettings(next);
    await saveSettings({ ...next, enabledModes: sharedModesRef.current });
    void sendMessage({ type: 'UPDATE_SETTINGS', settings: patch });
  }, []);

  const stopCamera = useCallback(async (silent = false) => {
    cameraGenerationRef.current += 1;
    const tracker = trackerRef.current;
    const video = videoRef.current;
    dwellRef.current?.cancel('Camera stopped');
    pointerTargetRef.current = null;
    handVisibleRef.current = false;
    updateHighlightedTarget(null);
    if (tracker && video && (tracker.camera.currentStream || statusRef.current.engineState !== 'STOPPED')) tracker.stop(video);
    tracker?.clearConsumers();
    ownershipRef.current.release();
    if (cursorRef.current) cursorRef.current.style.opacity = '0';
    if (fingertipRef.current) fingertipRef.current.style.opacity = '0';
    clearTrackingOverlay(landmarkCanvasRef.current);
    setDwellProgress(0);
    setHandGesture('release');
    setCameraCode('');
    setCameraMessage('Camera off. Start the camera to begin live tracking.');
    if (!silent) {
      const next = { ...settingsRef.current, enabled: false, paused: false, touchViewEnabled: false, touchViewPaused: false, enabledModes: sharedModesRef.current };
      settingsRef.current = next;
      setSettings(next);
      await saveSettings(next);
      void sendMessage({ type: 'DISABLE_TOUCHVIEW' });
    }
  }, [updateHighlightedTarget]);

  const startCamera = useCallback(async () => {
    if (cameraBusyRef.current || trackerRef.current?.camera.currentStream) return;
    const video = videoRef.current;
    const tracker = trackerRef.current;
    if (!video || !tracker) return;
    cameraBusyRef.current = true;
    setCameraBusy(true);
    setCameraCode('');
    setCameraMessage('Requesting the camera and loading the hand model…');
    const claim = await ownershipRef.current.claim(navigator.locks);
    if (claim !== 'owned') {
      cameraBusyRef.current = false;
      setCameraBusy(false);
      setCameraCode(claim === 'busy' ? 'CAMERA_ALREADY_IN_USE' : 'CAMERA_UNAVAILABLE');
      setCameraMessage(claim === 'busy'
        ? 'The camera is owned by Control Center or another HandFree surface. Stop it there, then retry here.'
        : 'This browser does not expose a camera lock. Open the full dashboard to start camera tracking.');
      publishStatus({ engineState: 'ERROR', permission: 'unavailable', cameraState: 'error', trackingState: 'error', trackingPhase: 'error', error: 'Camera ownership is unavailable.' });
      return;
    }
    const generation = ++cameraGenerationRef.current;
    const nextSettings: HandFreeSettings = {
      ...settingsRef.current,
      enabled: true,
      paused: false,
      touchViewEnabled: true,
      touchViewPaused: false,
      // The Demo is deliberately hand-only. Head tracking remains available
      // everywhere else, but must not load or draw in this workspace.
      enabledModes: Array.from(new Set([...sharedModesRef.current, 'hand', 'touchview'].filter((mode) => mode !== 'head'))) as HandFreeSettings['enabledModes']
    };
    sharedModesRef.current = Array.from(new Set([...sharedModesRef.current, 'hand', 'touchview']));
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    tracker.acquire('touchview');
    tracker.acquire('hand');
    try {
      await tracker.start(video, nextSettings);
      if (!mountedRef.current || generation !== cameraGenerationRef.current) return;
      await saveSettings({ ...nextSettings, enabledModes: sharedModesRef.current });
      void sendMessage({ type: 'UPDATE_SETTINGS', settings: { enabled: true, paused: false, touchViewEnabled: true, touchViewPaused: false, enabledModes: sharedModesRef.current } });
      setCameraMessage('Live camera active. Move your index finger into view.');
      setFeedback('Camera active. Move your index finger over a real control.');
    } catch (error) {
      tracker.clearConsumers();
      if (tracker.camera.currentStream) tracker.stop(video);
      ownershipRef.current.release();
      const domError = error instanceof DOMException ? error : null;
      const code = domError?.name === 'NotAllowedError' ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_STREAM_FAILED';
      setCameraCode(code);
      setCameraMessage(domError?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access for HandFree, then retry.'
        : `Camera could not start: ${error instanceof Error ? error.message : String(error)}`);
      publishStatus({ engineState: 'ERROR', permission: domError?.name === 'NotAllowedError' ? 'denied' : 'unavailable', cameraState: 'error', trackingState: 'error', trackingPhase: 'error', error: `Camera start failed (${code}).` });
    } finally {
      cameraBusyRef.current = false;
      setCameraBusy(false);
    }
  }, [publishStatus]);

  const togglePause = useCallback(async () => {
    const tracker = trackerRef.current;
    const video = videoRef.current;
    if (!tracker || !video || !tracker.camera.currentStream) {
      setFeedback('Start the camera before pausing the demo.');
      return;
    }
    const shouldPause = !settingsRef.current.paused;
    if (shouldPause) {
      tracker.pause(video);
      dwellRef.current?.cancel('Demo paused');
      pointerTargetRef.current = null;
      handVisibleRef.current = false;
      updateHighlightedTarget(null);
      setFeedback('Demo paused. Resume when you are ready.');
    } else {
      tracker.resume(video);
      setFeedback('Demo resumed. Wait for a stable hand, then move over a control.');
    }
    await persist({ paused: shouldPause, touchViewPaused: shouldPause });
  }, [persist, updateHighlightedTarget]);

  const openCalibration = useCallback(async () => {
    await stopCamera();
    await openDashboardInTab(undefined, 'calibration');
  }, [stopCamera]);

  const exitDemo = useCallback(async () => {
    await stopCamera();
    await openDashboardInTab();
  }, [stopCamera]);

  function stopSenseReading(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    senseUtteranceRef.current = null;
    setSenseState('ready');
    setSenseMessage('Reading stopped. The extracted results remain available below.');
  }

  function speakSense(text: string): void {
    if (!('speechSynthesis' in window)) {
      setSenseState('ready');
      setSenseMessage('Local Sense analysis complete. Speech output is unavailable in this browser; the results are shown below.');
      return;
    }
    const speech = window.speechSynthesis;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    senseUtteranceRef.current = utterance;
    utterance.onend = () => {
      if (senseUtteranceRef.current !== utterance) return;
      senseUtteranceRef.current = null;
      setSenseState('ready');
      setSenseMessage('Sense finished reading the visible demo webpage.');
    };
    utterance.onerror = () => {
      if (senseUtteranceRef.current !== utterance) return;
      senseUtteranceRef.current = null;
      setSenseState('ready');
      setSenseMessage('Sense extracted the page locally, but speech output could not start. The results are shown below.');
    };
    setSenseState('reading');
    setSenseMessage('Sense is reading the visible demo webpage…');
    speech.speak(utterance);
  }

  function runSense(action: SenseAction): void {
    const root = sensePageRef.current;
    if (!root) {
      setSenseState('ready');
      setSenseMessage('Sense could not find the visible demo webpage. Retry after the page finishes loading.');
      return;
    }
    const report = buildSenseReport(root);
    const result: SenseResult = action === 'read-page'
      ? { label: 'Page reading', items: [report.title, report.summary] }
      : action === 'read-headings'
        ? { label: 'Headings', items: report.headings.length ? report.headings : ['No headings were found on the visible demo webpage.'] }
        : action === 'find-links'
          ? { label: 'Actionable controls', items: report.actions.length ? report.actions : ['No actionable links or buttons were found.'] }
          : action === 'find-deadlines'
            ? { label: 'Dates and deadlines', items: report.deadlines.length ? report.deadlines : ['No dates or deadlines were found.'] }
            : { label: 'Local page summary', items: [report.summary] };
    setSenseReport(report);
    setSenseResult(result);
    setSenseMessage(`Local HandFree Sense analysis complete: ${result.label}.`);
    speakSense(result.items.join('. '));
  }

  function updateComposer(value: string): void {
    composerValueRef.current = value;
    setComposerValue(value);
  }

  function submitDemoMessage(raw = composerValueRef.current): boolean {
    const message = raw.trim();
    if (!message) {
      setFormResult('Write or dictate a message before sending.');
      setFeedback('Add a message before sending.');
      setVoiceMessage('Write or dictate a message before sending.');
      return false;
    }
    const id = ++conversationIdRef.current;
    setConversation((current) => [...current, {
      id,
      text: message,
      response: 'Your message was received through HandFree voice input.',
      timestamp: Date.now()
    }]);
    updateComposer('');
    setFormResult('Message sent.');
    setFeedback('Message sent. Demo response is local.');
    setVoiceMessage('Message sent. You can edit and send another message.');
    return true;
  }

  function stopVoiceInput(message = 'Voice input stopped.'): void {
    voiceSessionRef.current += 1;
    const controller = speechRef.current;
    speechRef.current = null;
    controller?.destroy();
    setVoiceState('idle');
    setVoiceMessage(message);
    void sendMessage({ type: 'VOICE_STATUS', voice: 'idle', message });
  }

  function handleVoiceTranscript(transcript: string, isFinal: boolean): void {
    if (!isFinal) return;
    const phrase = normalizeVoicePhrase(transcript);
    if (!phrase) {
      stopVoiceInput('No words were captured. Try again when you are ready.');
      return;
    }
    if (isSendVoicePhrase(phrase)) {
      const sent = submitDemoMessage();
      stopVoiceInput(sent ? 'Message sent.' : 'Nothing was sent. Add a message first.');
      return;
    }
    if (isClearVoicePhrase(phrase)) {
      updateComposer('');
      setFormResult('Message cleared.');
      setFeedback('Message cleared.');
      stopVoiceInput('Message cleared.');
      return;
    }
    if (/^stop (?:listening|voice input)$/.test(phrase)) {
      stopVoiceInput();
      return;
    }
    updateComposer(transcript.trim());
    setFormResult('Voice text ready to edit.');
    setFeedback('Voice text captured. Edit it or say “send message”.');
    stopVoiceInput('Voice text captured. Edit it before sending.');
  }

  function startVoiceInput(): void {
    if (voiceState === 'listening' || speechRef.current?.status === 'listening') {
      stopVoiceInput();
      return;
    }
    if (!speechRecognitionSupported) {
      setVoiceState('unavailable');
      setVoiceMessage('Voice recognition is unavailable in this browser. You can still type and send messages.');
      return;
    }

    voiceSessionRef.current += 1;
    const session = voiceSessionRef.current;
    speechRef.current?.destroy();
    speechRef.current = null;
    setVoiceState('processing');
    setVoiceMessage('Requesting microphone access…');

    const controller = new SpeechController({
      onTranscript: (text, isFinal) => {
        if (session !== voiceSessionRef.current) return;
        handleVoiceTranscript(text, isFinal);
      },
      onStatus: (nextStatus, nextMessage) => {
        if (session !== voiceSessionRef.current) return;
        setVoiceState(nextStatus);
        const fallback = nextStatus === 'listening'
          ? 'Listening…'
          : nextStatus === 'processing'
            ? 'Processing voice input…'
            : nextStatus === 'unavailable'
              ? 'Voice recognition is unavailable in this browser.'
              : nextStatus === 'error'
                ? 'Voice recognition failed. Check microphone permission and retry.'
                : 'Click the microphone to dictate a local message.';
        setVoiceMessage(nextMessage || fallback);
        const runtimeVoice = nextStatus === 'listening'
          ? 'listening'
          : nextStatus === 'error'
            ? 'error'
            : nextStatus === 'unavailable'
              ? 'unavailable'
              : 'idle';
        void sendMessage({ type: 'VOICE_STATUS', voice: runtimeVoice, message: nextMessage || fallback });
      }
    });
    speechRef.current = controller;
    controller.start('command');
  }

  useEffect(() => {
    mountedRef.current = true;
    const dwell = new DwellController({
      onStart: (target) => {
        setDwellProgress(0);
        if (cursorRef.current) cursorRef.current.style.setProperty('--demo-progress', '0%');
        setFeedback(`Hold on ${targetName(target)} until the ring completes.`);
      },
      onProgress: (progress) => {
        const now = performance.now();
        if (cursorRef.current) cursorRef.current.style.setProperty('--demo-progress', `${Math.round(progress * 100)}%`);
        if (now - lastDwellUiAtRef.current > 80 || progress >= 1) {
          lastDwellUiAtRef.current = now;
          setDwellProgress(progress);
        }
      },
      onCancel: () => {
        setDwellProgress(0);
        if (cursorRef.current) cursorRef.current.style.setProperty('--demo-progress', '0%');
      },
      onComplete: (target) => {
        const element = activeTargetRef.current;
        const activeInfo = activeTargetInfoRef.current;
        if (!element || !activeInfo || activeInfo.selectorHint !== target.selectorHint) return;
        element.focus({ preventScroll: true });
        element.click();
        setDwellProgress(1);
        setFeedback(`Activated ${targetName(target)}.`);
      }
    });
    dwellRef.current = dwell;

    const tracker = new SessionManager({
      onStatus: (patch) => {
        if (patch.handTracking === 'tracking') handVisibleRef.current = true;
        if (patch.handTracking === 'lost' || patch.engineState === 'TRACKING_LOST' || patch.engineState === 'STOPPED' || patch.cameraState === 'stopped') {
          handVisibleRef.current = false;
          pointerTargetRef.current = null;
          dwellRef.current?.cancel('Tracking interrupted');
        }
        publishStatus(patch);
      },
      onPointer: (position) => {
        if (settingsRef.current.enabledModes.includes('hand') && handVisibleRef.current && performance.now() - lastTrackingAtRef.current < 500) return;
        pointerTargetRef.current = clampPoint({ x: position.x, y: position.y });
        lastTrackingAtRef.current = performance.now();
        lastConfidenceRef.current = position.confidence;
      },
      onPosition: () => undefined,
      onCoordinate: (sample) => {
        if (sample.source !== 'hand') return;
        const video = videoRef.current;
        if (!video) return;
        const geometry = readCalibrationGeometry(video);
        const mapped = mapCameraToViewport(sample.point, settingsRef.current.calibration, geometry, settingsRef.current.mirrorCamera);
        if (!mapped) return;
        pointerTargetRef.current = clampPoint(mapped);
        lastTrackingAtRef.current = performance.now();
        lastConfidenceRef.current = sample.confidence;
        handVisibleRef.current = true;
      },
      onHand: (_position, gesture) => {
        setHandGesture((current) => current === gesture ? current : gesture);
      },
      onLandmarks: (frame) => {
        const video = videoRef.current;
        if (!video) return;
        drawTrackingOverlay(landmarkCanvasRef.current, {
          face: null,
          hand: frame.hand,
          headEnabled: false,
          handEnabled: true,
          geometry: readCalibrationGeometry(video),
          mirrored: settingsRef.current.mirrorCamera,
          handOpacity: settingsRef.current.touchViewHandOpacity
        });
      }
    });
    trackerRef.current = tracker;

    let active = true;
    void loadSettings().then((saved) => {
      if (!active || !mountedRef.current) return;
      sharedModesRef.current = saved.enabledModes;
      settingsRef.current = saved;
      setSettings(saved);
    });
    const unsubscribeSettings = subscribeToSettings((saved) => {
      if (!active || !mountedRef.current) return;
      sharedModesRef.current = saved.enabledModes;
      const effective = tracker.camera.currentStream
        ? { ...saved, enabledModes: saved.enabledModes.filter((mode) => mode !== 'head') }
        : saved;
      settingsRef.current = effective;
      setSettings(effective);
      tracker.updateSettings(effective);
    });

    return () => {
      active = false;
      mountedRef.current = false;
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
      if (visualFrameRef.current !== null) cancelAnimationFrame(visualFrameRef.current);
      visualFrameRef.current = null;
      const video = videoRef.current;
      if (video && (tracker.camera.currentStream || tracker.camera.currentState !== 'stopped')) tracker.stop(video);
      tracker.clearConsumers();
      ownershipRef.current.release();
      dwell.destroy();
      voiceSessionRef.current += 1;
      speechRef.current?.destroy();
      speechRef.current = null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      senseUtteranceRef.current = null;
      unsubscribeSettings();
      trackerRef.current = null;
      dwellRef.current = null;
    };
  }, [publishStatus]);

  useEffect(() => {
    const loop = () => {
      const now = performance.now();
      const cursor = cursorRef.current;
      const fingertip = fingertipRef.current;
      const paused = settingsRef.current.paused || statusRef.current.engineState === 'PAUSED';
      const stale = now - lastTrackingAtRef.current > 360 || lastConfidenceRef.current < 0.5 || !handVisibleRef.current;
      if (paused || stale || !pointerTargetRef.current) {
        if (cursor) cursor.style.opacity = '0';
        if (fingertip) fingertip.style.opacity = '0';
        pointerTargetRef.current = paused || stale ? null : pointerTargetRef.current;
        updateHighlightedTarget(null);
        dwellRef.current?.updateTarget(null, settingsRef.current.dwellDuration, false);
      } else {
        const target = pointerTargetRef.current;
        const display = pointerDisplayRef.current;
        const blend = Math.max(0.12, Math.min(0.9, 1 - settingsRef.current.smoothing));
        display.x += (target.x - display.x) * blend;
        display.y += (target.y - display.y) * blend;
        const x = display.x * window.innerWidth;
        const y = display.y * window.innerHeight;
        if (cursor) {
          cursor.style.left = `${x}px`;
          cursor.style.top = `${y}px`;
          cursor.style.opacity = String(settingsRef.current.touchViewCursorOpacity);
        }
        if (fingertip) {
          fingertip.style.left = `${x}px`;
          fingertip.style.top = `${y}px`;
          fingertip.style.opacity = String(settingsRef.current.touchViewCursorOpacity);
        }
        const detected = findTargetAt(x, y);
        const targetInChrome = detected?.element.closest('[data-handfree-chrome]');
        const next = targetInChrome ? null : detected;
        updateHighlightedTarget(next);
        if (activeTargetRef.current && targetOutlineRef.current) {
          const rect = activeTargetRef.current.getBoundingClientRect();
          targetOutlineRef.current.style.left = `${rect.left}px`;
          targetOutlineRef.current.style.top = `${rect.top}px`;
          targetOutlineRef.current.style.width = `${rect.width}px`;
          targetOutlineRef.current.style.height = `${rect.height}px`;
          targetOutlineRef.current.style.opacity = String(settingsRef.current.touchViewHighlightOpacity);
        }
        dwellRef.current?.updateTarget(next, settingsRef.current.dwellDuration, settingsRef.current.dwellEnabled && !paused && lastConfidenceRef.current >= 0.5);
      }
      visualFrameRef.current = requestAnimationFrame(loop);
    };
    visualFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (visualFrameRef.current !== null) cancelAnimationFrame(visualFrameRef.current);
      visualFrameRef.current = null;
    };
  }, [updateHighlightedTarget]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitDemoMessage();
  }

  function handleSenseSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get('sense-name') || '').trim() || 'Guest';
    setSenseMessage(`Application form submitted locally for ${name}. Sense can detect these form fields from the visible page.`);
    setFeedback('Sense demo form submitted locally. No data leaves this demo.');
  }

  function cameraLabel(): { value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
    if (cameraBusy || status.cameraState === 'requesting') return { value: 'Starting', tone: 'warn' };
    if (status.cameraState === 'active') return { value: 'Active', tone: 'good' };
    if (status.cameraState === 'error') return { value: 'Needs attention', tone: 'bad' };
    return { value: 'Off', tone: 'neutral' };
  }

  function trackingLabel(): { value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
    if (status.handTracking === 'tracking' && status.handConfidence >= 0.5) return { value: 'Hand detected', tone: 'good' };
    if (status.cameraState === 'active') return { value: 'Find a hand', tone: 'warn' };
    return { value: 'Waiting', tone: 'neutral' };
  }

  const cameraStatus = cameraLabel();
  const trackingStatus = trackingLabel();
  const calibrationLabel = settings.calibration
    ? `${Math.round(settings.calibration.quality * 100)}% quality`
    : 'Fallback map active';

  return <div className="demo-shell" style={{ '--demo-highlight-opacity': settings.touchViewHighlightOpacity } as CSSProperties}>
    <video ref={videoRef} className={`demo-camera${settings.mirrorCamera ? ' demo-camera--mirrored' : ''}`} autoPlay muted playsInline aria-label="Live HandFree webcam" style={{ opacity: settings.touchViewCameraOpacity }} />
    <div className="demo-camera-tint" aria-hidden="true" />
    <canvas ref={landmarkCanvasRef} className="demo-landmarks" aria-hidden="true" />

    <section className="demo-page-surface" aria-labelledby="demo-page-title" style={{ opacity: settings.touchViewWebsiteOpacity }}>
      <header className="demo-page-header">
        <div><span className="demo-page-kicker">Interactive webpage</span><h1 id="demo-page-title">Access settings</h1><p>A small real webpage surface for testing pointer movement, target highlighting and dwell activation.</p></div>
        <button id="demo-primary" type="button" className="demo-page-button demo-page-button--primary" onClick={() => { setFormResult('Primary action activated.'); setFeedback('Primary action activated.'); }}>Activate primary action</button>
      </header>
      <div className="demo-page-grid">
        <article className="demo-control-card">
          <div className="demo-card-heading"><div><span className="demo-page-kicker">Try real controls</span><h2>Interaction targets</h2></div><span className="demo-card-index">01</span></div>
          <div className="demo-control-row"><button id="demo-secondary" type="button" className="demo-page-button" onClick={() => { setFormResult('Secondary action activated.'); setFeedback('Secondary action activated.'); }}>Secondary action</button><a id="demo-link" className="demo-page-link" href="#demo-target" onClick={(event) => { event.preventDefault(); setFormResult('Real link activated.'); setFeedback('Real link activated.'); }}>Open details <Icon name="arrow" /></a></div>
          <label className="demo-field" htmlFor="demo-text"><span>Short text</span><input id="demo-text" name="name" type="text" placeholder="Type a name" /></label>
          <label className="demo-field" htmlFor="demo-select"><span>Preferred mode</span><select id="demo-select" name="mode" defaultValue="hand"><option value="hand">Hand pointer</option><option value="touchview">TouchView</option><option value="voice">Voice command</option></select></label>
          <label className="demo-choice"><input id="demo-check" name="remember" type="checkbox" />Keep this choice for the session</label>
          <fieldset className="demo-fieldset"><legend>Reference point</legend><label className="demo-choice"><input id="demo-radio-hand" name="reference" type="radio" value="hand" defaultChecked />Index fingertip</label><label className="demo-choice"><input id="demo-radio-pause" name="reference" type="radio" value="pause" />Open-palm pause</label></fieldset>
          <label className="demo-field" htmlFor="demo-slider"><span>Comfort level</span><input id="demo-slider" name="comfort" type="range" min="0" max="100" defaultValue="58" /></label>
        </article>

        <article className="demo-control-card demo-control-card--accent" id="demo-target">
          <div className="demo-card-heading"><div><span className="demo-page-kicker">Safe activation</span><h2>Submit a local test</h2></div><span className="demo-card-index">02</span></div>
          <p>Type or dictate a message, edit it if needed, then send it through this local-only conversation. Nothing is sent to a server.</p>
          <section className="demo-conversation" aria-labelledby="demo-conversation-title">
            <div className="demo-conversation-heading"><span id="demo-conversation-title">Local conversation</span><small>{conversation.length ? `${conversation.length} message${conversation.length === 1 ? '' : 's'}` : 'Empty'}</small></div>
            {conversation.length === 0
              ? <p className="demo-conversation-empty">No messages yet. Use the microphone or type below.</p>
              : <ol className="demo-conversation-list">{conversation.map((message) => <li key={message.id} className="demo-conversation-item"><div className="demo-conversation-meta"><strong>You</strong><time dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleTimeString()}</time></div><p>{message.text}</p><div className="demo-conversation-response"><span>Demo response</span><p>{message.response}</p></div></li>)}</ol>}
          </section>
          <form id="demo-form" onSubmit={handleSubmit}>
            <div className="demo-composer" aria-label="Demo message composer">
              <label className="demo-field demo-message-field" htmlFor="demo-note"><span>Message</span><textarea id="demo-note" name="message" rows={4} placeholder="Write a short message" value={composerValue} onChange={(event) => updateComposer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitDemoMessage(); } }} /></label>
              <button id="demo-microphone" className={`demo-mic-button${voiceState === 'listening' ? ' demo-mic-button--listening' : ''}${voiceState === 'error' || voiceState === 'unavailable' ? ' demo-mic-button--error' : ''}`} type="button" aria-label={voiceState === 'listening' ? 'Stop listening' : 'Use voice input'} title={voiceState === 'listening' ? 'Stop listening' : 'Use voice input'} aria-pressed={voiceState === 'listening'} aria-describedby="demo-voice-status" disabled={!speechRecognitionSupported} onClick={startVoiceInput}><Icon name="mic" /><span>{voiceState === 'listening' ? 'Stop listening' : 'Voice input'}</span></button>
              <button id="demo-submit" type="submit" className="demo-page-button demo-page-button--primary">Send</button>
            </div>
            <p id="demo-voice-status" className={`demo-voice-status${voiceState === 'listening' ? ' demo-voice-status--listening' : ''}${voiceState === 'error' || voiceState === 'unavailable' ? ' demo-voice-status--error' : ''}`} role={voiceState === 'error' || voiceState === 'unavailable' ? 'alert' : 'status'} aria-live="polite"><Icon name={voiceState === 'error' || voiceState === 'unavailable' ? 'warning' : voiceState === 'listening' ? 'mic' : 'info'} />{voiceMessage}</p>
          </form>
          <div id="demo-result" className="demo-result" role="status" aria-live="polite"><span>Result</span><strong>{formResult}</strong></div>
        </article>
      </div>
      <section className="demo-scroll-panel" aria-label="Demo notes"><span className="demo-page-kicker">What to look for</span><p>The green outline marks the current real target. The ring fills while the pointer remains steady. Pause cancels activation immediately and stopping the camera removes all tracking layers.</p></section>

      <section className="demo-sense-demo" aria-labelledby="sense-demo-heading">
        <header className="demo-sense-heading">
          <div><span className="demo-page-kicker">HandFree Sense · local analysis</span><h2 id="sense-demo-heading">Read this page with structure, not noise.</h2><p>This realistic demo webpage is the source for the Sense results below. The extraction is local, based only on visible headings, controls, links and content.</p></div>
          <span className="demo-sense-badge">Visible content only</span>
        </header>
        <nav className="demo-sense-nav" aria-label="Sense demo sections"><a href="#sense-overview">Overview</a><a href="#sense-dates">Deadlines</a><a href="#sense-faq">FAQ</a><a href="#sense-apply">Apply</a></nav>

        <article ref={sensePageRef} id="sense-demo-page" className="demo-sense-webpage" aria-label="HandFree Sense demonstration webpage">
          <header className="demo-sense-webpage-hero" id="sense-overview">
            <span className="demo-sense-eyebrow">Student access hub</span>
            <h3 data-sense-title>Build an accessible study plan</h3>
            <p>Find support, prepare your application and keep important dates in one clear place. This page is deliberately structured so HandFree Sense can identify what matters.</p>
          </header>
          <div className="demo-sense-content-grid">
            <section aria-labelledby="sense-support-heading">
              <h4 id="sense-support-heading">Support for every learner</h4>
              <p>HandFree helps students navigate digital services with hand and voice controls. Choose a support route, review the requirements and contact the access team when you need help.</p>
              <h4 id="sense-actions-heading">Actionable links</h4>
              <ul className="demo-sense-link-list"><li><a href="#sense-application" onClick={(event) => { event.preventDefault(); setSenseMessage('Application guide selected.'); }}>Open the application guide</a></li><li><a href="#sense-contact" onClick={(event) => { event.preventDefault(); setSenseMessage('Access team contact selected.'); }}>Contact the access team</a></li><li><a href="#sense-faq" onClick={(event) => { event.preventDefault(); setSenseMessage('FAQ section selected.'); }}>Review common questions</a></li></ul>
            </section>
            <section id="sense-dates" aria-labelledby="sense-dates-heading">
              <h4 id="sense-dates-heading">Important dates and deadlines</h4>
              <ul className="demo-sense-date-list"><li><strong>Application deadline:</strong> 18 November 2026</li><li><strong>Document review week:</strong> 1–5 December 2026</li><li><strong>Support appointments open:</strong> 12 October 2026</li></ul>
              <p className="demo-sense-note">Submit early if you need a camera, microphone or accessible-format check before your appointment.</p>
            </section>
          </div>
          <section id="sense-faq" className="demo-sense-faq" aria-labelledby="sense-faq-heading"><h4 id="sense-faq-heading">Frequently asked questions</h4><details><summary>Can I request an accessible format?</summary><p>Yes. Add the format you need in the application form and the access team will reply locally in this demo flow.</p></details><details><summary>What should I prepare?</summary><p>Prepare a student ID, your preferred contact method and any assistive-technology notes.</p></details></section>
          <section id="sense-apply" className="demo-sense-apply" aria-labelledby="sense-apply-heading"><div><span className="demo-sense-eyebrow">Contact or apply</span><h4 id="sense-apply-heading">Request an access appointment</h4><p id="sense-contact">This small form is local and is included so Sense can identify real fields and a real submit button.</p></div><form id="sense-application" onSubmit={handleSenseSubmit}><label htmlFor="sense-name">Your name<input id="sense-name" name="sense-name" type="text" placeholder="Your name" /></label><label htmlFor="sense-email">Email address<input id="sense-email" name="sense-email" type="email" placeholder="name@example.com" /></label><label htmlFor="sense-request">What support do you need?<textarea id="sense-request" name="sense-request" rows={3} placeholder="Tell the access team what would help" /></label><button id="sense-apply-button" className="demo-page-button demo-page-button--primary" type="submit">Request appointment</button></form></section>
        </article>

        <section className="demo-sense-controls" aria-labelledby="sense-controls-heading">
          <div className="demo-sense-controls-heading"><div><span className="demo-page-kicker">Sense controls</span><h3 id="sense-controls-heading">Ask the visible page</h3></div><span id="sense-status" className={`demo-sense-state demo-sense-state--${senseState}`} role="status">{senseState === 'reading' ? 'Reading' : senseState === 'ready' ? 'Ready' : 'Waiting'}</span></div>
          <p className="demo-sense-message" aria-live="polite">{senseMessage}</p>
          <div className="demo-sense-button-row"><button id="sense-read-page" className="demo-page-button demo-page-button--primary" type="button" onClick={() => runSense('read-page')}>Read page</button><button id="sense-read-headings" className="demo-page-button" type="button" onClick={() => runSense('read-headings')}>Read headings</button><button id="sense-find-links" className="demo-page-button" type="button" onClick={() => runSense('find-links')}>Find links</button><button id="sense-find-deadlines" className="demo-page-button" type="button" onClick={() => runSense('find-deadlines')}>Find deadlines</button><button id="sense-summarize" className="demo-page-button" type="button" onClick={() => runSense('summarize')}>Summarize page</button><button id="sense-stop-reading" className="demo-page-button demo-page-button--stop" type="button" onClick={stopSenseReading}>Stop reading</button></div>
          <div id="sense-output" className="demo-sense-output" role="region" aria-live="polite" aria-label="HandFree Sense results">{senseResult ? <><strong>{senseResult.label}</strong><ul>{senseResult.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></> : <p>No Sense result yet. Choose an action to extract the visible page.</p>}{senseReport && <div className="demo-sense-facts"><div><span>Page title</span><strong>{senseReport.title}</strong></div><div><span>Headings</span><strong>{senseReport.headings.length ? senseReport.headings.join(' · ') : 'None found'}</strong></div><div><span>Actionable links and buttons</span><strong>{senseReport.actions.length ? senseReport.actions.join(' · ') : 'None found'}</strong></div><div><span>Dates and deadlines</span><strong>{senseReport.deadlines.length ? senseReport.deadlines.join(' · ') : 'None found'}</strong></div><div><span>Form fields</span><strong>{senseReport.fields.length ? senseReport.fields.join(' · ') : 'None found'}</strong></div></div>}</div>
        </section>
      </section>
    </section>

    <div ref={fingertipRef} className="demo-fingertip" aria-hidden="true" />
    <div ref={targetOutlineRef} className="demo-target-outline" aria-hidden="true" />
    <div ref={cursorRef} className="demo-virtual-cursor" aria-hidden="true" style={{ '--demo-cursor-size': `${settings.touchViewCursorSize}px`, '--demo-cursor-color': settings.touchViewCursorColor === 'lime' ? '#b7f36b' : settings.touchViewCursorColor === 'amber' ? '#fbbf24' : settings.touchViewCursorColor === 'magenta' ? '#f0abfc' : '#7dd3fc' } as CSSProperties}>
      <span className="demo-cursor-ring" />
      <span className="demo-cursor-label">{targetLabel}</span>
    </div>

    <header className="demo-topbar" data-handfree-chrome="true">
      <div className="demo-brand"><span className="demo-brand-mark"><Icon name="crosshair" /></span><div><strong>HandFree Demo</strong><small>Live camera workspace</small></div></div>
      <div className="demo-topbar-status" aria-live="polite"><StatusBadge label="Camera" value={cameraStatus.value} tone={cameraStatus.tone} /><StatusBadge label="Hand tracking" value={trackingStatus.value} tone={trackingStatus.tone} /><span className="demo-topbar-calibration">Hand calibration · {calibrationLabel}</span></div>
      <div className="demo-topbar-actions"><button className="demo-icon-button" type="button" aria-label="Open Demo settings" title="Demo settings" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button><button className="demo-control-button" type="button" onClick={() => void togglePause()} disabled={status.cameraState === 'stopped'}><Icon name={settings.paused ? 'play' : 'pause'} />{settings.paused ? 'Resume' : 'Pause'}</button><button className="demo-control-button demo-control-button--stop" type="button" onClick={() => void stopCamera()} disabled={cameraBusy || status.cameraState === 'stopped'}>Stop camera</button></div>
    </header>

    <section className="demo-instructions" data-handfree-chrome="true" aria-label="Demo instructions">
      <span className="demo-instruction-icon"><Icon name="target" /></span>
      <div><strong>Move your index finger over a control.</strong><p>Keep it still until the dwell ring completes. The control activates automatically.</p></div>
      <span className="demo-gesture-state">Gesture · {handGesture === 'open-palm' ? 'Open hand' : handGesture === 'pinch' ? 'Pinch' : 'Released'}</span>
    </section>

    <section className="demo-action-panel" data-handfree-chrome="true" aria-live="polite"><span className="demo-action-panel__eyebrow">Live feedback</span><strong>{feedback}</strong><div className="demo-action-panel__progress"><span style={{ width: `${Math.round(dwellProgress * 100)}%` }} /></div><small>Hand confidence · {formatConfidence(status.handConfidence)}</small></section>

    <div className="demo-camera-control" data-handfree-chrome="true"><button className="demo-primary-control" type="button" onClick={() => void startCamera()} disabled={cameraBusy || status.cameraState === 'active'}><Icon name="camera" />{cameraBusy ? 'Starting camera…' : status.cameraState === 'active' ? 'Camera running' : 'Start camera'}</button><span className="demo-camera-message">{cameraMessage}{cameraCode && <code>{cameraCode}</code>}</span></div>

    {settingsOpen && <><button className="demo-drawer-backdrop" data-handfree-chrome="true" type="button" aria-label="Close Demo settings" onClick={() => setSettingsOpen(false)} /><aside className="demo-settings-drawer" data-handfree-chrome="true" role="dialog" aria-modal="true" aria-labelledby="demo-settings-title">
      <div className="demo-drawer-header"><div><span className="demo-page-kicker">Workspace settings</span><h2 id="demo-settings-title">Tune the live stage</h2></div><button className="demo-icon-button" type="button" aria-label="Close Demo settings" onClick={() => setSettingsOpen(false)}>×</button></div>
      <p className="demo-drawer-copy">The camera, landmarks, pointer and webpage are separate layers. Changes apply to this Demo Lab and are saved locally.</p>
      <div className="demo-drawer-actions"><button className="demo-page-button demo-page-button--primary" type="button" onClick={() => void startCamera()} disabled={cameraBusy || status.cameraState === 'active'}>Start camera</button><button className="demo-page-button" type="button" onClick={() => void stopCamera()} disabled={status.cameraState === 'stopped'}>Stop camera</button><button className="demo-page-button" type="button" onClick={() => void openCalibration()}>Start calibration</button></div>
      <div className="demo-settings-list"><SettingRange id="demo-camera-opacity" label="Camera opacity" value={settings.touchViewCameraOpacity} min={0.15} max={1} step={0.05} suffix={`${Math.round(settings.touchViewCameraOpacity * 100)}%`} onChange={(value) => void persist({ touchViewCameraOpacity: value })} /><SettingRange id="demo-webpage-opacity" label="Webpage opacity" value={settings.touchViewWebsiteOpacity} min={0.45} max={1} step={0.05} suffix={`${Math.round(settings.touchViewWebsiteOpacity * 100)}%`} onChange={(value) => void persist({ touchViewWebsiteOpacity: value })} /><SettingRange id="demo-cursor-size" label="Cursor size" value={settings.touchViewCursorSize} min={18} max={56} step={2} suffix={`${settings.touchViewCursorSize}px`} onChange={(value) => void persist({ touchViewCursorSize: value })} /><SettingRange id="demo-dwell-duration" label="Dwell duration" value={settings.dwellDuration} min={500} max={2500} step={100} suffix={`${settings.dwellDuration}ms`} onChange={(value) => void persist({ dwellDuration: value })} /><SettingRange id="demo-smoothing" label="Pointer smoothing" value={settings.smoothing} min={0.2} max={0.92} step={0.04} suffix={`${Math.round(settings.smoothing * 100)}%`} onChange={(value) => void persist({ smoothing: value })} /><SettingSwitch label="Dwell activation" checked={settings.dwellEnabled} onChange={(value) => void persist({ dwellEnabled: value })} /><SettingSwitch label="Mirror camera" checked={settings.mirrorCamera} onChange={(value) => void persist({ mirrorCamera: value, touchViewMirrorCamera: value })} /><SettingSwitch label="High contrast" checked={settings.touchViewContrast} onChange={(value) => void persist({ touchViewContrast: value })} /></div>
      <div className="demo-calibration-status"><span>Shared calibration</span><strong>{settings.calibration ? `${calibrationLabel} · ${new Date(settings.calibration.createdAt).toLocaleString()}` : 'Not saved. The fallback map is available for Demo testing.'}</strong><div><button type="button" className="demo-text-button" onClick={() => void persist({ calibration: null, touchViewCalibration: null })}>Reset calibration</button><button type="button" className="demo-text-button" onClick={() => void openCalibration()}>Recalibrate</button></div></div>
      <button className="demo-exit-button" type="button" onClick={() => void exitDemo()}>Exit Demo Lab and return to dashboard</button>
    </aside></>}
  </div>;
}
