import { describe, expect, it, vi } from 'vitest';
import { DwellController } from './dwellController';

describe('dwell controller', () => {
  it('starts and completes once for a stable target', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const controller = new DwellController({ onStart: () => events.push('start'), onProgress: () => undefined, onCancel: () => events.push('cancel'), onComplete: () => events.push('complete') });
    const element = {} as HTMLElement;
    controller.updateTarget({ element, info: { selectorHint: 'button', accessibleName: 'Test', tagName: 'button' } }, 1000, true);
    expect(events).toEqual(['start']);
    vi.advanceTimersByTime(1000);
    expect(events).toContain('complete');
    controller.updateTarget({ element, info: { selectorHint: 'button', accessibleName: 'Test', tagName: 'button' } }, 1000, true);
    expect(events.filter((event) => event === 'complete')).toHaveLength(1);
    controller.destroy();
    vi.useRealTimers();
  });
});
