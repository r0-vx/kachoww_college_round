import { DEFAULT_SETTINGS, DEFAULT_STATUS, type HandFreeMessage, type HandFreeSettings, type RuntimeStatus } from '../shared/types';
import { mergeSettings, saveSettings } from '../shared/storage';
import { recordAnalytics, resetAnalytics, summarizeAnalytics } from '../analytics/analytics';
import { diagnostic } from '../diagnostics/diagnostics';
import { calibrationGeometryCompatible } from '../tracking/coordinateMapping';
import { isControlTargetUrl, openDashboardInTab } from '../shared/runtime';

let settings: HandFreeSettings = { ...DEFAULT_SETTINGS };
let status: RuntimeStatus = { ...DEFAULT_STATUS };
const CONTROL_TAB_KEY = 'handfree-control-tab-id';
const TOUCHVIEW_TABS_KEY = 'handfree-touchview-tab-ids';
const touchViewTabs = new Set<number>();
const unsupportedMessage = 'TouchView cannot control this page because the browser does not allow extensions to inject interaction controls here.';

function isHandFreeNewTabUrl(url = ''): boolean {
  return url.split(/[?#]/)[0] === chrome.runtime.getURL('newtab.html');
}

async function broadcastNewTabState(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'NEW_TAB_STATE', settings, status }).catch(() => undefined);
}

// Top-level hydration runs on every MV3 worker wake, not only browser startup.
const initialized = (async () => {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get('handfree-settings'),
    chrome.storage.session.get(TOUCHVIEW_TABS_KEY)
  ]);
  settings = mergeSettings(stored['handfree-settings'] as Partial<HandFreeSettings> | undefined);
  const ids: unknown = session[TOUCHVIEW_TABS_KEY];
  if (settings.touchViewEnabled && Array.isArray(ids)) {
    const tabs = await chrome.tabs.query({});
    for (const id of ids) {
      if (typeof id === 'number' && tabs.some((tab) => tab.id === id)) touchViewTabs.add(id);
    }
  }
  await persistTouchViewTabs();
})();

chrome.runtime.onInstalled.addListener(() => {
  void initialized.then(() => saveSettings(settings));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['handfree-settings']) void enqueue(async () => {
    const stored = await chrome.storage.local.get('handfree-settings');
    settings = mergeSettings(stored['handfree-settings'] as Partial<HandFreeSettings> | undefined);
    await syncTouchViewTabs();
    await clearRecoveredCalibrationDiagnostic();
  });
});

// Serialize lifecycle changes so a reload cannot resurrect an exited overlay.
let pending: Promise<unknown> = initialized;
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.catch(() => undefined);
  return next;
}

async function persistTouchViewTabs(): Promise<void> {
  await chrome.storage.session.set({ [TOUCHVIEW_TABS_KEY]: [...touchViewTabs] });
}

function contentScriptError(module = 'background.touchview'): Extract<HandFreeMessage, { type: 'TOUCHVIEW_ERROR' }> {
  const detail = diagnostic('CONTENT_SCRIPT_UNAVAILABLE', module);
  status = { ...status, error: detail.explanation, diagnostic: detail };
  return { type: 'TOUCHVIEW_ERROR', reason: `CONTENT_SCRIPT_UNAVAILABLE: ${detail.explanation}`, diagnostic: detail };
}

async function reconnectTouchView(tabId: number, inject = true): Promise<HandFreeMessage> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || isRestrictedUrl(tab.url)) return { type: 'PAGE_UNSUPPORTED', reason: unsupportedMessage };
  const enable = async (): Promise<HandFreeMessage> => {
    await chrome.tabs.sendMessage(tabId, { type: 'UPDATE_SETTINGS', settings });
    const response = await chrome.tabs.sendMessage(tabId, { type: 'ENABLE_TOUCHVIEW' }) as HandFreeMessage | undefined;
    if (response?.type === 'PAGE_UNSUPPORTED') return response;
    if (response?.type !== 'PAGE_SUPPORTED') return contentScriptError();
    const target = await activeTab();
    await chrome.tabs.sendMessage(tabId, { type: settings.paused || settings.touchViewPaused || target?.id !== tabId ? 'PAUSE_TOUCHVIEW' : 'RESUME_TOUCHVIEW' });
    return response;
  };
  try {
    return await enable();
  } catch {
    if (!inject) return contentScriptError();
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['assets/content.js'] });
      return await enable();
    } catch {
      return contentScriptError();
    }
  }
}

async function activateTouchViewTab(tabId: number, inject = true): Promise<HandFreeMessage> {
  const response = await reconnectTouchView(tabId, inject);
  if (response.type === 'PAGE_SUPPORTED') {
    touchViewTabs.add(tabId);
    await persistTouchViewTabs();
  }
  return response;
}

async function activateAllSupportedTabs(): Promise<number[]> {
  const tabs = await chrome.tabs.query({});
  const activated: number[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || isRestrictedUrl(tab.url)) continue;
    const response = await activateTouchViewTab(tab.id);
    if (response.type === 'PAGE_SUPPORTED') activated.push(tab.id);
  }
  await persistTouchViewTabs();
  return activated;
}

async function syncTouchViewTabs(): Promise<void> {
  const target = await activeTab();
  for (const tabId of touchViewTabs) {
    if (!settings.touchViewEnabled) await sendToTab({ type: 'DISABLE_TOUCHVIEW' }, tabId);
    else {
      await sendToTab({ type: 'UPDATE_SETTINGS', settings }, tabId);
      await sendToTab({ type: settings.paused || settings.touchViewPaused || target?.id !== tabId ? 'PAUSE_TOUCHVIEW' : 'RESUME_TOUCHVIEW' }, tabId);
    }
  }
  if (!settings.touchViewEnabled) touchViewTabs.clear();
  await persistTouchViewTabs();
  await broadcastNewTabState();
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status || change.url || change.title) void enqueue(async () => {
    if (change.url && isControlTargetUrl(change.url)) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.id === tabId) await chrome.storage.session.set({ [CONTROL_TAB_KEY]: tabId });
    }
    // `change.url` is not guaranteed to be present on the final `complete`
    // event. Read the tab so a reload/navigation cannot silently skip the
    // reconnect because an empty URL looks unsupported.
    const updatedTab = await chrome.tabs.get(tabId).catch(() => undefined);
    const updatedUrl = updatedTab?.url ?? change.url;
    if (change.status === 'complete' && settings.touchViewEnabled) {
      if (isHandFreeNewTabUrl(updatedUrl)) await broadcastNewTabState();
      else if (!isRestrictedUrl(updatedUrl)) {
        await activateTouchViewTab(tabId);
        await syncTouchViewTabs();
      }
    }
    if ((await activeTab())?.id === tabId) await broadcastActiveTabStatus();
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    touchViewTabs.delete(tabId);
    await persistTouchViewTabs();
    const stored = await chrome.storage.session.get(CONTROL_TAB_KEY);
    if (stored[CONTROL_TAB_KEY] === tabId) await chrome.storage.session.remove(CONTROL_TAB_KEY);
    await broadcastActiveTabStatus();
  });
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  void enqueue(async () => {
    if (settings.touchViewEnabled && tab.status === 'complete' && !isRestrictedUrl(tab.url)) {
      await activateTouchViewTab(tab.id!);
      await syncTouchViewTabs();
    }
  });
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void enqueue(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab && isControlTargetUrl(tab.url)) {
      await chrome.storage.session.set({ [CONTROL_TAB_KEY]: tabId });
    }
    if (settings.touchViewEnabled && tab?.id !== undefined && !isRestrictedUrl(tab.url)) await activateTouchViewTab(tabId);
    if (settings.touchViewEnabled) await syncTouchViewTabs();
    if (settings.touchViewEnabled && isHandFreeNewTabUrl(tab?.url)) await broadcastNewTabState();
    await broadcastActiveTabStatus();
  });
});

chrome.action.onClicked.addListener((tab) => {
  // The toolbar action is the quick dropdown surface. Keep the webpage in
  // place and open the side panel; the full dashboard is an explicit action
  // from that panel, so enabling TouchView cannot bounce the user in a loop.
  void (async () => {
    if (tab.id !== undefined && isControlTargetUrl(tab.url)) {
      await chrome.storage.session.set({ [CONTROL_TAB_KEY]: tab.id });
    }
    let openedSidePanel = false;
    if (tab.windowId !== undefined && chrome.sidePanel?.open) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        openedSidePanel = true;
      } catch {
        openedSidePanel = false;
      }
    }
    if (!openedSidePanel) await openDashboardInTab(tab);
    await enqueue(() => broadcastActiveTabStatus());
  })();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void enqueue(async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id !== undefined && isControlTargetUrl(active.url)) {
      await chrome.storage.session.set({ [CONTROL_TAB_KEY]: active.id });
    }
    if (settings.touchViewEnabled) await syncTouchViewTabs();
    await broadcastActiveTabStatus();
  });
});

function isDashboardUrl(url = ''): boolean {
  return url.split(/[?#]/)[0] === chrome.runtime.getURL('dashboard.html');
}

function isInternalPracticeMessage(url: string | undefined, message: HandFreeMessage): boolean {
  const page = url?.split(/[?#]/)[0];
  // These pages own their practice UI. This is not extension-page injection.
  return (page === chrome.runtime.getURL('demo.html') || page === chrome.runtime.getURL('touchview.html'))
    && ['VOICE_COMMAND', 'DICTATION_TEXT', 'FOCUS_FIELD', 'SENSE_QUERY', 'PAGE_STRUCTURE_REQUEST'].includes(message.type);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) return undefined;
  // The dashboard and side panel are extension pages. They cannot host the
  // webpage overlay, so resolve the user's most useful normal tab instead.
  // A focused restricted browser surface must remain the selected tab so the
  // caller can report PAGE_UNSUPPORTED instead of sending input to an older
  // remembered webpage.
  const extensionPage = active.url?.startsWith(chrome.runtime.getURL('')) ?? false;
  if (isRestrictedUrl(active.url) && !extensionPage) return active;
  if (!isDashboardUrl(active.url) && isControlTargetUrl(active.url) && !isRestrictedUrl(active.url)) return active;
  const stored = await chrome.storage.session.get(CONTROL_TAB_KEY);
  const controlTabId: unknown = stored[CONTROL_TAB_KEY];
  if (typeof controlTabId === 'number') {
    try {
      const remembered = await chrome.tabs.get(controlTabId);
      if (isControlTargetUrl(remembered.url) && !isRestrictedUrl(remembered.url)) return remembered;
      await chrome.storage.session.remove(CONTROL_TAB_KEY);
    } catch {
      await chrome.storage.session.remove(CONTROL_TAB_KEY);
    }
  }
  // Recover gracefully when the dashboard was opened directly, or after the
  // remembered tab was closed. Prefer the active normal tab, then any normal
  // tab in the focused window. Never select another extension page.
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs.find((tab) => tab.id !== undefined && isControlTargetUrl(tab.url) && !isRestrictedUrl(tab.url));
}

async function messageTarget(message: HandFreeMessage): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && isInternalPracticeMessage(active.url, message)) return active;
  const stored = await chrome.storage.session.get(CONTROL_TAB_KEY);
  if (typeof stored[CONTROL_TAB_KEY] === 'number') {
    const remembered = await chrome.tabs.get(stored[CONTROL_TAB_KEY] as number).catch(() => undefined);
    if (remembered && isInternalPracticeMessage(remembered.url, message)) return remembered;
  }
  return activeTab();
}

function isRestrictedUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    if (parsed.hostname === 'chromewebstore.google.com' || parsed.hostname === 'microsoftedge.microsoft.com' && /^\/addons(?:\/|$)/i.test(parsed.pathname)) return true;
    if (parsed.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(parsed.pathname)) return true;
    return /\.pdf(?:\/|$)/i.test(decodeURIComponent(parsed.pathname));
  } catch {
    return true;
  }
}

async function sendToTab(message: HandFreeMessage, tabId?: number): Promise<boolean> {
  const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => undefined) : await activeTab();
  if (tab?.id === undefined || isRestrictedUrl(tab.url) && !isInternalPracticeMessage(tab.url, message)) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    return false;
  }
}

async function getActiveTabStatus(): Promise<HandFreeMessage> {
  const tab = await activeTab();
  const supported = Boolean(tab?.id !== undefined && (isHandFreeNewTabUrl(tab.url) || !isRestrictedUrl(tab.url)));
  // Page eligibility must not erase or replace camera/calibration failures.
  if (!status.diagnostic || status.diagnostic.code === 'UNSUPPORTED_PAGE') {
    const pageDiagnostic = supported ? undefined : diagnostic('UNSUPPORTED_PAGE', 'background.activeTab');
    if (pageDiagnostic) status = { ...status, error: pageDiagnostic.explanation, diagnostic: pageDiagnostic };
    else if (status.diagnostic?.code === 'UNSUPPORTED_PAGE') status = { ...status, error: undefined, diagnostic: undefined };
  }
  status = { ...status, currentTabSupported: supported, currentTabTitle: tab?.title, currentTabUrl: tab?.url };
  return { type: 'ACTIVE_TAB_STATUS', status: { currentTabSupported: status.currentTabSupported, currentTabTitle: status.currentTabTitle, currentTabUrl: status.currentTabUrl, error: status.error, diagnostic: status.diagnostic } };
}

async function broadcastActiveTabStatus(): Promise<void> {
  const message = await getActiveTabStatus();
  await chrome.runtime.sendMessage(message).catch(() => undefined);
  await broadcastState();
}

async function broadcastState(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'STATE_RESPONSE', settings, status }).catch(() => undefined);
}

async function clearRecoveredCalibrationDiagnostic(): Promise<void> {
  if (!status.diagnostic || !['CALIBRATION_REQUIRED', 'CALIBRATION_INVALID', 'CALIBRATION_QUALITY_LOW', 'MIRROR_CONFIGURATION_INVALID', 'VIEWPORT_MAPPING_FAILED'].includes(status.diagnostic.code)) return;
  if (status.trackingPhase !== 'tracking' && status.handTracking !== 'tracking') return;
  const stored = await chrome.storage.local.get('handfree-settings');
  const persisted = mergeSettings(stored['handfree-settings'] as Partial<HandFreeSettings> | undefined);
  const calibration = persisted.calibration;
  if (!calibration?.geometry || !calibrationGeometryCompatible(calibration, calibration.geometry, undefined, persisted.mirrorCamera)) return;
  status = { ...status, error: undefined, diagnostic: undefined };
  await broadcastState();
}

async function handleMessage(message: HandFreeMessage, sender: chrome.runtime.MessageSender): Promise<HandFreeMessage | undefined> {
  switch (message.type) {
    case 'ENABLE_TOUCHVIEW': {
      const tab = message.tabId !== undefined
        ? await chrome.tabs.get(message.tabId).catch(() => undefined)
        : sender.tab?.url && isControlTargetUrl(sender.tab.url) && !isRestrictedUrl(sender.tab.url) ? sender.tab : await activeTab();
      const newTabPage = isHandFreeNewTabUrl(tab?.url);
      if (tab?.id === undefined || isRestrictedUrl(tab.url) && !newTabPage) {
        return { type: 'PAGE_UNSUPPORTED', reason: tab ? unsupportedMessage : 'Open a normal HTTPS webpage in another tab, then enable TouchView.' };
      }
      const previous = settings;
      settings = mergeSettings({ ...settings, enabled: true, paused: false, touchViewEnabled: true, touchViewPaused: false,
        enabledModes: [...new Set([...settings.enabledModes, 'touchview' as const])] });
      // ENABLE loads settings in content, so persist before asking for its ack.
      await saveSettings(settings);
      await chrome.storage.session.set({ [CONTROL_TAB_KEY]: tab.id });
      if (newTabPage) {
        await broadcastNewTabState();
        return { type: 'PAGE_SUPPORTED' };
      }
      const newlyEnabled = !touchViewTabs.has(tab.id);
      const response = await activateTouchViewTab(tab.id);
      if (response.type !== 'PAGE_SUPPORTED') {
        settings = previous;
        await saveSettings(settings);
        if (!touchViewTabs.has(tab.id)) await sendToTab({ type: 'DISABLE_TOUCHVIEW' }, tab.id);
        await sendToTab({ type: 'UPDATE_SETTINGS', settings }, tab.id);
        return response;
      }
      // TouchView is persistent while enabled. The requested tab is enabled
      // first, then every other currently supported tab is connected.
      await activateAllSupportedTabs();
      await syncTouchViewTabs();
      if (settings.analyticsEnabled && newlyEnabled) await recordAnalytics({ type: 'TOUCHVIEW_ENABLED', timestamp: Date.now(), mode: 'touchview', outcome: 'success' });
      if (status.diagnostic?.code === 'CONTENT_SCRIPT_UNAVAILABLE') status = { ...status, error: undefined, diagnostic: undefined };
      return { type: 'PAGE_SUPPORTED' };
    }
    case 'DISABLE_TOUCHVIEW':
    case 'PAUSE_TOUCHVIEW':
    case 'RESUME_TOUCHVIEW': {
      const disabled = message.type === 'DISABLE_TOUCHVIEW';
      const paused = message.type === 'PAUSE_TOUCHVIEW';
      const wasEnabled = settings.touchViewEnabled;
      const wasPaused = settings.touchViewPaused || settings.paused;
      settings = mergeSettings({ ...settings, touchViewEnabled: disabled ? false : settings.touchViewEnabled,
        touchViewPaused: paused, paused, ...(disabled ? { enabledModes: settings.enabledModes.filter((mode) => mode !== 'touchview') } : {}) });
      await saveSettings(settings);
      await syncTouchViewTabs();
      if (settings.analyticsEnabled && wasEnabled && (disabled || wasPaused !== paused)) {
        await recordAnalytics({ type: disabled ? 'TOUCHVIEW_DISABLED' : paused ? 'TOUCHVIEW_PAUSED' : 'TOUCHVIEW_RESUMED', timestamp: Date.now(), mode: 'touchview', outcome: 'success' });
      }
      return { type: 'STATE_RESPONSE', settings, status };
    }
    case 'SET_TOUCHVIEW_SETTINGS':
      settings = mergeSettings({ ...settings, ...message.settings });
      await saveSettings(settings);
      await syncTouchViewTabs();
      return { type: 'STATE_RESPONSE', settings, status };
    case 'GET_STATE':
      return { type: 'STATE_RESPONSE', settings, status };
    case 'CONTENT_SCRIPT_READY':
      if (sender.tab?.id !== undefined && sender.frameId === 0 && settings.touchViewEnabled && !isRestrictedUrl(sender.tab.url)) {
        return activateTouchViewTab(sender.tab.id, false);
      }
      return { type: 'STATE_RESPONSE', settings, status };
    case 'NEW_TAB_READY':
      await broadcastNewTabState();
      return settings.touchViewEnabled ? { type: 'NEW_TAB_STATE', settings, status } : { type: 'STATE_RESPONSE', settings, status };
    case 'GET_ACTIVE_TAB_STATUS':
      return getActiveTabStatus();
    case 'UPDATE_SETTINGS':
      settings = mergeSettings({ ...settings, ...message.settings });
      await saveSettings(settings);
      await clearRecoveredCalibrationDiagnostic();
      await syncTouchViewTabs();
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'ENABLE_HAND_FREE':
      settings = mergeSettings({ ...settings, ...message.settings, enabled: true, touchViewEnabled: true,
        enabledModes: [...new Set([...(message.settings?.enabledModes ?? settings.enabledModes), 'touchview' as const])] });
      await saveSettings(settings);
      await activateAllSupportedTabs();
      await syncTouchViewTabs();
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'DISABLE_HAND_FREE':
      settings = mergeSettings({ ...settings, enabled: false, paused: false, headControlEnabled: false, touchViewEnabled: false, touchViewPaused: false });
      await saveSettings(settings);
      await syncTouchViewTabs();
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'PAUSE_INTERACTION':
      settings = mergeSettings({ ...settings, paused: true, touchViewPaused: settings.touchViewEnabled });
      await saveSettings(settings);
      await syncTouchViewTabs();
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'RESUME_INTERACTION':
      settings = mergeSettings({ ...settings, paused: false, touchViewPaused: false, enabled: true });
      await saveSettings(settings);
      await syncTouchViewTabs();
      await sendToTab(message);
      return { type: 'STATE_RESPONSE', settings, status };
    case 'POINTER_UPDATE': {
      const [browserActive] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (isHandFreeNewTabUrl(browserActive?.url)) {
        await chrome.runtime.sendMessage({ type: 'NEW_TAB_POINTER_UPDATE', position: message.position, gesture: message.gesture, cameraFrame: message.cameraFrame }).catch(() => undefined);
        return undefined;
      }
      const tab = await activeTab();
      if (tab?.id === undefined || !settings.touchViewEnabled || !touchViewTabs.has(tab.id) || settings.paused || settings.touchViewPaused) return undefined;
      if (![message.position.x, message.position.y, message.position.confidence].every(Number.isFinite)) return undefined;
      // Dashboard owns calibration and camera capture; preserve both payloads.
      await sendToTab(message, tab.id);
      return undefined;
    }
    case 'TARGET_UPDATE':
      if (settings.analyticsEnabled && message.target) await recordAnalytics({
        type: 'TOUCHVIEW_TARGET_HOVERED',
        timestamp: Date.now(), mode: 'touchview',
        targetRole: message.target.tagName
      });
      return undefined;
    case 'ACTIVATION_RESULT':
      if (settings.analyticsEnabled) {
        await recordAnalytics({ type: message.success ? 'TOUCHVIEW_TARGET_ACTIVATED' : 'TOUCHVIEW_ACTIVATION_REJECTED', timestamp: Date.now(), mode: 'touchview', outcome: message.success ? 'success' : 'rejected', duration: message.duration, metadata: { activationMethod: message.method ?? 'stable-hold' } });
        if (message.success && message.method === 'pinch') await recordAnalytics({ type: 'TOUCHVIEW_PINCH_ACTIVATED', timestamp: Date.now(), mode: 'touchview', outcome: 'success' });
      }
      return undefined;
    case 'RECENTER_POINTER':
    case 'TARGET_HIGHLIGHT':
    case 'DWELL_STARTED':
    case 'DWELL_CANCELLED':
    case 'DWELL_COMPLETED':
      if (settings.analyticsEnabled && (message.type === 'DWELL_STARTED' || message.type === 'DWELL_CANCELLED' || message.type === 'DWELL_COMPLETED')) {
        await recordAnalytics({ type: settings.touchViewEnabled && message.type === 'DWELL_CANCELLED' ? 'TOUCHVIEW_HOLD_CANCELLED' : message.type === 'DWELL_STARTED' ? 'dwell-started' : message.type === 'DWELL_CANCELLED' ? 'dwell-cancelled' : 'dwell-completed', timestamp: Date.now(), mode: settings.touchViewEnabled ? 'touchview' : 'head', outcome: message.type === 'DWELL_COMPLETED' ? 'success' : message.type === 'DWELL_CANCELLED' ? 'cancelled' : undefined });
      }
      if (sender.tab?.id) await sendToTab(message, sender.tab.id);
      else await sendToTab(message);
      return undefined;
    case 'VOICE_COMMAND':
    case 'DICTATION_TEXT':
    case 'FOCUS_FIELD':
    case 'PAGE_STRUCTURE_REQUEST':
      {
        const tab = await messageTarget(message);
        if (tab?.id !== undefined) await sendToTab(message, tab.id);
      }
      return undefined;
    case 'SENSE_QUERY': {
      const tab = await messageTarget(message);
      if (tab?.id === undefined || isRestrictedUrl(tab.url) && !isInternalPracticeMessage(tab.url, message)) {
        return { type: 'PAGE_UNSUPPORTED', reason: 'Sense cannot read this page because the browser does not allow access to its content.' };
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, message) as HandFreeMessage | undefined;
        if (response?.type === 'SENSE_RESPONSE' || response?.type === 'PAGE_UNSUPPORTED' || response?.type === 'TOUCHVIEW_ERROR') return response;
        return contentScriptError('background.sense');
      } catch {
        return contentScriptError('background.sense');
      }
    }
    case 'CANCEL_DWELL':
      if (settings.analyticsEnabled && settings.touchViewEnabled) await recordAnalytics({ type: 'TOUCHVIEW_HOLD_CANCELLED', timestamp: Date.now(), mode: 'touchview', outcome: 'cancelled' });
      await sendToTab(message);
      return undefined;
    case 'TRACKING_STATUS': {
      const handLost = message.status.handTracking === 'lost' && status.handTracking !== 'lost';
      const trackingLost = message.status.trackingPhase === 'lost' && status.trackingPhase !== 'lost';
      status = { ...status, ...message.status, error: message.status.error ?? status.error, diagnostic: message.status.diagnostic ?? status.diagnostic };
      await chrome.runtime.sendMessage({ type: 'NEW_TAB_CAMERA_FRAME', frame: message.status.cameraFrame, status: message.status }).catch(() => undefined);
      if (!message.status.diagnostic && !message.status.error) await clearRecoveredCalibrationDiagnostic();
      // Cancel pending holds before waiting for analytics persistence.
      for (const tabId of touchViewTabs) await sendToTab(message, tabId);
      if (settings.analyticsEnabled && settings.touchViewEnabled && (handLost || trackingLost)) {
        await recordAnalytics({ type: 'tracking-lost', timestamp: Date.now(), mode: 'touchview', outcome: 'lost' });
        if (handLost) await recordAnalytics({ type: 'TOUCHVIEW_HAND_LOST', timestamp: Date.now(), mode: 'touchview', outcome: 'lost' });
        await recordAnalytics({ type: 'TOUCHVIEW_HOLD_CANCELLED', timestamp: Date.now(), mode: 'touchview', outcome: 'cancelled' });
      }
      return undefined;
    }
    case 'CALIBRATION_UPDATED':
      settings = mergeSettings({ ...settings, calibration: message.calibration, touchViewCalibration: message.calibration });
      await saveSettings(settings);
      await clearRecoveredCalibrationDiagnostic();
      for (const tabId of touchViewTabs) await sendToTab({ type: 'CALIBRATION_UPDATED', calibration: message.calibration }, tabId);
      await syncTouchViewTabs();
      return { type: 'STATE_RESPONSE', settings, status };
    case 'PERMISSION_STATUS':
      status = { ...status, permission: message.permission, error: message.error };
      return undefined;
    case 'ERROR_STATUS':
      status = { ...status, trackingPhase: 'error', error: message.error, diagnostic: message.diagnostic ?? status.diagnostic };
      return undefined;
    case 'MIC_PERMISSION_STATUS':
      status = { ...status, microphone: message.microphone, ...(message.error ? { error: message.error } : {}) };
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
  enqueue(() => handleMessage(message, sender)).then((response) => sendResponse(response)).catch(() => {
    sendResponse(message.type === 'ENABLE_TOUCHVIEW' || message.type === 'SENSE_QUERY'
      ? contentScriptError(message.type === 'SENSE_QUERY' ? 'background.sense' : undefined) : undefined);
  });
  return true;
});
