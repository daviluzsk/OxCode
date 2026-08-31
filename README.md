# OxCode

[![CI](https://github.com/daviluzsk/OxCode/actions/workflows/ci.yml/badge.svg)](https://github.com/daviluzsk/OxCode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

OxCode is an autonomous terminal coding agent powered by **MiniMax M3** (`minimax/minimax-m3:free`) by default — any OpenAI-compatible model works, accessed through OpenRouter's OpenAI-compatible API. Open any repository, describe a task in natural language, and OxCode inspects the code, edits files, runs commands and tests, reads failures, fixes its own mistakes, and keeps going until the task is genuinely done — all inside your terminal.

```text
╭────────────────────────────────────────────────────────────╮
│ OxCode                                                     │
│ Open-source coding agent                                      │
│                                                            │
│ ~/projects/my-project                                      │
╰────────────────────────────────────────────────────────────╯

  MiniMax M3 • minimax/minimax-m3:free
  247 files • git: main

> fix the authentication bug and run the tests
```

```text
● Inspecting authentication flow

  Read  src/auth/session.ts
  Read  src/api/login.ts
  Search "createSession" in src/

● I found an incorrect session expiration conversion.

  Edit  src/auth/session.ts  +4 -2

  Bash  npm test

● Fixed the session expiration bug — 48 tests passed.

  1 file changed +4 -2
```

While it works, the status line shows live progress — elapsed time and output
tokens as they stream — and the prompt footer tracks how full the context window
is (`42% ctx`), so you can see compaction coming before it happens.

## Requirements

- **Node.js 22 or newer**
- Windows 10/11, macOS, or Linux (Windows is a first-class target: cmd.exe shell, CRLF, drive letters)
- An [OpenRouter](https://openrouter.ai) API key
- Optional: `git` (repository integration), `ripgrep` (`rg`, faster search — a Node fallback is used without it)

## Installation

From source:

```bash
git clone https://github.com/daviluzsk/OxCode.git
cd OxCode
npm install
npm run build
npm link
```

Then from any project:

```bash
cd my-project
ox
```

(Publishing to npm as `npm install -g oxcode` works the same way once published; the `ox` binary is registered by `package.json`.)

### Updating

OxCode **updates itself**. On interactive startup it checks the git remote, and if
your clone is behind it pulls the latest commit, rebuilds, and relaunches — so you
always run the newest version. You can also update on demand with `/update`, or opt
out of the automatic check with `OX_NO_UPDATE=1`.

## API key setup

OxCode never hardcodes keys and never stores them in session files.

**Easiest: just run `ox`.** On first run without a key, the interactive CLI asks for it once and saves it to `~/.ox/settings.json` — you never set it again.

Or set it yourself, your choice:

**PowerShell (Windows):**

```powershell
$env:OPENROUTER_API_KEY="sk-or-..."
# persist for your user:
[Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", "sk-or-...", "User")
```

**cmd (Windows):**

```cmd
set OPENROUTER_API_KEY=sk-or-...
```

**bash / zsh (Linux, macOS):**

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

## First run

```bash
cd your-project
export OPENROUTER_API_KEY="..."
ox
```

Type a task at the prompt:

```text
> There is a bug in the calculator. Find it, fix it and run the tests.
```

OxCode will autonomously: list the project → read the implementation → read/run the tests → patch the bug → re-run tests → iterate on failures → report what changed and how it was verified.

Useful things to try next:

```text
> explain @src/auth.ts          (@ attaches a file to the prompt)
> /init                         (analyze the repo and write an OX.md)
> /doctor                       (diagnose your setup)
> /help                         (all commands)
```

## Tools the agent can use

| Tool | Purpose |
|---|---|
| `read_file` | UTF-8 reads with line numbers, ranges, truncation |
| `list_directory` | Bounded directory trees (heavy dirs auto-ignored) |
| `glob` | File search by pattern (`**/*.ts`), respects `.gitignore` |
| `grep` | Content search (ripgrep when available, Node fallback) |
| `write_file` | Create new files (parents created; overwrite is opt-in) |
| `apply_patch` | Precise find-and-replace edits with multi-block support |
| `delete_path` | Delete files/directories (approval-gated) |
| `move_path` | Move/rename within the workspace |
| `bash` | Cross-platform shell (cmd.exe on Windows, sh elsewhere) with exit codes, stderr, timeouts, output truncation |
| `git_status` / `git_diff` / `git_log` | Structured Git inspection |
| `todo_write` | Agent-maintained task list shown in the UI |
| `task` | Bounded subtask/subagent with isolated context (parallel when called in batches) |
| `net_scan` / `http_probe` / `web_fuzz` / `jwt_decode` / `dns_enum` | Pentest toolkit — only runs with pentest mode ON |
| `browser_*` | Agent-controlled browser window: open, navigate, snapshot, click, click_xy (vision coordinates), fill, press, scroll, back, screenshot, close |
| `use_skill` | Load an installed skill pack (when skills exist) |
| `mcp__<server>__<tool>` | Tools from connected MCP servers |

Tool output sent to the model is truncated intelligently (head + tail, marked) so long commands never flood the context.

## Permission modes

```bash
ox --permission-mode default
ox --permission-mode askAll
ox --permission-mode acceptEdits
ox --permission-mode plan
ox --dangerously-skip-permissions
```

| Mode | Behavior |
|---|---|
| `default` | Reads run free; edits, browser clicks and risky commands ask |
| `askAll` | **Every** action asks first — maximum supervision. "Yes, and allow similar this session" reduces friction |
| `acceptEdits` | File edits/clicks auto-approved; destructive shell/deletion still asks |
| `plan` | Inspect and plan only — no file mutations, no command execution |
| `dangerouslySkipPermissions` | Everything runs without asking. A persistent warning is shown. Use with care |

Command risk is classified structurally (segments, executables, flags), not by naive substring matching. `git status` runs free; `rm -rf`, `git push --force`, `npm publish`, `curl ... | sh`, disk/system commands always ask. Approvals can be remembered per session ("Yes, and allow similar this session").

In **headless mode** no prompt can be shown: anything requiring approval is denied unless you pass `--dangerously-skip-permissions` or `--permission-mode acceptEdits`.

## Browser control

OxCode can drive its own **visible browser window** (powered by `playwright-core`, reusing your installed Edge/Chrome — no extra download):

```text
you: entra no mercado livre, procura um fone bluetooth até 100 reais e me mostra as opções
```

- The agent works through `browser_open` → `browser_snapshot` (reads the page and numbered element refs) → `browser_click` / `browser_fill` → snapshot again.
- **Vision:** `browser_screenshot` returns the image straight to the model — it can read on-screen text (including image CAPTCHAs) and click what it sees with `browser_click_xy` (normalized 0–1000 coordinates). Requires a vision-capable model; behavioral CAPTCHAs (reCAPTCHA v3, Cloudflare) may still need you in the window.
- **Persistent profile** at `~/.ox/browser-profile`: log in to a site once (in the opened window) and the session survives across runs.
- **Clicks, typing and key presses are approval-gated** in `default` mode — the prompt shows exactly what will be clicked (e.g. `click e7 "Comprar agora"`). Navigation, snapshots and screenshots run freely. Use `acceptEdits` for a smoother flow.
- CAPTCHAs / 2FA: the agent tries image challenges with vision; if it gets stuck it asks you to complete that step in the window, then continues.
- The browser closes when OxCode exits; the profile (cookies/logins) persists.

### Parallel subagents

The `task` tool spawns bounded subagents with isolated context (exploration, code review, investigations). Calling it several times in one turn runs them **in parallel** — e.g. "explore the frontend and the backend at the same time". Subagent activity shows inline in the UI.

### `/btw` — side questions

While the agent works, ask anything without interrupting:

```text
/btw o que você está fazendo agora?
/btw por que escolheu essa abordagem?
```

Runs a separate, unsaved side conversation with read-only tools and a snapshot of the current state (task list, running tools, recent messages). The main run continues untouched.

## Slash commands

```text
/help         Show available commands
/clear        Fresh conversation (repository untouched)
/compact      Compact history into a state summary
/context      Show context usage and loaded files
/cost         Show token usage
/model        Interactive model picker (presets: MiniMax M3 free, GLM 5.2 free, DeepSeek V4, Nemotron……)
/effort       Show or set reasoning effort (low|medium|high)
/system       Custom instruction the agent always follows (/system <text>|off|--save <text>)
/skills       List installed skills
/pentest      Toggle pentest mode (authorized security testing)
/btw          Side question without interrupting the current run
/status       Model, provider, repo, branch, permissions, session
/config       Show resolved configuration
/permissions  Show or set the permission mode
/diff         Show current Git diff
/git          Show Git status
/init         Analyze repository and create OX.md
/resume       Pick and resume a previous session
/doctor       Diagnose Node, API key, connectivity, git, ripgrep, config
/mcp          Show MCP server status
/exit         Exit OxCode
```

### Custom commands

Create `.ox/commands/review.md` in your project:

```markdown
# Code review
Review this code for bugs and style issues: $ARGUMENTS
```

Then run `/review src/auth.ts`. `$ARGUMENTS` is replaced with whatever follows the command.

### Custom system instructions (`/system`)

Make the agent always act a certain way — e.g. a persona, a language, house rules:

```text
/system Responda sempre em português e seja um revisor de código sênior.
/system --save Sempre rode os testes depois de editar código.   (persists to .ox/settings.json)
/system off                                                       (clear)
```

Session-only by default; `--save` merges `appendSystemPrompt` into the project settings file. Applies from the next message.

### Skills

Reusable instruction packs the agent loads on demand with the `use_skill` tool:

- Project: `.ox/skills/<name>/SKILL.md`
- User (all projects): `~/.ox/skills/<name>/SKILL.md` — project skills win on name conflicts

```markdown
---
name: review
description: Senior code review checklist
---

# Review

1. Check error handling at every boundary…
```

`/skills` lists what's installed; matching skills are advertised in the system prompt.

### Pentest mode

`ox --pentest`, `"pentest": true` in settings, or `/pentest` to toggle mid-session. Adds an authorized-engagement methodology to the system prompt: scope/authorization check first, recon → enumeration → vulnerability analysis → minimal in-scope proof-of-concept → severity-rated report. **Use only on targets you are explicitly authorized to test.** The input bar shows `·pentest` while active.

**Toolkit** (each tool refuses to run unless pentest mode is ON). With pentest mode active the operator is treated as the authorized owner of the target, so the toolkit runs **without per-call approval prompts** — `plan` mode still blocks it, and turning pentest off restores normal gating:

| Tool | What it does |
|---|---|
| `net_scan` | TCP port scan + banner grabbing (common ports or custom list) |
| `http_probe` | Server fingerprint, security-header analysis, cookie flags, robots.txt/sitemap |
| `web_fuzz` | Path/parameter fuzzing at a `FUZZ` marker with response clustering |
| `jwt_decode` | JWT analysis: `alg=none`, HS/RS confusion, expiry, weak HS256 secret cracking |
| `dns_enum` | A/AAAA/CNAME/MX/TXT/NS/SOA records + subdomain brute force |
| `subdomains_crt` | Passive subdomain enumeration via crt.sh certificate-transparency logs |
| `wayback_urls` | Historical endpoints/parameters for a domain from the Wayback Machine |
| `tech_fingerprint` | Passive server/framework/CMS/WAF detection from headers, cookies, HTML |
| `cors_audit` | CORS misconfiguration testing (reflected origin, null origin, credentials) |
| `http_methods` | Allowed verbs + dangerous-method probing (TRACE/PUT/DELETE, XST) |
| `graphql_introspect` | GraphQL introspection detection + query/mutation/type listing |
| `recon_files` | Probes `.well-known`, robots/sitemap, `.git/HEAD`, `.env` and friends |
| `redirect_chain` | Follows redirects and flags open-redirect to external hosts |
| `hash_identify` | Classifies a captured hash (MD5/SHA/bcrypt/NTLM/JWT…) to guide cracking |
| `proxy_status` | Shows whether traffic is tunneled through an intercepting proxy |
| `dir_bruteforce` | Content discovery (gobuster/dirb) with a built-in common wordlist |
| `vhost_scan` | Virtual-host discovery by fuzzing the Host header |
| `wpscan` | WordPress version + user + exposed-file enumeration |
| `takeover_check` | Subdomain-takeover fingerprints (GitHub Pages/S3/Heroku/…) |
| `s3_check` | Open S3 bucket listing/read test |
| `dns_axfr` | DNS zone-transfer (AXFR) attempt |
| `whois` | WHOIS lookup via the WHOIS protocol (IANA referral) |
| `hash_crack` | Offline dictionary attack (md5/sha1/sha256/sha512/NTLM) |
| `inject_probe` | LFI / SSTI / command-injection detection PoC at a `FUZZ` marker |
| `favicon_hash` | mmh3 favicon hash for Shodan/Censys pivoting |

**Kali box — give the AI its own machine.** With Docker installed, OxCode can boot a disposable Kali Linux container that mounts your workspace at `/work` and run its whole pentest workflow inside it:

| Tool | What it does |
|---|---|
| `kali_up` | Boot the Kali container and install a core tool set (nmap, sqlmap, nikto, gobuster, ffuf, wpscan, hydra, …) on first run |
| `kali_run` | Run a command inside the box — the agent's pentesting desktop |
| `kali_install` | `apt install` extra Kali packages on demand |
| `kali_status` / `kali_down` | Show state / stop or remove the box |

The box is isolated from the host (only the workspace is shared) and pentest-mode gated. If Docker isn't installed, the tools say so instead of failing.

**Run the real tools.** Beyond the built-ins, OxCode can launch the genuine offensive binaries you already have installed and drive a real Burp Suite:

| Tool | What it does |
|---|---|
| `security_tools` | List the catalog and show which real binaries are installed here |
| `run_security_tool` | Launch a catalog tool with your args — **nmap, sqlmap, nikto, gobuster, ffuf, nuclei, wpscan, hydra, amass, subfinder, testssl.sh, …** — and capture its output |
| `burp_scan` / `burp_scan_status` | Drive a real **Burp Suite Pro/Enterprise** via its REST API (`BURP_API_URL` / `BURP_API_KEY`) |

Only names in the curated catalog can be launched (no arbitrary shell) and every run is time-bounded. The built-in dependency-free tools below are the fallback when a binary isn't present.

**OxProxy — a built-in Burp-style workbench the agent drives with tools** (no external app needed):

| Tool | Burp analog | What it does |
|---|---|---|
| `proxy_send` | Proxy | Issue an HTTP request and capture it in history (returns a `#id`) |
| `proxy_history` / `proxy_view` | HTTP history | List captures / show one full request+response |
| `proxy_repeat` | Repeater | Resend a captured request with tweaked method/headers/body |
| `proxy_intruder` | Intruder | Replace a `FUZZ` marker across payloads/wordlist; clustered anomaly report |
| `proxy_compare` | Comparer | Line-level diff of two captured responses |
| `proxy_decode` | Decoder | base64 / base64url / url / hex / html / jwt encode & decode |
| `proxy_clear` | — | Clear the capture store |

Typical loop: `proxy_send` → `proxy_view` → `proxy_repeat` / `proxy_intruder` → `proxy_compare`.

**Burp Suite / ZAP:** OxProxy and the offensive HTTP tools also tunnel through an external intercepting proxy when you set `BURP_PROXY` (or `OX_PROXY` / `HTTP(S)_PROXY`), e.g. `BURP_PROXY=http://127.0.0.1:8080` — every request then also shows up in Burp/ZAP to watch, log and replay. TLS verification is relaxed so the proxy's CA works. Run `proxy_status` to check.


## Swarm mode — the 3D agent office

OxCode can already split a large job across parallel subagents (the `task` tool runs
several at once). **Swarm mode** turns that into something you can *watch*: a live 3D
office in your browser where each subagent is a worker at a desk.

```bash
ox --swarm            # start with the office open
# …or toggle it any time inside the TUI:
> /swarm              # opens http://localhost:4517 in your browser
> /swarm off          # stop the viewer
```

Then ask for something big and let it fan out:

```text
> Split this across parallel agents: one maps the backend, one maps the frontend,
  one fixes the failing tests. Coordinate through the shared blackboard.
```

What you see in the office:

- **Workers** spawn at desks, colored by role (explorer, coder, tester, reviewer, security).
- They **light up green while working**, show **speech bubbles** for messages, and animate while running tools.
- **Blue arcs** fly between desks when agents hand off or share a result.
- A **blackboard** collects each agent's findings — the hive's shared memory. New
  agents are given the blackboard so far, so later workers build on what earlier ones found
  instead of repeating it. An **orchestrator** worker delegates and receives reports.
- Side panels stream the **live activity log** and the **blackboard** in text.

It's a real floor-plan office — reception with a WELCOME sign, lounge, private offices,
a glass meeting room, kitchen, bathrooms, desk pods and plants — and the workers are
dressable: **click any worker to open a wardrobe** (shirt, pants, hair, skin, glasses, cap).
Outfits are saved per worker in your browser.

How it works: a tiny built-in HTTP server (no dependencies) streams agent events over
**Server-Sent Events** to a self-contained [Three.js](https://threejs.org) page. Nothing
leaves your machine — it binds to `127.0.0.1` and picks a free port if `4517` is taken.
The 3D page loads Three.js from a CDN, so the *viewer* needs internet the first time (the
agents themselves do not). If port `4517` is busy the server moves to a random free port and
prints the URL.

## Configuration

Precedence: **CLI arguments → project config → user config → environment → defaults**.

- User: `~/.ox/settings.json`
- Project: `.ox/settings.json` (shareable), `.ox/settings.local.json` (gitignored — add it to your `.gitignore`)

```json
{
  "model": "minimax/minimax-m3:free",
  "permissionMode": "default",
  "appendSystemPrompt": "Responda sempre em português.",
  "pentest": false,
  "maxTurns": 100,
  "stream": true,
  "compactThreshold": 120000
}
```

Malformed configs are rejected with human-readable, per-field errors.

### Environment variables

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key (or `OX_API_KEY`) |
| `NVIDIA_API_KEY` | NVIDIA API key (`nvapi-…`) for NVIDIA-hosted models (or `OX_NVIDIA_API_KEY`) |
| `OX_BASE_URL` | Override the OpenRouter base URL (default `https://openrouter.ai/api/v1`) |
| `OX_MODEL` | Override model (default `minimax/minimax-m3:free`) |
| `OX_EFFORT` | Reasoning effort: `low` / `medium` / `high` |
| `OX_PROVIDER` | `openrouter` (default) or `mock` (offline scripted provider) |
| `OX_DEBUG=1` | Redacted debug log at `~/.ox/debug.log` |
| `OX_ASCII=1` | ASCII-only UI symbols |

Any OpenAI-compatible endpoint works via `OX_BASE_URL` / `--base-url`.

### NVIDIA-hosted models

Some models run on the **NVIDIA API** (`integrate.api.nvidia.com`) instead of OpenRouter — pick them in `/model`:

- `nvidia/nemotron-3-ultra-550b-a55b` — Nemotron 3 Ultra 550B
- `deepseek-ai/deepseek-v4-pro-0813` — DeepSeek V4 Pro
- `deepseek-ai/deepseek-v4-flash-0731` — DeepSeek V4 Flash
- `moonshotai/kimi-k3` — Kimi K3

The first time you select one, OxCode asks for your NVIDIA key (`nvapi-…`, from [build.nvidia.com](https://build.nvidia.com)) and saves it to `~/.ox/settings.json` — or set `NVIDIA_API_KEY`. OxCode routes each request to the right endpoint and key automatically; GLM 5.2 and the other models stay on OpenRouter.

## MCP (Model Context Protocol)

Configure stdio MCP servers in `.mcp.json` (project) or `~/.ox/mcp.json` (user):

```bash
ox mcp add github -- npx -y @modelcontextprotocol/server-github
ox mcp list
ox mcp remove github
```

MCP tools appear to the agent as `mcp__<server>__<tool>` alongside native tools. A server that fails to start is reported and skipped — it never crashes the agent.

## Headless mode

```bash
ox -p "fix all TypeScript errors"
echo "explain this project" | ox -p
ox -p "run the tests" --output-format json
ox -p "summarize this repo" --output-format stream-json
ox -p "..." --max-turns 25
```

- `text` (default): final answer on stdout, tool activity on stderr
- `json`: one JSON object with status, text, usage, session id
- `stream-json`: newline-delimited events for CI/automation

Exit codes: `0` success, `1` agent/provider failure, `2` usage error.

## Sessions

Sessions persist across terminal restarts in `~/.ox/sessions/` (messages, model, timestamps, token usage — never API keys).

```bash
ox --continue     # continue the most recent session in this directory
ox --resume       # pick from previous sessions interactively
/resume           # same, inside the TUI
```

Input history is kept per project in `~/.ox/history/`.

## Project instructions

OxCode loads repository instruction files into the agent context, in deterministic order:

1. `OX.md`
2. `.ox/instructions.md`
3. `AGENTS.md`
4. `OX.md` / `AGENTS.md` from parent directories (up to 5 levels)

Run `/init` to have the agent analyze your repo and write an `OX.md`.

## Security notes

- **Sensitive files are never sent to the model**: `.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `.ssh/*` and similar are blocked by policy (templates like `.env.example` are allowed).
- **Path traversal protection**: tools refuse to touch files outside the workspace root.
- **Untrusted commands**: model-generated shell commands go through risk classification and permission approval before execution.
- **Secret redaction**: logs and diagnostics redact API keys, bearer tokens, and private keys; keys are displayed masked (`***cdef`).
- Sessions and debug logs never contain API keys.

## Troubleshooting

| Problem | Fix |
|---|---|
| `No API key found` | Set `OPENROUTER_API_KEY` (see above) |
| `Authentication failed (401)` | Key is wrong or revoked — check OpenRouter dashboard |
| `Rate limited (429)` | Automatic retries with backoff already happen; wait or upgrade quota |
| Search is slow | Install [ripgrep](https://github.com/BurntSushi/ripgrep) |
| UI symbols look wrong | Set `OX_ASCII=1` |
| Something feels off | Run `/doctor` and/or `OX_DEBUG=1 ox` then inspect `~/.ox/debug.log` |

## Development

```bash
npm install
npm run dev -- -p "hello"   # run from source via tsx
npm run typecheck           # strict TypeScript
npm test                    # Vitest unit + integration tests (mocked provider)
npm run build               # emit dist/
npm link                    # install the `ox` binary globally
```

Tests never require an API key: the agent loop, tools, permissions, streaming, sessions and MCP client are covered against a deterministic mock provider and mocked fetch. `OX_PROVIDER=mock ox` runs the whole CLI offline.

Project layout:

```text
src/
  cli/         argument parsing, bootstrap
  api/         provider abstraction, OpenRouter streaming, SSE, mock provider
  agent/       agent loop, system prompt, todos, subtasks
  tools/       file/search/patch/shell/git tools + registry
  permissions/ modes, command risk classification
  security/    sensitive-file detection
  context/     repo discovery, ignore rules, instruction files
  sessions/    JSON session persistence
  commands/    slash commands, custom commands
  mcp/         stdio MCP client + config
  ui/          React + Ink terminal UI
  utils/       logging, redaction, truncation, diffs, paths
```

## License

MIT
