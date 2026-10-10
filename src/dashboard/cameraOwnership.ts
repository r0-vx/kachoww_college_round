export type CameraClaim = 'owned' | 'busy' | 'unavailable';

/** Web Locks releases ownership automatically if the dashboard tab closes. */
export class CameraOwnership {
  private unlock: (() => void) | undefined;
  private generation = 0;

  get owned(): boolean { return Boolean(this.unlock); }

  async claim(locks: Pick<LockManager, 'request'> | undefined): Promise<CameraClaim> {
    if (this.owned) return 'owned';
    if (!locks) return 'unavailable';
    const generation = this.generation;
    return new Promise<CameraClaim>(resolve => {
      void locks.request('handfree-dashboard-camera', { ifAvailable: true }, async lock => {
        if (!lock || generation !== this.generation) { resolve('busy'); return; }
        await new Promise<void>(release => {
          this.unlock = release;
          resolve('owned');
        });
      }).catch(() => resolve('unavailable'));
    });
  }

  release(): void {
    this.generation += 1;
    this.unlock?.();
    this.unlock = undefined;
  }
}
