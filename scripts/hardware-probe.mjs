import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// No fake camera/audio devices: this attempts the installed device pipeline.
const profile = await mkdtemp(join(tmpdir(), 'handfree-hardware-'));
const extension = resolve('dist');
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.HANDFREE_CHROME || 'C:/Users/rohit/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  headless: true, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--use-fake-ui-for-media-stream']
});
const report = { camera: null, rawCameraRetry: null, backgroundCapture: null, dashboardAfterStop: null, calibrationWorkspace: null, demo: null, microphone: null, recognition: null, runtimeErrors: [], modelLogs: [] };
try {
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const webpage = await browser.newPage();
  await webpage.goto('https://example.com');
  await webpage.bringToFront();
  const page = await browser.newPage();
  page.on('pageerror', e => report.runtimeErrors.push(String(e)));
  page.on('console', m => { if (/HandFree|Landmarker|model failed/i.test(m.text())) report.modelLogs.push(m.text()); });
  await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.evaluate(async url => { const tab = (await chrome.tabs.query({})).find(tab => tab.url === url); await chrome.storage.session.set({ 'handfree-control-tab-id': tab.id }); }, webpage.url());
  await page.getByRole('switch', { name: 'Enable TouchView', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, undefined, { timeout: 30000 }).catch(() => undefined);
  await new Promise(r => setTimeout(r, 1000));
  report.camera = await page.evaluate(async () => {
    const video = document.querySelector('video');
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return { live: Boolean(video.srcObject?.getVideoTracks().some(track => track.readyState === 'live')), width: video.videoWidth, height: video.videoHeight, status: response?.status, notices: Array.from(document.querySelectorAll('.notice')).map(el => el.textContent), settings: response?.settings };
  });
  if (!report.camera.live) report.rawCameraRetry = await page.evaluate(async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); return { available: true, settings: stream.getVideoTracks()[0].getSettings() }; }
    catch (e) { return { available: false, name: e.name, reason: e.message }; }
    finally { stream?.getTracks().forEach(track => track.stop()); }
  });
  const firstTime = await page.locator('video').evaluate(video => video.currentTime);
  await webpage.bringToFront();
  await new Promise(r => setTimeout(r, 2500));
  report.backgroundCapture = await page.evaluate(async first => ({ advances: document.querySelector('video').currentTime > first + 1, status: (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.status }), firstTime);
  await page.bringToFront();
  const startCalibration = page.getByRole('button', { name: 'Start calibration', exact: true });
  if (await startCalibration.isEnabled()) {
    await page.getByLabel('Calibration source', { exact: true }).selectOption('hand');
    await startCalibration.click();
    await page.locator('.global-calibration-overlay').waitFor({ state: 'visible', timeout: 5000 });
    report.calibrationWorkspace = await page.evaluate(() => {
      const video = document.querySelector('video');
      const canvas = document.querySelector('.tracking-overlay');
      const overlay = document.querySelector('.global-calibration-overlay');
      const style = video ? getComputedStyle(video) : null;
      const rect = video?.getBoundingClientRect();
      const target = document.querySelector('.global-calibration-target');
      return {
        overlayVisible: Boolean(overlay),
        firstTargetVisible: Boolean(target && getComputedStyle(target).visibility !== 'hidden' && target.getBoundingClientRect().width > 0),
        videoVisible: Boolean(video && style && style.visibility !== 'hidden' && style.display !== 'none' && rect && rect.width > 0 && rect.height > 0),
        videoRect: rect ? { width: rect.width, height: rect.height, top: rect.top, left: rect.left } : null,
        canvasRect: canvas ? (() => { const box = canvas.getBoundingClientRect(); return { width: box.width, height: box.height }; })() : null,
        objectFit: style?.objectFit,
        mirror: style?.transform,
        status: Array.from(document.querySelectorAll('.calibration-status-strip span')).map(el => el.textContent),
        debug: document.querySelector('.calibration-debug')?.textContent
      };
    });
    await mkdir('output', { recursive: true });
    await page.screenshot({ path: 'output/calibration-workspace.png' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.global-calibration-overlay'));
    report.calibrationWorkspace.escapeCleanup = await page.evaluate(() => ({
      overlayRemoved: !document.querySelector('.global-calibration-overlay'),
      bodyOverflow: document.body.style.overflow || 'default',
      bodyPointerEvents: document.body.style.pointerEvents || 'default'
    }));
  }
  report.microphone = await page.evaluate(async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); return { available: true, live: stream.getAudioTracks()[0]?.readyState === 'live' }; }
    catch (e) { return { available: false, name: e.name, reason: e.message }; }
    finally { stream?.getTracks().forEach(track => track.stop()); }
  });
  await page.locator('.secondary-controls > summary').click();
  await page.getByRole('button', { name: 'Start voice commands', exact: true }).click();
  await new Promise(r => setTimeout(r, 5000));
  report.recognition = await page.evaluate(async () => ({ apiAvailable: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition), status: (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.status }));
  const stop = page.getByRole('button', { name: 'Stop listening', exact: true }); if (await stop.isEnabled()) await stop.click();
  const stopCamera = page.getByRole('button', { name: 'Stop camera', exact: true }); if (await stopCamera.isEnabled()) await stopCamera.click({ force: true });
  // Chrome can take a short moment to release the physical device after the
  // dashboard track is stopped. Give the next owner a deterministic handoff.
  await new Promise(r => setTimeout(r, 1200));
  report.dashboardAfterStop = await page.evaluate(async () => ({
    live: Boolean(document.querySelector('video')?.srcObject?.getVideoTracks().some(track => track.readyState === 'live')),
    state: (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.status,
    notice: Array.from(document.querySelectorAll('.notice')).map(el => el.textContent)
  }));
  report.dashboardAfterStop.stopButtonDisabled = await stopCamera.isDisabled();
  const demo = await browser.newPage();
  demo.on('pageerror', e => report.runtimeErrors.push(`demo: ${String(e)}`));
  demo.on('console', m => { if (/HandFree|Landmarker|model failed/i.test(m.text())) report.modelLogs.push(`demo: ${m.text()}`); });
  await demo.goto(`chrome-extension://${id}/demo.html`);
  await demo.getByRole('button', { name: 'Start camera', exact: true }).click();
  await demo.waitForFunction(() => document.querySelector('video.demo-camera')?.videoWidth > 0, undefined, { timeout: 30000 }).catch(() => undefined);
  await new Promise(r => setTimeout(r, 1800));
  report.demo = await demo.evaluate(() => ({
    live: Boolean(document.querySelector('video.demo-camera')?.srcObject?.getVideoTracks().some(track => track.readyState === 'live')),
    width: document.querySelector('video.demo-camera')?.videoWidth ?? 0,
    height: document.querySelector('video.demo-camera')?.videoHeight ?? 0,
    cameraStatus: document.querySelector('.demo-status-badge')?.textContent,
    trackingStatus: document.querySelectorAll('.demo-status-badge')[1]?.textContent,
    cameraMessage: document.querySelector('.demo-camera-message')?.textContent,
    videoVisible: Boolean(document.querySelector('video.demo-camera') && getComputedStyle(document.querySelector('video.demo-camera')).visibility !== 'hidden'),
    landmarkCanvas: Boolean(document.querySelector('.demo-landmarks')),
    instructionVisible: Boolean(document.querySelector('.demo-instructions'))
  }));
  if (report.dashboardAfterStop.live) throw new Error('Dashboard handoff did not release its live camera track.');
  if (!report.demo.live || report.demo.width === 0 || report.demo.height === 0) throw new Error(`Demo Lab camera did not start: ${report.demo.cameraMessage}`);
  const demoStop = demo.getByRole('button', { name: 'Stop camera', exact: true }); if (await demoStop.isEnabled()) await demoStop.click();
  await mkdir('output', { recursive: true });
  await writeFile('output/hardware-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
