import type { HandFreeSettings, HandGesture, PointerPosition, HandPointerPosition, RuntimeStatus, TargetInfo } from '../shared/types';
import { sendMessage } from '../shared/runtime';
import { findTargetAt } from './targetDetector';
import { TouchViewGestureMachine } from '../touchview/touchViewGesture';

/** All input coordinates are calibrated normalized viewport coordinates. */
export class TouchViewOverlay {
  readonly root = document.createElement('div');
  private shadow: ShadowRoot;
  private machine: TouchViewGestureMachine;
  private target: HTMLElement | null = null;
  private ids = new WeakMap<HTMLElement, string>();
  private nextId = 0;
  private lastFrame = 0;
  private paused = false;
  private source = '';
  private anchor = { x: 0, y: 0 };
  private lastTargetPoint = { x: -Infinity, y: -Infinity };
  private cachedTarget: { element: HTMLElement; info: TargetInfo } | null = null;
  private hasCachedTarget = false;
  private watchdog: number;
  constructor(private settings: HandFreeSettings) {
    this.machine = new TouchViewGestureMachine(settings.touchViewHoldDuration, settings.cooldownDuration, settings.touchViewStableHoldEnabled);
    this.root.id = 'handfree-touchview-root';
    this.shadow = this.root.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:#fff;font:14px/1.4 system-ui}
      *{box-sizing:border-box}.bar{position:fixed;top:12px;left:12px;display:flex;gap:8px;align-items:center;pointer-events:auto;background:#10151f;padding:8px;border-radius:8px}
      button{background:#151d2b;color:#fff;border:1px solid #65baff;border-radius:5px;min-height:44px;padding:8px 12px;font:inherit;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #fff;outline-offset:3px}#exit{border-color:#ff8585}
      .cursor{position:fixed;width:28px;height:28px;border:3px solid #42c8ff;border-radius:50%;background:#06233788;transform:translate3d(-50%,-50%,0);will-change:transform;display:none}
      .outline{position:fixed;border:3px solid #42c8ff;border-radius:4px;display:none;will-change:transform}.label{position:fixed;background:#10151f;padding:6px 10px;border-radius:5px;max-width:320px;display:none;will-change:transform}
      .progress{height:5px;background:#354155;margin-top:5px}.progress i{display:block;background:#72e9b2;height:100%;width:0}
      .drawer{position:fixed;top:84px;left:12px;width:300px;max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;background:#10151f;border:1px solid #65baff;border-radius:8px;padding:16px}.drawer[hidden]{display:none}label{display:block;margin:12px 0}input[type=range]{width:100%;accent-color:#42c8ff}a{color:#86ceff}.veil{position:fixed;inset:0;background:#000;pointer-events:none}.camera{position:fixed;right:16px;bottom:16px;width:240px;max-width:25vw;border-radius:8px;display:none;pointer-events:none}
    </style><div class="veil"></div><img class="camera" alt="Live camera preview"><div class="outline"></div><div class="cursor" aria-hidden="true"></div><div class="label"><span></span><div class="progress"><i></i></div></div>
    <div class="bar"><button id="settings" aria-label="TouchView settings" aria-expanded="false">Settings</button><button id="pause">Pause</button><button id="exit">Exit</button><span id="status" role="status">Waiting for tracking</span></div>
    <section class="drawer" hidden aria-label="TouchView settings"><h2>TouchView settings</h2><label>Website visibility<input data-key="touchViewWebsiteOpacity" type="range" min="0.2" max="1" step="0.05"></label><label>Camera preview opacity<input data-key="touchViewCameraOpacity" type="range" min="0" max="1" step="0.05"></label><label>Webcam scrim strength<input data-key="touchViewScrimOpacity" type="range" min="0" max="1" step="0.05"></label><label>Face landmark opacity<input data-key="touchViewFaceOpacity" type="range" min="0" max="1" step="0.05"></label><label>Hand landmark opacity<input data-key="touchViewHandOpacity" type="range" min="0" max="1" step="0.05"></label><label>Pinch threshold<input data-key="pinchThreshold" type="range" min="0.02" max="0.2" step="0.01"></label><label>Stable hold duration<input data-key="touchViewHoldDuration" type="range" min="600" max="2500" step="100"></label><label>Cursor size<input data-key="touchViewCursorSize" type="range" min="16" max="64" step="2"></label><label>Cursor opacity<input data-key="touchViewCursorOpacity" type="range" min="0.4" max="1" step="0.05"></label><label>Target highlight opacity<input data-key="touchViewHighlightOpacity" type="range" min="0.4" max="1" step="0.05"></label><label><input id="hold" type="checkbox"> Stable hold</label><label><input id="mirror" type="checkbox"> Mirror camera</label><label><input id="contrast" type="checkbox"> High contrast</label><p id="calibration"></p><button id="recalibrate">Open calibration</button><button id="reset">Reset calibration</button><p>Camera capture remains in the HandFree dashboard. Keep that tab open.</p></section>`;
    document.documentElement.append(this.root);
    this.el<HTMLButtonElement>('#settings').onclick = () => this.drawer();
    this.el<HTMLButtonElement>('#pause').onclick = () => { this.pause(!this.paused); void sendMessage({ type: this.paused ? 'PAUSE_TOUCHVIEW' : 'RESUME_TOUCHVIEW' }); };
    this.el<HTMLButtonElement>('#exit').onclick = () => { void sendMessage({ type: 'DISABLE_TOUCHVIEW' }); this.destroy(); };
    this.shadow.querySelectorAll<HTMLInputElement>('[data-key]').forEach(input => input.oninput = () => this.change({ [input.dataset.key!]: Number(input.value) }));
    this.el<HTMLInputElement>('#hold').onchange = e => this.change({ touchViewStableHoldEnabled: (e.target as HTMLInputElement).checked });
    this.el<HTMLInputElement>('#mirror').onchange = e => this.change({ mirrorCamera: (e.target as HTMLInputElement).checked, touchViewMirrorCamera: (e.target as HTMLInputElement).checked, calibration: null, touchViewCalibration: null });
    this.el<HTMLInputElement>('#contrast').onchange = e => this.change({ touchViewContrast: (e.target as HTMLInputElement).checked });
    this.el<HTMLButtonElement>('#recalibrate').onclick = () => window.open(chrome.runtime.getURL('dashboard.html'), '_blank', 'noopener');
    this.el<HTMLButtonElement>('#reset').onclick = () => this.change({ calibration: null, touchViewCalibration: null });
    this.configure(settings);
    this.shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') { this.el('.drawer').hidden = true; this.el('#settings').setAttribute('aria-expanded', 'false'); this.el('#settings').focus(); } });
    this.watchdog = window.setInterval(() => { if (!this.paused && performance.now() - this.lastFrame > 400) this.cancel('Tracking interrupted — no activation'); }, 100);
    window.addEventListener('scroll', this.onViewport, true);
    window.addEventListener('resize', this.onViewport);
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string): T { return this.shadow.querySelector<T>(selector)!; }
  private drawer(): void { const drawer = this.el('.drawer'); drawer.hidden = !drawer.hidden; this.el('#settings').setAttribute('aria-expanded', String(!drawer.hidden)); }
  private change(patch: Partial<HandFreeSettings>): void { this.configure({ ...this.settings, ...patch }); void sendMessage({ type: 'UPDATE_SETTINGS', settings: patch }); }
  configure(settings: HandFreeSettings): void {
    this.settings = settings;
    const head = this.source === 'head-tracking';
    this.machine.configure(head ? settings.dwellDuration : settings.touchViewHoldDuration, settings.cooldownDuration, head ? settings.dwellEnabled : settings.touchViewStableHoldEnabled);
    this.shadow.querySelectorAll<HTMLInputElement>('[data-key]').forEach(input => input.value = String(settings[input.dataset.key as keyof HandFreeSettings]));
    this.el<HTMLInputElement>('#hold').checked = settings.touchViewStableHoldEnabled;
    this.el<HTMLInputElement>('#mirror').checked = settings.mirrorCamera;
    this.el('#calibration').textContent = settings.calibration ? `Calibration saved · ${new Date(settings.calibration.createdAt).toLocaleString()}` : 'Calibration required — open dashboard';
    this.el('.cursor').style.width = this.el('.cursor').style.height = `${settings.touchViewCursorSize}px`;
    this.el('.veil').style.opacity = String(1 - settings.touchViewWebsiteOpacity);
    this.el('.camera').style.opacity = String(settings.touchViewCameraOpacity);
    this.el('.camera').style.transform = settings.mirrorCamera ? 'scaleX(-1)' : 'none';
    this.el('.cursor').style.opacity = String(settings.touchViewCursorOpacity);
    this.el('.outline').style.opacity = String(settings.touchViewHighlightOpacity);
    this.el<HTMLInputElement>('#contrast').checked = settings.touchViewContrast;
    this.el('.cursor').style.background = settings.touchViewContrast ? '#000' : '#06233788';
    this.el('.outline').style.boxShadow = settings.touchViewContrast ? '0 0 0 3px #fff' : '';
  }
  pause(paused: boolean): void { this.paused = paused; this.el('#pause').textContent = paused ? 'Resume' : 'Pause'; this.cancel(paused ? 'Paused' : 'Waiting for tracking'); }
  cancel(reason: string): void {
    const result = this.machine.update({ targetKey: null, gesture: 'pinch', confidence: 0, now: performance.now() });
    if (result.events.some(event => event.type === 'hold-cancelled')) this.cancelled();
    this.target = null; this.cachedTarget = null; this.hasCachedTarget = false; this.lastTargetPoint = { x: -Infinity, y: -Infinity }; this.el('.outline').style.display = this.el('.label').style.display = 'none'; this.el('.progress i').style.width = '0'; this.el('#status').textContent = reason;
  }
  private cancelled(): void { void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'TOUCHVIEW_HOLD_CANCELLED', mode: 'touchview', timestamp: Date.now(), outcome: 'cancelled' } }); }
  private onViewport = (): void => this.cancel('Viewport changed — reacquiring target');
  trackingStatus(status: Partial<RuntimeStatus>): void {
    const hand = this.settings.enabledModes.includes('hand');
    if (hand ? status.handTracking === 'lost' : status.trackingPhase === 'lost' || status.trackingPhase === 'face-not-detected' || status.trackingPhase === 'reinitializing') this.cancel('Tracking lost — activation cancelled');
  }
  cameraFrame(frame?: string): void { if (frame?.startsWith('data:image/jpeg;base64,')) { const image = this.el<HTMLImageElement>('.camera'); if (image.src !== frame) image.src = frame; image.style.display = 'block'; } }
  update(position: PointerPosition | HandPointerPosition, gesture: HandGesture = 'release'): void {
    this.lastFrame = performance.now();
    if (this.paused) return;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.confidence < 0.55) { this.cancel('Low tracking confidence'); return; }
    if (position.source !== this.source) {
      this.source = position.source;
      const head = position.source === 'head-tracking';
      this.machine.configure(head ? this.settings.dwellDuration : this.settings.touchViewHoldDuration, this.settings.cooldownDuration, head ? this.settings.dwellEnabled : this.settings.touchViewStableHoldEnabled);
    }
    const x = Math.max(0, Math.min(innerWidth - 1, position.x * innerWidth));
    const y = Math.max(0, Math.min(innerHeight - 1, position.y * innerHeight));
    const cursor = this.el('.cursor'); cursor.style.display = 'block'; cursor.style.transform = `translate3d(${x}px,${y}px,0) translate3d(-50%,-50%,0)`;
    const movedEnough = Math.hypot(x - this.lastTargetPoint.x, y - this.lastTargetPoint.y) >= 8;
    if (!this.hasCachedTarget || movedEnough || !this.cachedTarget?.element.isConnected) {
      this.cachedTarget = findTargetAt(x, y);
      this.hasCachedTarget = true;
      this.lastTargetPoint = { x, y };
    }
    const found = this.cachedTarget;
    if (found?.element !== this.target) {
      this.target = found?.element ?? null; this.anchor = { x, y };
      void sendMessage({ type: 'TARGET_UPDATE', target: found?.info ?? null });
    } else if (gesture !== 'pinch' && Math.hypot(x - this.anchor.x, y - this.anchor.y) > 18) {
      this.machine.update({ targetKey: null, gesture, confidence: 0, now: this.lastFrame }); this.anchor = { x, y };
    }
    if (!found) { this.cancel('Move onto a button, link or field'); return; }
    if (!this.ids.has(found.element)) this.ids.set(found.element, String(++this.nextId));
    const rect = found.element.getBoundingClientRect(); const outline = this.el('.outline');
    Object.assign(outline.style, { display: 'block', left: '0px', top: '0px', width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate3d(${rect.left}px,${rect.top}px,0)` });
    const label = this.el('.label'); Object.assign(label.style, { display: 'block', left: '0px', top: '0px', transform: `translate3d(${Math.min(x + 22, Math.max(0, innerWidth - 320))}px,${Math.min(y + 22, innerHeight - 70)}px,0)` });
    this.el('.label span').textContent = found.info.accessibleName;
    const result = this.machine.update({ targetKey: this.ids.get(found.element)!, gesture, confidence: position.confidence, now: this.lastFrame });
    if (result.events.some(event => event.type === 'hold-cancelled')) this.cancelled();
    this.el('.progress i').style.width = `${this.machine.progress(this.lastFrame) * 100}%`;
    this.el('#status').textContent = this.machine.state === 'RELEASE_WAIT' ? 'Release pinch before next click' : 'Tracking active';
    if (result.activate && found.element.isConnected && this.cachedTarget?.element === found.element && findTargetAt(x, y)?.element === found.element) {
      found.element.focus({ preventScroll: true }); found.element.click();
      const activation = result.events.find(event => event.type === 'activated');
      void sendMessage({ type: 'ACTIVATION_RESULT', success: true, method: activation?.method, duration: activation?.duration });
    }
  }
  destroy(): void { clearInterval(this.watchdog); window.removeEventListener('scroll', this.onViewport, true); window.removeEventListener('resize', this.onViewport); this.root.remove(); }
}
