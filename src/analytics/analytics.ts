import type { AnalyticsEvent, AnalyticsSummary } from '../shared/types';

const DB_NAME = 'handfree-analytics';
const STORE_NAME = 'events';
const VERSION = 1;
let memoryEvents: AnalyticsEvent[] = [];

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function recordAnalytics(event: AnalyticsEvent): Promise<void> {
  const safeEvent: AnalyticsEvent = { ...event, timestamp: event.timestamp || Date.now() };
  memoryEvents = [...memoryEvents.slice(-199), safeEvent];
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).add(safeEvent);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  db.close();
}

export async function readAnalytics(limit = 100): Promise<AnalyticsEvent[]> {
  const db = await openDb();
  if (!db) return memoryEvents.slice(-limit).reverse();
  const values = await new Promise<AnalyticsEvent[]>((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as AnalyticsEvent[]).slice(-limit).reverse());
    request.onerror = () => resolve(memoryEvents.slice(-limit).reverse());
  });
  db.close();
  return values;
}

export async function summarizeAnalytics(): Promise<AnalyticsSummary> {
  const events = await readAnalytics(500);
  const byMode: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  for (const event of events) {
    if (event.mode) byMode[event.mode] = (byMode[event.mode] || 0) + 1;
    if (event.outcome) byOutcome[event.outcome] = (byOutcome[event.outcome] || 0) + 1;
  }
  const touchViewEvents = events.filter((event) => event.type.startsWith('TOUCHVIEW_'));
  const calibrationStarted = touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_CALIBRATION_STARTED').length;
  const calibrationCompleted = touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_CALIBRATION_COMPLETED').length;
  const activationDurations = touchViewEvents.flatMap((event) => event.type === 'TOUCHVIEW_TARGET_ACTIVATED' && typeof event.duration === 'number' ? [event.duration] : []);
  return {
    sessionStartedAt: events.at(-1)?.timestamp ?? Date.now(),
    totalEvents: events.length,
    completedTasks: events.filter((event) => event.type === 'task-completed').length,
    completedDwells: events.filter((event) => event.type === 'dwell-completed').length,
    cancelledDwells: events.filter((event) => event.type === 'dwell-cancelled').length,
    voiceCommands: events.filter((event) => event.type === 'voice-command-received').length,
    trackingInterruptions: events.filter((event) => event.type === 'tracking-lost').length,
    byMode,
    byOutcome,
    recent: events.slice(0, 8),
    touchViewUsage: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_ENABLED').length,
    touchViewCalibrationSuccessRate: calibrationStarted ? calibrationCompleted / calibrationStarted : 0,
    touchViewSuccessfulActivations: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_TARGET_ACTIVATED').length,
    touchViewCancelledActivations: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_HOLD_CANCELLED' || event.type === 'TOUCHVIEW_ACTIVATION_REJECTED').length,
    touchViewTrackingInterruptions: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_HAND_LOST').length,
    touchViewAverageActivationTime: activationDurations.length ? activationDurations.reduce((sum, value) => sum + value, 0) / activationDurations.length : 0,
    touchViewPinchActivations: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_PINCH_ACTIVATED').length,
    touchViewHoldActivations: touchViewEvents.filter((event) => event.type === 'TOUCHVIEW_TARGET_ACTIVATED' && event.metadata?.activationMethod === 'stable-hold').length
  };
}

export async function resetAnalytics(): Promise<void> {
  memoryEvents = [];
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  db.close();
}
