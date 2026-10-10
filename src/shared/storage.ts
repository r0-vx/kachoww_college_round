import { DEFAULT_SETTINGS, type HandFreeSettings } from './types';

const STORAGE_KEY = 'handfree-settings';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export function mergeSettings(saved?: Partial<HandFreeSettings>): HandFreeSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  if (saved && !Object.prototype.hasOwnProperty.call(saved, 'mirrorCamera') && Object.prototype.hasOwnProperty.call(saved, 'touchViewMirrorCamera')) merged.mirrorCamera = Boolean(saved.touchViewMirrorCamera);
  if (!merged.calibration && merged.touchViewCalibration) merged.calibration = merged.touchViewCalibration;
  if (merged.calibration && !merged.touchViewCalibration) merged.touchViewCalibration = merged.calibration;
  return merged;
}

export async function loadSettings(): Promise<HandFreeSettings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return mergeSettings(result[STORAGE_KEY] as Partial<HandFreeSettings> | undefined);
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return mergeSettings(saved ? JSON.parse(saved) : undefined);
  } catch {
    return mergeSettings();
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
      if (value) callback(mergeSettings(value));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  return () => undefined;
}
