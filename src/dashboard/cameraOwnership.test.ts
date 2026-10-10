import { describe, expect, it } from 'vitest';
import { CameraOwnership } from './cameraOwnership';

function lockManager() {
  let held = false;
  const pending: Promise<unknown>[] = [];
  const manager = {
    request: (_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      expect(options.ifAvailable).toBe(true);
      const operation = (async () => {
        if (held) return callback(null);
        held = true;
        try { await callback({ name: _name, mode: 'exclusive' }); }
        finally { held = false; }
      })();
      pending.push(operation);
      return operation;
    }
  } as Pick<LockManager, 'request'>;
  return { manager, pending };
}

describe('dashboard camera ownership', () => {
  it('does not queue another dashboard and releases ownership for a retry', async () => {
    const { manager, pending } = lockManager();
    const first = new CameraOwnership();
    const second = new CameraOwnership();
    expect(await first.claim(manager)).toBe('owned');
    expect(await first.claim(manager)).toBe('owned');
    expect(await second.claim(manager)).toBe('busy');
    expect(first.owned).toBe(true);
    expect(second.owned).toBe(false);
    first.release();
    await pending[0];
    expect(await second.claim(manager)).toBe('owned');
    second.release();
    await Promise.all(pending);
  });

  it('refuses capture when ownership protection is unavailable', async () => {
    expect(await new CameraOwnership().claim(undefined)).toBe('unavailable');
  });

  it('cancels a pending acquisition during cleanup', async () => {
    let run: ((lock: Lock | null) => Promise<void>) | undefined;
    const manager = { request: (_name: string, _options: LockOptions, callback: typeof run) => {
      run = callback;
      return Promise.resolve();
    } } as unknown as Pick<LockManager, 'request'>;
    const owner = new CameraOwnership();
    const claim = owner.claim(manager);
    owner.release();
    await run?.({ name: 'handfree-dashboard-camera', mode: 'exclusive' });
    expect(await claim).toBe('busy');
    expect(owner.owned).toBe(false);
  });
});
