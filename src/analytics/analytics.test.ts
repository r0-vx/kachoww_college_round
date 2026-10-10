import { beforeEach, describe, expect, it } from 'vitest';
import { recordAnalytics, resetAnalytics, summarizeAnalytics } from './analytics';

describe('local analytics', () => {
  beforeEach(async () => { await resetAnalytics(); });
  it('summarizes event metadata without storing content', async () => {
    await recordAnalytics({ type: 'dwell-completed', timestamp: Date.now(), mode: 'head', outcome: 'success' });
    await recordAnalytics({ type: 'tracking-lost', timestamp: Date.now(), mode: 'head', outcome: 'lost' });
    const summary = await summarizeAnalytics();
    expect(summary.completedDwells).toBe(1);
    expect(summary.trackingInterruptions).toBe(1);
  });

  it('summarizes TouchView usage and activation methods', async () => {
    await recordAnalytics({ type: 'TOUCHVIEW_ENABLED', timestamp: Date.now(), mode: 'touchview' });
    await recordAnalytics({ type: 'TOUCHVIEW_CALIBRATION_STARTED', timestamp: Date.now(), mode: 'touchview' });
    await recordAnalytics({ type: 'TOUCHVIEW_CALIBRATION_COMPLETED', timestamp: Date.now(), mode: 'touchview', outcome: 'success' });
    await recordAnalytics({ type: 'TOUCHVIEW_TARGET_ACTIVATED', timestamp: Date.now(), mode: 'touchview', duration: 650, outcome: 'success', metadata: { activationMethod: 'stable-hold' } });
    const summary = await summarizeAnalytics();
    expect(summary.touchViewUsage).toBe(1);
    expect(summary.touchViewCalibrationSuccessRate).toBe(1);
    expect(summary.touchViewHoldActivations).toBe(1);
  });
});
