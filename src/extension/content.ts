import { DEFAULT_SETTINGS, type HandFreeMessage, type HandFreeSettings } from '../shared/types';
import { PointerEngine } from '../content/pointerEngine';

let settings: HandFreeSettings = { ...DEFAULT_SETTINGS };
let engine = new PointerEngine(settings);

chrome.runtime.onMessage.addListener((message: HandFreeMessage) => {
  switch (message.type) {
    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.settings };
      engine.updateSettings(settings);
      break;
    case 'ENABLE_HAND_FREE':
      settings = { ...settings, ...message.settings, enabled: true };
      engine.updateSettings(settings);
      break;
    case 'DISABLE_HAND_FREE':
      settings = { ...settings, enabled: false, headControlEnabled: false, paused: false };
      engine.updateSettings(settings);
      break;
    case 'PAUSE_INTERACTION':
      settings = { ...settings, paused: true };
      engine.updateSettings(settings);
      break;
    case 'RESUME_INTERACTION':
      settings = { ...settings, enabled: true, paused: false };
      engine.updateSettings(settings);
      break;
    case 'POINTER_MOVEMENT':
      engine.move(message.position);
      break;
    case 'RECENTER_POINTER':
      engine.recenter();
      break;
  }
});

chrome.runtime.sendMessage({ type: 'TRACKING_STATUS', status: { trackingPhase: 'idle', faceDetected: false, confidence: 0 } });
