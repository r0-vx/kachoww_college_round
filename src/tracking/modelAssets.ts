const extensionContext = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

export function trackingAssetPath(path: string): string {
  return extensionContext ? chrome.runtime.getURL(path) : `/${path}`;
}

export const visionWasmPath = trackingAssetPath('mediapipe/wasm');
