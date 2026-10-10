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

## A-to-Z first-draft expansion

The existing foundation was extended in place rather than replaced. Added modules cover:

- Head, hand, voice, dictation, and HandFree Sense control modes.
- MediaPipe Hand Landmarker with index-finger pointer, pinch activation, open-palm pause, release detection, and GPU-to-CPU fallback.
- Browser Speech Recognition and speech synthesis wrappers with deterministic command parsing.
- Dictation insertion into the focused local webpage field without storing dictated text.
- DOM-based page indexing, accessible-name extraction, content ranking, and rule-based Sense answers.
- IndexedDB event analytics with memory fallback, summaries, event categories, outcomes, and reset control.
- Expanded Demo Lab navigation, precision targets, recovery scenario, validated form, confirmation dialog, and real audio-first information content.
- Vitest unit coverage for command parsing, page ranking, gesture interpretation, dwell safety, and analytics summaries.

## A-to-Z verification status

- `npm run typecheck`: passed.
- `npm test`: passed, 5 files and 8 tests.
- `npm run build`: passed.
- Dashboard, side panel, and Demo Lab browser smoke checks: passed with no console errors.
- Demo validation and confirmation workflow: passed in a real browser.
- Camera, face tracking, hand tracking, microphone permission, speech recognition, and extension-loaded content-script flows still require manual verification with a real loaded extension and available hardware/browser support.

## New known limitations

- Head and hand MediaPipe models are fetched from their public model/CDN URLs after explicit camera setup; offline model packaging is not included.
- Hand and head modes share one camera stream and one animation loop, but enabling/disabling camera modes after a stream starts requires restarting camera setup.
- Web Speech API availability varies by browser; unsupported browsers show an unavailable state.
- Voice commands require an active supported webpage for page actions. Confirmation-sensitive actions wait for a separate `confirm` command.
- The Sense layer is rule-based and deliberately does not claim to replace NVDA or another screen reader.
- `npm install` reported dependency audit findings in the current toolchain; no forced breaking `npm audit fix` was applied.
