import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandFreeMessage } from './types';

type RuntimeListener = (message: HandFreeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: HandFreeMessage) => void) => boolean;
const addListener = vi.fn<(listener: RuntimeListener) => void>();

beforeEach(() => {
  vi.resetModules();
  addListener.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'runtime-test', getURL: (path: string) => `chrome-extension://runtime-test/${path}`, onMessage: { addListener, removeListener: vi.fn() } }
  });
});

describe('dashboard target capture', () => {
  it.each(['', 'about:blank', 'about:blank#loading', 'chrome-extension://runtime-test/dashboard.html', 'chrome-extension://runtime-test/demo.html'])('does not remember a placeholder or owned extension URL: %s', async url => {
    const { isControlTargetUrl } = await import('./runtime');
    expect(isControlTargetUrl(url)).toBe(false);
  });

  it('captures the control tab before focusing an existing dashboard and creates no duplicate', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const updateTab = vi.fn().mockResolvedValue(undefined);
    const updateWindow = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn();
    const query = vi.fn().mockResolvedValue([{ id: 9, windowId: 4, url: 'chrome-extension://runtime-test/dashboard.html' }]);
    Object.assign(chrome, { storage: { session: { set } }, tabs: { query, update: updateTab, create }, windows: { update: updateWindow } });
    const { openDashboardInTab } = await import('./runtime');

    await openDashboardInTab({ id: 1, url: 'https://example.com' } as chrome.tabs.Tab);

    expect(set).toHaveBeenCalledWith({ 'handfree-control-tab-id': 1 });
    expect(updateTab).toHaveBeenCalledWith(9, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(4, { focused: true });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(updateTab.mock.invocationCallOrder[0]);
    expect(create).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('runtime message observers', () => {
  it('does not acknowledge a command or keep its channel open for a synchronous void callback', async () => {
    const { subscribeToRuntimeMessages } = await import('./runtime');
    const observe = vi.fn((_message: HandFreeMessage): void => undefined);
    subscribeToRuntimeMessages(observe);
    const listener = addListener.mock.calls[0][0];
    const sendResponse = vi.fn();
    const message: HandFreeMessage = { type: 'ENABLE_TOUCHVIEW' };

    expect(listener(message, {}, sendResponse)).toBe(false);
    expect(observe).toHaveBeenCalledWith(message);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('replies with a defined typed response without keeping the channel open', async () => {
    const { subscribeToRuntimeMessages } = await import('./runtime');
    const response: HandFreeMessage = { type: 'PAGE_SUPPORTED' };
    subscribeToRuntimeMessages(() => response);
    const listener = addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    expect(listener({ type: 'ENABLE_TOUCHVIEW' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(response);
  });
});
