# HandFree

HandFree is an accessibility-focused Chrome Manifest V3 extension that uses head movement to control a virtual pointer inside supported webpages. It does not control the operating-system mouse.

## First build

The ready-to-load extension is in [`dist/`](./dist). To load it in Chrome or Brave:

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `dist` folder.

For development:

```bash
npm install
npm run dev
```

Build the extension with:

```bash
npm run build
```

The MVP includes the dashboard, side panel, camera lifecycle, locally bundled MediaPipe Face and Hand Landmarker adapters, guided calibration, in-page pointer, target detection, dwell selection, pause/recenter controls, and the Demo Lab.

The complete first draft also includes optional hand tracking, pinch/open-palm gestures, browser voice commands, dictation into a focused field, rule-based HandFree Sense page extraction, local IndexedDB analytics, unit tests, and TouchView.

Run checks with:

```bash
npm run typecheck
npm test
npm run build
```

Open the Demo Lab during development at `http://127.0.0.1:5173/demo.html` after `npm run dev`.

Open TouchView during development at `http://127.0.0.1:5173/touchview.html` after `npm run dev`.

TouchView is a dedicated full-screen camera layer over a real HTML Demo Lab. It supports four-point calibration, mirrored coordinate correction, clamped fingertip mapping, deliberate pinch activation, stable-hold activation, target highlighting, progress feedback, pause/recovery, and local safe-metadata analytics. While TouchView is active, supported ordinary pages can receive the calibrated virtual fingertip/highlight through the content script; the webcam background remains on the dedicated TouchView page. Arbitrary cross-origin pages are not embedded because browser frame policies vary and sharing the same camera stream into every page would require a duplicate stream.

The camera, hand landmarks, and form values remain local. TouchView does not detect physical screen contact and does not control the operating-system mouse.

22:01 - PUSH by ROGI :3 meow
