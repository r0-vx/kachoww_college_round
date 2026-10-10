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
