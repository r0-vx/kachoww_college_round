import { DEFAULT_SETTINGS, type HandFreeSettings } from './types';

const STORAGE_KEY = 'handfree-settings';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadSettings(): Promise<HandFreeSettings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] as Partial<HandFreeSettings> | undefined) };
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(saved ? JSON.parse(saved) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: HandFreeSettings): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function subscribeToSettings(callback: (settings: HandFreeSettings) => void): () => void {
  if (hasChromeStorage()) {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const value = changes[STORAGE_KEY]?.newValue as Partial<HandFreeSettings> | undefined;
      if (value) callback({ ...DEFAULT_SETTINGS, ...value });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  return () => undefined;
}
