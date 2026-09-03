import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { parseArgs, HELP_TEXT, ArgParseError, type ParsedArgs } from './args.js';
import { ConfigError } from '../config/loader.js';
import { addMcpServer, loadMcpConfig, removeMcpServer } from '../mcp/config.js';
import { headlessApprover } from '../permissions/manager.js';
import { createRuntime } from '../runtime.js';
import { SessionStore } from '../sessions/store.js';
import { runHeadless } from '../headless.js';
import { ensureApiKeyInteractive, ensureNvidiaKeyInteractive } from './ensureKey.js';
import { isNvidiaModel } from '../api/models.js';
import { logger } from '../utils/logger.js';
import { redactSecrets } from '../utils/redact.js';

import { VERSION } from '../version.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function handleMcpCommand(args: ParsedArgs, cwd: string): number {
  switch (args.mcpAction) {
    case 'list': {
      const config = loadMcpConfig(cwd);
      const names = Object.keys(config);
      if (names.length === 0) {
        process.stdout.write('No MCP servers configured.\nAdd one with: ox mcp add <name> -- <command> [args...]\n');
        return 0;
      }
      for (const n of names) {
        const s = config[n]!;
        process.stdout.write(`${n}: ${s.command} ${(s.args ?? []).join(' ')}\n`);
      }
      return 0;
    }
    case 'add': {
      addMcpServer(cwd, args.mcpName!, { command: args.mcpCommand!, args: args.mcpArgs ?? [] });
      process.stdout.write(`Added MCP server "${args.mcpName}" to ${path.join(cwd, '.mcp.json')}\n`);
      return 0;
    }
    case 'remove': {
      const removed = removeMcpServer(cwd, args.mcpName!);
      process.stdout.write(removed ? `Removed MCP server "${args.mcpName}".\n` : `No MCP server named "${args.mcpName}" in project config.\n`);
      return removed ? 0 : 1;
    }
    default:
      return 1;
  }
}

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof ArgParseError) {
      process.stderr.write(`${e.message}\n\n${HELP_TEXT}`);
      return 2;
    }
    throw e;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`oxcode ${VERSION}\n`);
    return 0;
  }

  // Resolve project directory
  const cwd = args.path ? path.resolve(args.path) : process.cwd();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write(`Directory not found: ${args.path}\n`);
    return 2;
  }

  if (args.command === 'mcp') {
    return handleMcpCommand(args, cwd);
  }

  const cli = {
    model: args.model,
    baseUrl: args.baseUrl,
    permissionMode: args.permissionMode,
    reasoningEffort: args.reasoningEffort,
    dangerouslySkipPermissions: args.dangerouslySkipPermissions,
    pentest: args.pentest ? true : undefined,
    maxTurns: args.maxTurns,
  };

  const headless = args.prompt !== undefined || args.promptFromStdin || !process.stdout.isTTY;

  // Auto-update: on interactive startup, pull + rebuild if the clone is behind,
  // then re-exec so the new code runs. Best-effort, offline-safe, opt-out via
  // OX_NO_UPDATE=1. Skipped in headless and mock/test runs.
  if (!headless && !process.env.OX_NO_UPDATE && process.env.OX_PROVIDER !== 'mock') {
    try {
      const { checkForUpdate, applyUpdate, isWorkingTreeClean } = await import('../updater.js');
      const info = await checkForUpdate(cwd);
      if (info && info.behind > 0) {
        if (await isWorkingTreeClean(cwd)) {
          process.stderr.write(`\n🔄 OxCode is ${info.behind} update(s) behind — updating to ${info.latest}…\n`);
          const r = await applyUpdate(cwd, (l) => process.stderr.write(`   ${l}\n`));
          if (r.ok) {
            process.stderr.write('✅ Updated. Relaunching…\n\n');
            const child = execa(process.execPath, [process.argv[1]!, ...argv], {
              stdio: 'inherit',
              reject: false,
              env: { ...process.env, OX_NO_UPDATE: '1' },
            });
            const res = await child;
            return res.exitCode ?? 0;
          }
          process.stderr.write(`⚠ Auto-update failed — continuing on the current version. Run /update later.\n\n`);
        } else {
          process.stderr.write(`\n🔄 ${info.behind} update(s) available — run /update (you have local changes).\n\n`);
        }
      }
    } catch {
      /* offline / not a clone / git missing — ignore */
    }
  }

  try {
    // Session continuation
    const sessionStore = new SessionStore();
    let session: import('../sessions/store.js').Session | undefined;
    if (args.continueSession) {
      session = sessionStore.latest(cwd) ?? undefined;
      if (session && !headless) {
        process.stderr.write(`Continuing session ${session.data.id} (${session.messages.length} messages).\n`);
      }
    }

    const buildRuntime = () =>
      createRuntime({
        cwd,
        cli,
        approver: headlessApprover, // interactive mode replaces this from the UI
        session,
        connectMcp: true,
      });

    let runtime;
    try {
      runtime = await buildRuntime();
    } catch (e) {
      // Missing API key in interactive mode → first-run setup: ask once,
      // persist to ~/.ox/settings.json, and continue.
      if (!headless && e instanceof Error && e.message.includes('No API key found')) {
        const key = await ensureApiKeyInteractive();
        if (!key) throw e;
        runtime = await buildRuntime();
      } else {
        throw e;
      }
    }

    if (headless) {
      const prompt = args.prompt ?? (args.promptFromStdin ? await readStdin() : undefined);
      if (!prompt) {
        process.stderr.write('No prompt provided. Usage: ox -p "prompt" or echo "prompt" | ox -p\n');
        runtime.dispose();
        return 2;
      }
      const code = await runHeadless({ runtime, prompt, outputFormat: args.outputFormat });
      runtime.dispose();
      logger.close();
      return code;
    }

    // First-run NVIDIA key prompt: the active model is NVIDIA-hosted but no key set.
    if (!headless && isNvidiaModel(runtime.config.model) && !runtime.config.nvidiaApiKey) {
      const nv = await ensureNvidiaKeyInteractive();
      if (nv) runtime.config.nvidiaApiKey = nv;
      else process.stderr.write('No NVIDIA key — switch models with /model or set nvidiaApiKey later.\n');
    }

    if (args.dangerouslySkipPermissions) {
      process.stderr.write('⚠ Running with --dangerously-skip-permissions: every tool executes without approval.\n');
    }

    if (args.swarm) {
      try {
        runtime.swarm.fsociety = !!runtime.config.mrRobot;
        const url = await runtime.swarm.start();
        const { openInBrowser } = await import('../utils/openBrowser.js');
        openInBrowser(url);
        process.stderr.write(`🐝 Swarm office live at ${url} — parallel subtasks appear as workers.\n`);
      } catch (e) {
        process.stderr.write(`Could not start the swarm viewer: ${(e as Error).message}\n`);
      }
    }

    const { runInteractive } = await import('../ui/run.js');
    await runInteractive(runtime, args.resume);
    runtime.dispose();
    logger.close();
    return 0;
  } catch (e) {
    const message = e instanceof ConfigError ? `${e.message} (${e.file})` : (e as Error).message;
    process.stderr.write(redactSecrets(message) + '\n');
    logger.close();
    return 1;
  }
}
