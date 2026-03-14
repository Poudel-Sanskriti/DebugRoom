# DebugRoom

A local workspace for learning how Python programs execute.

## Current checkpoint: Milestone 1.1

This first slice uses a hand-written, two-step trace. **It does not execute Python.**
The editor starts empty. Choose **Load demo**, then **Next** and **Previous** to
inspect the highlighted source line and local variables. Each observation shows
values before the highlighted line executes. Editing source or input clears the
demo trace; editing the problem notes does not. Refreshing discards edits.

## Run locally

Use Node.js 24 (verified with 24.6.0) and npm. From this repository:

```sh
npm ci
npm run dev
```

Open the loopback URL printed by Vite, normally http://127.0.0.1:5173/.
Stop the server with Ctrl+C. No backend, database, or Python installation is needed
for this checkpoint. Fonts load from Google Fonts with local sans-serif fallbacks.

## Check the implementation

```sh
npm test
npm run build
npm run format:check
```

The four UI tests cover the empty state, matching line/variable playback,
first/last boundaries, demo reload, and trace invalidation on code/input edits.
The build includes TypeScript checking. It currently reports a non-blocking
bundle-size warning for the editor-containing JavaScript bundle (about 557 kB
minified, 184 kB gzip); no code splitting has been added at this checkpoint.

## Read the code

1. `apps/web/src/demo.ts` — the tiny fixture and its trace-step type.
2. `apps/web/src/App.tsx` — draft fields, selected index, derived observation,
   and the workspace UI.
3. `apps/web/src/CodeEditor.tsx` — CodeMirror lifetime, value synchronization,
   Python highlighting, and the selected trace line.
4. `apps/web/src/App.test.tsx` — user interactions and expected observations.
5. `apps/web/src/styles.css` — layout and visual styling.

The React frontend lives in an npm workspace so a later API can be added without
reorganizing this slice. There is deliberately no API or runner yet.
