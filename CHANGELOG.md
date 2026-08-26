# Changelog

All notable changes to OxCode are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

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
