import type { HandFreeMessage, RuntimeStatus, HandFreeSettings } from './types';

export const isExtensionContext = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

function normalizeStatusSnapshot(message: HandFreeMessage): HandFreeMessage {
  // Chrome JSON omits undefined properties. Restore them on complete snapshots
  // so UI merges can clear a recovered diagnostic without changing wire types.
  const normalize = <T extends Pick<RuntimeStatus, 'error' | 'diagnostic' | 'currentTabTitle' | 'currentTabUrl'>>(status: T): T =>
    ({ ...status, error: status.error, diagnostic: status.diagnostic, currentTabTitle: status.currentTabTitle, currentTabUrl: status.currentTabUrl });
  if (message.type === 'STATE_RESPONSE') return { ...message, status: normalize(message.status) };
  if (message.type === 'ACTIVE_TAB_STATUS') return { ...message, status: normalize(message.status) };
  return message;
}

export async function sendMessage(message: HandFreeMessage): Promise<HandFreeMessage | undefined> {
  if (!isExtensionContext) return undefined;
  try {
    const response = await chrome.runtime.sendMessage(message) as HandFreeMessage | undefined;
    return response ? normalizeStatusSnapshot(response) : undefined;
  } catch {
    return undefined;
  }
}

export async function getState(): Promise<{ settings: HandFreeSettings; status: RuntimeStatus } | undefined> {
  const response = await sendMessage({ type: 'GET_STATE' });
  return response?.type === 'STATE_RESPONSE' ? { settings: response.settings, status: response.status } : undefined;
}

export function extensionUrl(path: string): string {
  return isExtensionContext ? chrome.runtime.getURL(path) : `/${path}`;
}

export function isControlTargetUrl(url = ''): boolean {
  return Boolean(url) && !/^about:(blank|srcdoc)(?:[?#]|$)/i.test(url)
    && !(isExtensionContext && url.startsWith(chrome.runtime.getURL('')));
}

export function isSupportedWebpageUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.hostname === 'chromewebstore.google.com' || parsed.hostname === 'microsoftedge.microsoft.com' && /^\/addons(?:\/|$)/i.test(parsed.pathname)) return false;
    if (parsed.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(parsed.pathname)) return false;
    return !/\.pdf(?:\/|$)/i.test(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
}

export async function findSupportedWebpageTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!isExtensionContext || !chrome.tabs?.query) return undefined;
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const eligible = tabs.filter(tab => tab.id !== undefined && isSupportedWebpageUrl(tab.url));
  const stored = await chrome.storage.session?.get('handfree-control-tab-id');
  const rememberedId = stored?.['handfree-control-tab-id'];
  if (typeof rememberedId === 'number') {
    const remembered = eligible.find(tab => tab.id === rememberedId);
    if (remembered) return remembered;
  }
  return eligible.find(tab => tab.active) ?? eligible[0];
}

export async function openDashboardInTab(controlTab?: chrome.tabs.Tab): Promise<void> {
  const url = extensionUrl('dashboard.html');
  if (isExtensionContext && chrome.tabs?.create) {
    const active = controlTab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (active?.id !== undefined && isControlTargetUrl(active.url)) {
      await chrome.storage.session.set({ 'handfree-control-tab-id': active.id });
    }
    const existing = (await chrome.tabs.query({})).find(tab => tab.id !== undefined && tab.url?.split(/[?#]/)[0] === url);
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function openTouchViewInTab(): Promise<void> {
  await openDashboardInTab();
}

export function subscribeToRuntimeMessages(callback: (message: HandFreeMessage) => HandFreeMessage | void | Promise<HandFreeMessage | void>): () => void {
  if (!isExtensionContext) return () => undefined;
  const listener = (message: HandFreeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: HandFreeMessage) => void) => {
    // Observers must never race the worker's canonical command response.
    try {
      const result = callback(normalizeStatusSnapshot(message));
      if (result instanceof Promise) {
        void result.then(response => { if (response !== undefined) sendResponse(response); }).catch(() => undefined);
        return true;
      }
      if (result !== undefined) sendResponse(result);
    } catch {
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
