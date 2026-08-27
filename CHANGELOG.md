# Changelog

All notable changes to OxCode are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Swarm mode — a live 3D "office" visualization of the agent swarm.** `ox --swarm`
  or `/swarm` opens a self-contained Three.js page (served by a tiny built-in
  SSE server on `127.0.0.1`) where each parallel subtask appears as a worker at a
  desk: colored by role, animating while it runs tools, showing speech bubbles,
  exchanging hand-off arcs, and posting findings to a shared **blackboard** (hive
  memory) that later agents build on. An orchestrator worker delegates and collects
  reports. No runtime dependencies; the viewer loads Three.js from a CDN.
- **Realistic office + customizable workers.** The swarm viewer is now a proper
  floor-plan office — reception with a WELCOME sign, lounge, private offices,
  a glass-walled meeting room, kitchen, bathrooms, desk pods with dividers, and
  plants. Workers are articulated characters (shirt, pants, hair, skin, optional
  glasses/cap) seated at desks; **click any worker to open a wardrobe** and change
  their outfit — saved per worker in the browser.

### Changed
- **Pentest mode no longer prompts for every action.** When pentest mode is ON the
  operator is treated as the authorized owner of the target, so the security toolkit
  (`net_scan`, `http_probe`, `web_fuzz`, `web_vuln_scan`, `http_request`, `form_brute`,
  `jwt_*`, `dns_enum`, `ssl_audit`, `secrets_scan`, `pentest_payloads`) runs without
  per-call approval prompts. `plan` mode still blocks it; turning pentest off restores
  normal gating. The system prompt no longer tells the agent to stop and re-verify
  authorization before acting.

### Fixed
- **Markdown now renders in the terminal** — assistant replies no longer show raw
  `**bold**`, `*italic*`, `` `code` `` or `#` heading markers. A lightweight inline
  renderer translates them to Ink styles and drops the markers.

### Added
- **Interactive pickers for `/effort`, `/permissions`, and `/pentest`** — running
  them with no argument now opens an arrow-key menu (like `/model`) instead of
  requiring you to type the value. Typing the value still works
  (`/effort high`, `/permissions plan`). Powered by a new reusable `OptionPicker`
  component and a generic `pickChoice` host method.

## [0.2.0] — 2026-08-26

### Added
- **Live run status** — the thinking indicator now shows elapsed time and a live
  output-token counter (`⠋ Thinking… 8s · →1.2k tok · Ctrl+C to interrupt`).
- **Context-usage meter** — the prompt footer shows how full the context window is
  (`42% ctx`), colored yellow past 60% and red past 85% so compaction never surprises you.
- **Run duration in the change summary** — completed runs report wall-clock time
  alongside the files-changed / `+`/`-` line.
- `formatCount` / `formatDuration` UI helpers with unit tests.

### Changed
- `estimateMessagesTokens` is now exported from the agent loop and reused by the UI,
  so the context meter and the auto-compaction trigger share one estimate.

### Infrastructure
- GitHub Actions CI (typecheck + test + build on Node 22).

## [0.1.0]

Initial public release: autonomous terminal coding agent powered by Ox Alpha via
OpenRouter — agent loop, file/search/patch/shell/git tools, permission modes,
sessions, MCP client, pentest mode, and a React + Ink terminal UI.
