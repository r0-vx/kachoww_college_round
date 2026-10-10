import type { HandFreeMessage, RuntimeStatus, HandFreeSettings } from './types';

export const isExtensionContext = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

export async function sendMessage(message: HandFreeMessage): Promise<HandFreeMessage | undefined> {
  if (!isExtensionContext) return undefined;
  try {
    return await chrome.runtime.sendMessage(message);
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

export async function openDashboardInTab(): Promise<void> {
  const url = extensionUrl('dashboard.html');
  if (isExtensionContext && chrome.tabs?.create) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active.id && active.url && !/^(chrome|edge|about|brave|view-source|devtools|chrome-extension):/i.test(active.url)) {
      await chrome.storage.local.set({ 'handfree-control-tab-id': active.id });
    }
    await chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function openTouchViewInTab(): Promise<void> {
  const url = extensionUrl('touchview.html');
  if (isExtensionContext && chrome.tabs?.create) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active.id && active.url && !/^(chrome|edge|about|brave|view-source|devtools|chrome-extension):/i.test(active.url)) {
      await chrome.storage.local.set({ 'handfree-control-tab-id': active.id });
    }
    await chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function subscribeToRuntimeMessages(callback: (message: HandFreeMessage) => void): () => void {
  if (!isExtensionContext) return () => undefined;
  const listener = (message: HandFreeMessage) => callback(message);
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
