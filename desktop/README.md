# OxCode Desktop

A visual desktop app for the OxCode agent — a Claude-app-style workbench:
a left sidebar of saved sessions, a clean chat transcript with collapsible
tool-call rows, streaming replies, inline approval prompts, a model picker,
reasoning-effort control, and pentest / fsociety toggles. It drives the same
agent core as the CLI (`../dist`), so anything the terminal agent can do, the
app can do.

## Run (dev)

```bash
# from the repo root: build the core first
npm run build

# then the desktop app
cd desktop
npm install
npm start
```

`npm install` pulls Electron and links the core (`oxcode` → `..`). The agent
reads your API key from `~/.ox/settings.json` (same as the CLI).

## Build a Windows executable

```bash
cd desktop
npm run dist        # NSIS installer + portable .exe in desktop/release/
# or
npm run pack        # unpacked app in desktop/release/win-unpacked/
```

## Layout

- `main.js` — Electron main process. Owns the OxCode runtime, streams agent
  events to the renderer over IPC, routes permission prompts to the UI, and
  handles sessions / file reads.
- `preload.js` — `contextBridge` exposing a small `window.ox` API.
- `renderer/` — the UI (plain HTML/CSS/JS, no build step).

## Notes

- `--new` session, `/resume`-style history, model switching, and the
  pentest/fsociety modes all map to the same config the CLI uses.
- MCP is off by default in the app for faster startup.
