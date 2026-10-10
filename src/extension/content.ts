import { type HandFreeMessage } from '../shared/types';
import { loadSettings, subscribeToSettings } from '../shared/storage';
import { sendMessage } from '../shared/runtime';
import { TouchViewOverlay } from '../content/touchViewOverlay';
import { handleDictation, handleVoiceTranscript, handleSenseQuery, pageNodes } from '../content/voiceExecutor';

const scope = globalThis as typeof globalThis & { handfreeContentInstalled?: boolean };
if (!scope.handfreeContentInstalled) {
  scope.handfreeContentInstalled = true;
  let overlay: TouchViewOverlay | null = null;
  let settingsPromise = loadSettings();
  subscribeToSettings(settings => { settingsPromise = Promise.resolve(settings); overlay?.configure(settings); });
  chrome.runtime.onMessage.addListener((message: HandFreeMessage, _sender, reply) => {
    const handle = async () => {
      switch (message.type) {
        case 'ENABLE_TOUCHVIEW':
          if (!overlay?.root.isConnected) { overlay?.destroy(); overlay = new TouchViewOverlay(await settingsPromise); }
          overlay.pause(false); return { type: 'PAGE_SUPPORTED' };
        case 'DISABLE_TOUCHVIEW': overlay?.destroy(); overlay = null; break;
        case 'PAUSE_TOUCHVIEW': case 'PAUSE_INTERACTION': overlay?.pause(true); break;
        case 'RESUME_TOUCHVIEW': case 'RESUME_INTERACTION': overlay?.pause(false); break;
        case 'POINTER_UPDATE': overlay?.cameraFrame(message.cameraFrame); overlay?.update(message.position, message.gesture); break;
        case 'TRACKING_STATUS':
          overlay?.trackingStatus(message.status);
          break;
        case 'UPDATE_SETTINGS': settingsPromise = settingsPromise.then(settings => ({ ...settings, ...message.settings })); overlay?.configure(await settingsPromise); break;
        case 'CALIBRATION_UPDATED': settingsPromise = settingsPromise.then(settings => ({ ...settings, calibration: message.calibration, touchViewCalibration: message.calibration })); overlay?.configure(await settingsPromise); break;
        case 'DISABLE_HAND_FREE': overlay?.pause(true); break;
        case 'CANCEL_DWELL': case 'RECENTER_POINTER': overlay?.cancel('Activation cancelled'); break;
        case 'VOICE_COMMAND': handleVoiceTranscript(message.transcript); break;
        case 'DICTATION_TEXT': handleDictation(message.text, message.isFinal); break;
        case 'FOCUS_FIELD': handleVoiceTranscript(`focus ${message.query}`); break;
        case 'PAGE_STRUCTURE_REQUEST': void sendMessage({ type: 'PAGE_STRUCTURE_RESPONSE', nodes: pageNodes() }); break;
        case 'SENSE_QUERY': return handleSenseQuery(message.query);
      }
      return undefined;
    };
    void handle().then(reply).catch(error => reply({ type: 'TOUCHVIEW_ERROR', reason: `CONTENT_SCRIPT_UNAVAILABLE: ${String(error)}` }));
    return true;
  });
  void sendMessage({ type: 'CONTENT_SCRIPT_READY' });
}
