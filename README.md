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

The MVP includes the dashboard, side panel, camera lifecycle, MediaPipe Face Landmarker adapter, guided calibration, in-page pointer, target detection, dwell selection, pause/recenter controls, and the Demo Lab.
