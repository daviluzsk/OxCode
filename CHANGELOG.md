# Changelog

All notable changes to OxCode are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- **No more infinite "Thinking…" hangs.** The model request had no timeout, so a
  provider connection that stalled (open socket, no bytes, no `[DONE]`) left the
  agent stuck forever until Ctrl+C. Added an idle watchdog that aborts the stream
  when nothing arrives for a while (default 120s, `OX_STREAM_TIMEOUT_MS`), retries
  a stalled connect, and surfaces a clear "stream stalled" error mid-stream — Ctrl+C
  still works. Raised the default turn limit 100 → 200 so long agentic runs (e.g.
  full pentests) stop hitting the cap prematurely.

### Changed
- **Default model is now NVIDIA Nemotron 3 Ultra 550B (free)**
  (`nvidia/nemotron-3-ultra-550b-a55b:free`) — the previous `stealth/ox-alpha`
  stealth endpoint was retired by OpenRouter (it now 404s). Updated the default,
  the `/model` presets, help text, header and docs. Override any time with
  `--model` / `OX_MODEL` / `/model`.

### Added
- **Kali box — the AI's own machine.** `kali_up` boots a disposable Kali Linux
  container (Docker) that mounts the workspace at `/work` and installs a core
  tool set on first run; `kali_run` executes commands inside it (the agent's
  pentesting desktop — scans, tools, scripts); `kali_install` adds packages on
  demand; `kali_status` / `kali_down` manage it. Isolated from the host (only the
  workspace is shared), pentest-mode gated, and it degrades with a clear message
  when Docker isn't installed.
- **Refreshed welcome header + mascot.** The startup banner now leads with Oxxy,
  the OxCode ox mascot (`^__^ (oo) (__)`), a cleaner title/model/repo layout, and
  a two-column tips grid — closer to a modern agent CLI. The mascot also peeks out
  of the "thinking" indicator.
- **Easier image input.** Images can be attached with `@path` from anywhere on
  disk (not just the workspace) — handy for screenshots in `~/Pictures` — while
  non-image files still stay workspace-scoped. New `/paste` command grabs an image
  straight off the clipboard (Windows/macOS/Linux), saves it under `.ox/pastes/`,
  and tells you how to attach it.
- **Run the REAL tools.** `security_tools` lists the genuine offensive binaries
  installed on the machine and `run_security_tool` launches them with your
  arguments and returns their output — nmap, sqlmap, nikto, gobuster/ffuf,
  nuclei, wpscan, hydra, amass/subfinder, testssl.sh and ~30 more from a curated
  catalog (only catalog names can be launched — no arbitrary shell — each run is
  time-bounded). `burp_scan` / `burp_scan_status` drive a real **Burp Suite
  Pro/Enterprise** through its REST API (`BURP_API_URL` / `BURP_API_KEY`). The
  built-in dependency-free tools remain the fallback when a binary isn't present.
- **Kali-style offensive toolkit (10 tools).** `dir_bruteforce` (gobuster/dirb
  content discovery), `vhost_scan`, `wpscan` (WordPress enum), `takeover_check`
  (subdomain takeover fingerprints), `s3_check` (open buckets), `dns_axfr` (zone
  transfer), `whois`, `hash_crack` (offline dictionary attack), `inject_probe`
  (LFI / SSTI / command-injection detection PoC via a `FUZZ` marker), and
  `favicon_hash` (Shodan mmh3 pivot). All bounded, rate-limited, detection/PoC-
  level, pentest-mode gated, and routed through the shared HTTP client (so they
  also tunnel through Burp/ZAP).

### Fixed
- The shared offensive HTTP client now decodes `Transfer-Encoding: chunked`
  responses, so JSON endpoints (GraphQL, REST) parse correctly.

### Added (continued)
- **OxProxy — a built-in "Burp for the AI".** A web-security workbench the agent
  drives with tools instead of a GUI: `proxy_send` issues and captures a request
  (returns a `#id`), `proxy_history` / `proxy_view` browse the capture store,
  `proxy_repeat` is Repeater (resend a captured request with tweaked method/
  headers/body — IDOR, authz tampering), `proxy_intruder` is Intruder (replace a
  `FUZZ` marker across a payload list/wordlist, rate-limited and bounded, with a
  clustered anomaly report), `proxy_compare` is Comparer (line-level response
  diff), and `proxy_decode` is Decoder (base64/base64url/url/hex/html/jwt). It
  reuses the dependency-free HTTP client, so it also tunnels through Burp/ZAP when
  a proxy is set. Pentest-mode gated. Covered by local-server integration tests.
- **Ten new offensive-security tools + intercepting-proxy support** (authorized
  engagements only, pentest mode gated). Recon: `subdomains_crt` (crt.sh CT logs),
  `wayback_urls` (historical endpoints/params), `tech_fingerprint`, `recon_files`
  (`.well-known`, `.git/HEAD`, `.env`…). Web: `cors_audit`, `http_methods` (TRACE/
  dangerous verbs), `graphql_introspect`, `redirect_chain` (open redirect). Plus
  `hash_identify` and `proxy_status`. All HTTP runs through a dependency-free client
  that tunnels through **Burp Suite / OWASP ZAP** when `BURP_PROXY` / `OX_PROXY` /
  `HTTP(S)_PROXY` is set, so a tester can watch and replay every request.
- **Click a worker to inspect it.** Clicking a worker opens a panel with an
  **Activity** tab — that agent's live transcript (tools it runs, messages it sends
  and receives, status changes, blackboard posts) — plus the **Wardrobe** tab and a
  **Follow** button that eases the camera to track the worker as it walks. Integration
  test covers the task-tool ↔ swarm wiring end-to-end with the mock provider.
- **Agents can talk to each other.** Every swarm worker gets two tools:
  `hive_message(to, message)` to send a real message to a teammate (by role, label,
  or "all") — shown as a spoken line and a link in the office — and `hive_read()` to
  see recent messages and the shared blackboard before responding. The crew playbook
  now tells agents to actually use them (e.g. the Plan Reviewer questioning the
  Planner, the Security Engineer flagging a hole to the Engineer) instead of guessing.
- **Orchestrator crew playbook.** With swarm mode active, when you ask the agent to
  build something — especially a vague "build me a SaaS" — the orchestrator now
  spins up a standard crew via subtasks: a **Planner** (turns the vague ask into a
  concrete product), a **Plan Reviewer**, an **Engineer** (writes the code), a
  **Code Reviewer** (analyzes and improves it), and a **Security Engineer** that
  black-box pentests the result using only externally observable information, like
  a real external pentester. Roles are colored in the office (Planner is amber).

### Fixed
- **Communication wires now track the bots.** The blue links between workers are
  rebuilt from each bot's live position every frame (and are smoother), so a link
  no longer points at where a bot *was* when it now walks around the office.

### Added (earlier this cycle)
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
  plants. Workers are stylized cube characters — one body block, a floating head
  with a **face** (eyes that blink, mouth), and floating hands (no arms) — that
  **wander the office** between their desk and hangout spots and walk back.
  **Click any worker to open a wardrobe** (shirt, pants, hair, skin, glasses, cap);
  outfits are saved per worker in the browser.

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
