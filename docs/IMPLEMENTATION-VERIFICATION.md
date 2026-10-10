# HandFree first draft verification

Verified locally on 11 October 2026. This is not a deployment or a physical-user acceptance certificate.

## Changed implementation

- `public/manifest.json`: MV3 scripting permissions, dedicated dashboard toolbar action, quick-control side panel.
- `src/extension/background.ts`, `src/shared/runtime.ts`, `src/shared/types.ts`: one typed TouchView protocol, service-worker-owned always-on state, automatic connection across all supported tabs, active-tab-only pointer routing, session-persisted enabled tabs, new-tab/reload/navigation recovery, unsupported-page diagnostics, observer-response race fix, no placeholder-tab capture, explicit engine and pointer-source state.
- `src/extension/content.ts`, `src/content/touchViewOverlay.ts`, `src/content/targetDetector.ts`: idempotent isolated overlay, target names and outlines, pointer, frame-checked pinch/hold, pause/resume/exit, settings drawer, separate camera/website/cursor/highlight layers.
- `src/tracking/*`, `src/touchview/touchViewGesture.ts`: shared camera/object-fit mapping, raw landmark retention, stable calibration sample collection with rejection reasons, five-position validation with corner errors, palm-relative pinch, smoothing, loss cancellation, background capture scheduling, stale-run protection, camera ownership across workspaces, explicit STOPPED/STARTING/READY/RUNNING/PAUSED/TRACKING_LOST/ERROR states, and actual geometry-derived quality instead of fixed confidence constants.
- `src/dashboard/*`, `src/sidepanel/*`, `src/ui/*`, `src/shared/icons.tsx`: TouchView-first wide dashboard, camera ownership lock, a full-screen live calibration workspace using the existing video/canvas, hand/head source selection, live sample/confidence/stability feedback, mapping debug data, local thumbnails, quick controls, prominent Sense, microphone test, keyboard shortcuts, semantic colors, diagnostics, separate face/hand landmark opacity, and verified-event analytics.
- `src/content/voiceExecutor.ts`, `src/voice/*`, `src/demo/DemoLab.tsx`: native React-compatible final-transcript dictation, command execution, review/confirmation, actual Sense extraction, distinct dashboard-owned speech output.
- `src/analytics/analytics.ts`: confirmed-task counting. Dictated field values are not recorded.
- `src/touchview/TouchViewPage.tsx`: standalone workspace with webcam, live face/hand landmark layers, shared camera ownership, calibration, and no obsolete external TouchView routes.
- `package.json`, `package-lock.json`, `scripts/*`: reproducible checks and a classic IIFE content-script production bundle. `dist/` rebuilt.

## Results

- TypeScript typecheck: passed.
- Unit tests: 44 passed across 15 files.
- Production build: passed, including the classic content script.
- Loaded-extension smoke test: 37 passed checks. Includes automatic connection for newly opened supported tabs, reload recovery without a second enable command, tab switching, actual webpage button activation with synthetic pointer/gesture messages, public example.com link activation, head-source dwell, held-pinch protection, tracking timeout, settings, calibration persistence, pause/resume/exit, reload/navigation, a second tab, unsupported-page rejection, real React Demo form dictation/review/confirmation, Sense headings, side-panel no-redirect behavior, narrow side-panel layout and console-error checks.
- No page runtime exceptions or console errors in the passing integration run.
- Final hardware probe: webcam live at 1280×720, bundled Face and Hand Landmarkers initialized on GPU, background capture advanced, the full-screen calibration workspace reported a visible 1280×900 video and landmark canvas with mirror/object-fit/debug status, microphone capture was live, and browser speech recognition started. The probe correctly stopped at `CALIBRATION_REQUIRED`; automated testing cannot perform physical four-corner calibration or gesture acceptance.

## Limits and remaining acceptance work

Synthetic gesture and recognized-text inputs validate routing and real DOM behavior, not physical pointing accuracy or speech transcription accuracy. The live-camera probe validates the workspace and model/camera lifecycle, but final physical corner sampling, pinch/head activation and spoken-sentence dictation remain user acceptance checks.

The camera dashboard must stay open while capturing. Camera thumbnails and coordinates are sent locally to connected tabs but are not stored. Confidence percentages represent observable landmark geometry quality, not a MediaPipe posterior probability.

Browser settings, protected extension pages, Web Store pages, protected PDF viewers and native Windows applications are not supported. Native desktop interaction requires a separate companion agent. Own Demo Lab voice practice uses its own page code, not injection support for arbitrary extension pages.

Reload the unpacked extension from this workspace's `dist/` folder before using the updated build in the existing browser. The isolated test profile does not reload the user's main Chrome profile.

## Commands and evidence

`npm run typecheck`, `npm test`, `npm run build`, `npm run test:extension`, `npm run test:hardware`.

The browser scripts use the installed Chrome-for-Testing executable; set `HANDFREE_CHROME` to override its path. Reports/screenshots are under `output/` (ignored by Git). The hardware probe reports failures explicitly and never uses a fake camera or audio device; its auto-permission flag only accepts the permission dialog in its isolated test profile.
