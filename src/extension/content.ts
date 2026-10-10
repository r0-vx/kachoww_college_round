import { DEFAULT_SETTINGS, type HandFreeMessage, type HandFreeSettings } from '../shared/types';
import { PointerEngine } from '../content/pointerEngine';
import { handleDictation, handleVoiceTranscript, pageNodes } from '../content/voiceExecutor';

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
    case 'HAND_POINTER_MOVEMENT':
      engine.move(message.position);
      if (message.gesture === 'pinch') engine.activateCurrentTarget();
      if (message.gesture === 'open-palm') void chrome.runtime.sendMessage({ type: 'PAUSE_INTERACTION', reason: 'Open palm gesture' });
      break;
    case 'HAND_GESTURE':
      if (message.gesture === 'pinch') engine.activateCurrentTarget();
      if (message.gesture === 'open-palm') void chrome.runtime.sendMessage({ type: 'PAUSE_INTERACTION', reason: 'Open palm gesture' });
      break;
    case 'TOUCHVIEW_CONTROL':
      settings = { ...settings, enabled: message.active, paused: message.paused, headControlEnabled: false, enabledModes: message.active ? ['hand'] : settings.enabledModes };
      engine.updateSettings(settings);
      break;
    case 'TOUCHVIEW_POINTER_MOVEMENT':
      settings = { ...settings, enabled: true, paused: message.paused, headControlEnabled: false, enabledModes: ['hand'] };
      engine.updateSettings(settings);
      engine.move(message.position);
      if (!message.paused && message.gesture === 'pinch') engine.activateCurrentTarget();
      break;
    case 'RECENTER_POINTER':
      engine.recenter();
      break;
    case 'CANCEL_DWELL':
      engine.cancelDwell('Cancelled by user');
      break;
    case 'VOICE_COMMAND':
      handleVoiceTranscript(message.transcript);
      break;
    case 'DICTATION_TEXT':
      handleDictation(message.text, message.isFinal);
      break;
    case 'FOCUS_FIELD':
      handleVoiceTranscript(`focus ${message.query}`);
      break;
    case 'PAGE_STRUCTURE_REQUEST':
      void chrome.runtime.sendMessage({ type: 'PAGE_STRUCTURE_RESPONSE', nodes: pageNodes() });
      break;
    case 'SENSE_QUERY':
      handleVoiceTranscript(message.query);
      break;
  }
});

chrome.runtime.sendMessage({ type: 'TRACKING_STATUS', status: { trackingPhase: 'idle', faceDetected: false, confidence: 0 } });
