import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeMessage, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { saveSettings } from '../shared/storage';
import { recordAnalytics, resetAnalytics, summarizeAnalytics } from '../analytics/analytics';

let settings: HandFreeSettings = { ...DEFAULT_SETTINGS };
let status: RuntimeStatus = { ...DEFAULT_STATUS };
const CONTROL_TAB_KEY = 'handfree-control-tab-id';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('handfree-settings');
  settings = { ...DEFAULT_SETTINGS, ...(stored['handfree-settings'] as Partial<HandFreeSettings> | undefined) };
  await saveSettings(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get('handfree-settings');
  settings = { ...DEFAULT_SETTINGS, ...(stored['handfree-settings'] as Partial<HandFreeSettings> | undefined) };
});

chrome.storage.onChanged.addListener((changes) => {
  const saved = changes['handfree-settings']?.newValue as Partial<HandFreeSettings> | undefined;
  if (saved) settings = { ...DEFAULT_SETTINGS, ...saved };
});

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const stored = await chrome.storage.local.get(CONTROL_TAB_KEY);
  const controlTabId = stored[CONTROL_TAB_KEY] as number | undefined;
  if (controlTabId) {
    try {
      const controlTab = await chrome.tabs.get(controlTabId);
      if (controlTab.id && controlTab.url && !isRestrictedUrl(controlTab.url)) return controlTab;
    } catch {
      await chrome.storage.local.remove(CONTROL_TAB_KEY);
    }
  }
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find((tab) => Boolean(tab.id && tab.url && !isRestrictedUrl(tab.url) && !tab.url.startsWith('file:'))) ?? tabs[0];
}

function isRestrictedUrl(url = ''): boolean {
  return /^(chrome|edge|about|brave|view-source|devtools):/i.test(url) || url.startsWith('chrome-extension://');
}

async function sendToTab(message: HandFreeMessage, tabId?: number): Promise<boolean> {
  const tab = tabId ? { id: tabId } : await activeTab();
  const tabUrl = tab && 'url' in tab ? tab.url : undefined;
  if (!tab?.id || isRestrictedUrl(tabUrl)) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    return false;
  }
}

async function getActiveTabStatus(): Promise<HandFreeMessage> {
  const tab = await activeTab();
  const supported = Boolean(tab?.id && tab.url && !isRestrictedUrl(tab.url) && !tab.url.startsWith('file:'));
  status = { ...status, currentTabSupported: supported, currentTabTitle: tab?.title, currentTabUrl: tab?.url, error: supported ? undefined : 'This page cannot be controlled by HandFree. Open a normal webpage or the Demo Lab.' };
  return { type: 'ACTIVE_TAB_STATUS', status: { currentTabSupported: status.currentTabSupported, currentTabTitle: status.currentTabTitle, currentTabUrl: status.currentTabUrl, error: status.error } };
}

async function handleMessage(message: HandFreeMessage, sender: chrome.runtime.MessageSender): Promise<HandFreeMessage | undefined> {
  switch (message.type) {
    case 'GET_STATE':
      return { type: 'STATE_RESPONSE', settings, status };
    case 'GET_ACTIVE_TAB_STATUS':
      return getActiveTabStatus();
    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.settings };
      await saveSettings(settings);
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'ENABLE_HAND_FREE':
      settings = { ...settings, ...message.settings, enabled: true };
      await saveSettings(settings);
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'DISABLE_HAND_FREE':
      settings = { ...settings, enabled: false, paused: false, headControlEnabled: false };
      await saveSettings(settings);
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'PAUSE_INTERACTION':
      settings = { ...settings, paused: true };
      await saveSettings(settings);
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'RESUME_INTERACTION':
      settings = { ...settings, paused: false, enabled: true };
      await saveSettings(settings);
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'RECENTER_POINTER':
    case 'POINTER_MOVEMENT':
    case 'HAND_POINTER_MOVEMENT':
    case 'HAND_GESTURE':
    case 'TOUCHVIEW_POINTER_MOVEMENT':
    case 'TOUCHVIEW_CONTROL':
    case 'TARGET_HIGHLIGHT':
    case 'DWELL_STARTED':
    case 'DWELL_CANCELLED':
    case 'DWELL_COMPLETED':
      if (settings.analyticsEnabled && (message.type === 'DWELL_STARTED' || message.type === 'DWELL_CANCELLED' || message.type === 'DWELL_COMPLETED')) {
        await recordAnalytics({ type: message.type === 'DWELL_STARTED' ? 'dwell-started' : message.type === 'DWELL_CANCELLED' ? 'dwell-cancelled' : 'dwell-completed', timestamp: Date.now(), mode: 'head', outcome: message.type === 'DWELL_COMPLETED' ? 'success' : 'cancelled' });
      }
      if (sender.tab?.id) await sendToTab(message, sender.tab.id);
      else await sendToTab(message);
      return undefined;
    case 'VOICE_COMMAND':
    case 'DICTATION_TEXT':
    case 'FOCUS_FIELD':
    case 'PAGE_STRUCTURE_REQUEST':
    case 'SENSE_QUERY':
    case 'CANCEL_DWELL':
      await sendToTab(message);
      return undefined;
    case 'TRACKING_STATUS':
      status = { ...status, ...message.status };
      return undefined;
    case 'PERMISSION_STATUS':
      status = { ...status, permission: message.permission, error: message.error };
      return undefined;
    case 'ERROR_STATUS':
      status = { ...status, trackingPhase: 'error', error: message.error };
      return undefined;
    case 'MIC_PERMISSION_STATUS':
      status = { ...status, microphone: message.microphone, error: message.error };
      return undefined;
    case 'VOICE_STATUS':
      status = { ...status, voice: message.voice, voiceMessage: message.message };
      return undefined;
    case 'ANALYTICS_EVENT':
      if (settings.analyticsEnabled) await recordAnalytics(message.event);
      return undefined;
    case 'ANALYTICS_SUMMARY_REQUEST':
      return { type: 'ANALYTICS_SUMMARY_RESPONSE', summary: await summarizeAnalytics() };
    case 'ANALYTICS_RESET':
      await resetAnalytics();
      return undefined;
    case 'OPEN_SIDE_PANEL': {
      const tab = await activeTab();
      if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
      return undefined;
    }
    case 'OPEN_NEW_TAB':
      await chrome.tabs.create({});
      return undefined;
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: HandFreeMessage, sender, sendResponse) => {
  handleMessage(message, sender).then((response) => sendResponse(response)).catch(() => sendResponse(undefined));
  return true;
});
