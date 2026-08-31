import { OutputFormatSchema, PermissionModeSchema, ReasoningEffortSchema, type OutputFormat, type PermissionMode, type ReasoningEffort } from '../config/types.js';

export interface ParsedArgs {
  command: 'chat' | 'mcp';
  mcpAction?: 'list' | 'add' | 'remove';
  mcpName?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  /** Positional project path. */
  path?: string;
  prompt?: string;
  /** -p with no value: read prompt from stdin. */
  promptFromStdin: boolean;
  continueSession: boolean;
  resume: boolean;
  model?: string;
  baseUrl?: string;
  permissionMode?: PermissionMode;
  reasoningEffort?: ReasoningEffort;
  dangerouslySkipPermissions: boolean;
  pentest: boolean;
  swarm: boolean;
  outputFormat: OutputFormat;
  maxTurns?: number;
  help: boolean;
  version: boolean;
}

export class ArgParseError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: 'chat',
    promptFromStdin: false,
    continueSession: false,
    resume: false,
    dangerouslySkipPermissions: false,
    pentest: false,
    swarm: false,
    outputFormat: 'text',
    help: false,
    version: false,
  };

  const args = [...argv];
  // `ox mcp ...` subcommand
  if (args[0] === 'mcp') {
    out.command = 'mcp';
    const action = args[1];
    if (action === 'list') {
      out.mcpAction = 'list';
    } else if (action === 'add') {
      out.mcpAction = 'add';
      out.mcpName = args[2];
      // everything after `--` (or after name) is the server command
      const rest = args.slice(3);
      const dashIdx = rest.indexOf('--');
      const cmdParts = dashIdx >= 0 ? rest.slice(dashIdx + 1) : rest;
      out.mcpCommand = cmdParts[0];
      out.mcpArgs = cmdParts.slice(1);
      if (!out.mcpName || !out.mcpCommand) throw new ArgParseError('Usage: ox mcp add <name> -- <command> [args...]');
    } else if (action === 'remove') {
      out.mcpAction = 'remove';
      out.mcpName = args[2];
      if (!out.mcpName) throw new ArgParseError('Usage: ox mcp remove <name>');
    } else {
      throw new ArgParseError('Usage: ox mcp <list|add|remove>');
    }
    return out;
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new ArgParseError(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '-p':
      case '--print': {
        // `ox -p "prompt"` or `ox -p` (read stdin)
        const peek = args[i + 1];
        if (peek !== undefined && !peek.startsWith('-')) {
          out.prompt = peek;
          i++;
        } else {
          out.promptFromStdin = true;
        }
        break;
      }
      case '--prompt':
        out.prompt = next();
        break;
      case '-c':
      case '--continue':
        out.continueSession = true;
        break;
      case '-r':
      case '--resume':
        out.resume = true;
        break;
      case '--model':
      case '-m':
        out.model = next();
        break;
      case '--base-url':
        out.baseUrl = next();
        break;
      case '--permission-mode': {
        const v = next();
        const parsed = PermissionModeSchema.safeParse(v);
        if (!parsed.success) {
          throw new ArgParseError(`Invalid permission mode "${v}". Expected: default | askAll | acceptEdits | plan | dangerouslySkipPermissions`);
        }
        out.permissionMode = parsed.data;
        break;
      }
      case '--effort': {
        const v = next();
        const parsed = ReasoningEffortSchema.safeParse(v);
        if (!parsed.success) throw new ArgParseError(`Invalid effort "${v}". Expected: low | medium | high`);
        out.reasoningEffort = parsed.data;
        break;
      }
      case '--dangerously-skip-permissions':
        out.dangerouslySkipPermissions = true;
        break;
      case '--pentest':
        out.pentest = true;
        break;
      case '--swarm':
        out.swarm = true;
        break;
      case '--output-format': {
        const v = next();
        const parsed = OutputFormatSchema.safeParse(v);
        if (!parsed.success) throw new ArgParseError(`Invalid output format "${v}". Expected: text | json | stream-json`);
        out.outputFormat = parsed.data;
        break;
      }
      case '--max-turns': {
        const v = Number(next());
        if (!Number.isInteger(v) || v <= 0) throw new ArgParseError('--max-turns must be a positive integer');
        out.maxTurns = v;
        break;
      }
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-v':
      case '--version':
        out.version = true;
        break;
      default:
        if (a.startsWith('-')) throw new ArgParseError(`Unknown option: ${a}`);
        if (out.path !== undefined) throw new ArgParseError(`Unexpected extra argument: ${a}`);
        out.path = a;
    }
  }
  return out;
}

export const HELP_TEXT = `OxCode — autonomous terminal coding agent powered by MiniMax M3

Usage:
  ox [path]                     Start an interactive session (optionally in [path])
  ox -p "prompt"                Run a single prompt headlessly and exit
  echo "prompt" | ox -p         Read the prompt from stdin
  ox mcp <list|add|remove>      Manage MCP servers

Options:
  -p, --print [prompt]          Headless mode. With no value, reads the prompt from stdin
  -c, --continue                Continue the most recent session in this directory
  -r, --resume                  Pick a previous session to resume
  -m, --model <model>           Model to use (default: minimax/minimax-m3:free)
      --base-url <url>          OpenAI-compatible API base URL
      --permission-mode <mode>  default | askAll | acceptEdits | plan | dangerouslySkipPermissions
      --effort <level>          Reasoning effort: low | medium | high
      --pentest                 Enable pentest mode (authorized security-testing methodology)
      --swarm                   Open the 3D swarm office: parallel subtasks appear as live workers
      --dangerously-skip-permissions
                                Run every tool without asking (dangerous)
      --output-format <fmt>     text | json | stream-json (headless mode)
      --max-turns <n>           Maximum agent turns per request
  -h, --help                    Show this help
  -v, --version                 Show version

Environment:
  OPENROUTER_API_KEY            API key for OpenRouter (or OX_API_KEY)
  OX_BASE_URL                   Override the API base URL
  OX_MODEL                      Override the default model
  OX_DEBUG=1                    Write redacted debug logs to ~/.ox/debug.log
`;
