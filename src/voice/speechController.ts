export type RecognitionMode = 'command' | 'dictation';
export type SpeechStatus = 'idle' | 'listening' | 'processing' | 'error' | 'unavailable';

interface SpeechRecognitionEventLike extends Event { results: SpeechRecognitionResultList; resultIndex: number; }
interface SpeechRecognitionLike extends EventTarget { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void; onresult: ((event: SpeechRecognitionEventLike) => void) | null; onend: (() => void) | null; onerror: ((event: Event & { error?: string }) => void) | null; }

export class SpeechController {
  private recognition: SpeechRecognitionLike | null = null;
  private mode: RecognitionMode = 'command';
  private lastSpoken = '';
  status: SpeechStatus = 'idle';
  readonly supported: boolean;

  constructor(private readonly callbacks: { onTranscript: (text: string, isFinal: boolean, mode: RecognitionMode) => void; onStatus: (status: SpeechStatus, message?: string) => void }) {
    this.supported = typeof window !== 'undefined' && Boolean((window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  }

  start(mode: RecognitionMode): void {
    if (!this.supported) { this.setStatus('unavailable', 'VOICE_RECOGNITION_UNAVAILABLE: This browser does not expose Web Speech recognition. Use a supported Chrome build, allow microphone access, then retry. Keyboard input remains available.'); return; }
    this.stop();
    this.mode = mode;
    const ctor = (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!ctor) { this.setStatus('unavailable', 'Speech recognition is not available in this browser.'); return; }
    this.recognition = new ctor();
    this.recognition.continuous = true;
    this.recognition.interimResults = mode === 'dictation';
    this.recognition.lang = 'en-US';
    this.recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const command = result[0].transcript.trim().toLowerCase().replace(/[.!?]+$/, '');
        if (result.isFinal && command === 'start dictation') { this.start('dictation'); return; }
        if (result.isFinal && /^(stop dictation|stop listening)$/.test(command)) { this.stop(); return; }
        if (result.isFinal && command === 'start voice commands') { this.start('command'); return; }
        this.callbacks.onTranscript(result[0].transcript, result.isFinal, this.mode);
      }
    };
    this.recognition.onerror = (event) => {
      const code = event.error || 'unknown';
      const recovery = code === 'not-allowed' || code === 'service-not-allowed' ? 'Allow microphone access and check whether this browser permits speech recognition.' : code === 'network' ? 'The browser speech service could not connect. Check your connection, then retry.' : code === 'audio-capture' ? 'No microphone input is available. Connect or select a microphone, then retry.' : 'No usable speech was recognized. Retry in a quieter environment.';
      this.setStatus('error', `VOICE_RECOGNITION_UNAVAILABLE (${code}): ${recovery}`);
    };
    this.recognition.onend = () => { if (this.status === 'listening' && this.recognition) this.setStatus('idle'); };
    try { this.recognition.start(); this.setStatus('listening'); } catch { this.setStatus('error', 'The microphone could not be started.'); }
  }

  stop(): void { const current = this.recognition; this.recognition = null; if (current) { current.onresult = null; current.onend = null; current.onerror = null; try { current.abort(); } catch { /* already stopped */ } } if (this.status === 'listening') this.setStatus('idle'); }
  speak(text: string, rate = 1, volume = 1): void {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    this.lastSpoken = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.volume = volume;
    utterance.onstart = () => this.setStatus('processing');
    utterance.onend = () => this.setStatus('idle');
    window.speechSynthesis.speak(utterance);
  }
  stopSpeaking(): void { window.speechSynthesis?.cancel(); this.setStatus('idle'); }
  repeat(rate = 1, volume = 1): void { if (this.lastSpoken) this.speak(this.lastSpoken, rate, volume); }
  destroy(): void { this.stop(); this.stopSpeaking(); }
  private setStatus(status: SpeechStatus, message?: string): void { this.status = status; this.callbacks.onStatus(status, message); }
}
