# HandFree implementation log

## Existing project status

The workspace was empty at inspection time: no package manifest, source tree, extension manifest, build configuration, or existing application modules were present. There was no unrelated work to preserve.

## Technology stack

- Vite + React + TypeScript
- Chrome Manifest V3
- Chrome Storage and Runtime Messaging APIs
- MediaPipe Tasks Vision Face Landmarker adapter, loaded only after explicit camera setup
- CSS design tokens and semantic HTML; no CSS framework was pre-existing

## Files inspected

- Workspace root contents
- `Pasted text.txt` containing the milestone brief
- No pre-existing `package.json`, `src/`, `public/`, or extension manifest was found

## Planned architecture

- `src/shared`: strongly typed settings/messages, storage, and extension-page helpers
- `src/background`: service worker state, message routing, active-tab communication, restricted-page handling
- `src/content`: in-page pointer overlay, target discovery, highlighting, dwell selection, and safe recovery
- `src/tracking`: camera lifecycle, MediaPipe adapter, calibration, head-motion mapping, and smoothing
- `src/dashboard`: full React control dashboard and camera/calibration experience
- `src/sidepanel`: compact shared-state control surface
- `src/demo`: ordinary HTML controls used for real pointer/dwell testing

## Milestone 1–3 tasks

1. Milestone 1: Manifest V3 foundation, dashboard, side panel, Demo Lab, shared settings, background worker, content script, and typed messaging.
2. Milestone 2: explicit camera setup, camera selection, preview, permission/error states, tracking lifecycle, and reusable Face Landmarker interface.
3. Milestone 3: guided calibration, relative landmark movement, dead-zone/sensitivity/smoothing mapping, in-page pointer, target highlighting, dwell click safety, pause/recenter, and tracking-loss recovery.

## Known technical limitations

- The Face Landmarker model is fetched from the MediaPipe CDN only after the user starts camera setup; offline model loading is not bundled in this MVP.
- Chrome blocks content scripts on internal/restricted pages. The dashboard reports those pages as unsupported and does not claim system-level mouse control.
- Automated verification can validate the extension build and UI flows, but reliable head-motion and camera permission tests require a real camera or a browser camera fixture.
- The Demo Lab is provided as an extension page for this local MVP; no public deployment or repository push is performed.
