import type { PermissionMode } from '../config/types.js';
import type { ToolDefinition } from '../tools/types.js';
import { classifyCommand, type RiskAssessment } from './risk.js';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface ApprovalRequest {
  toolName: string;
  summary: string;
  reason: string;
  /** Show the user that this is unusually dangerous. */
  danger: boolean;
}

export type ApprovalResponse = 'yes' | 'yes-session' | 'no';

/** The UI (or headless policy) answers approval requests through this. */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalResponse>;

interface PendingCheck {
  tool: ToolDefinition;
  args: unknown;
}

/**
 * Decides whether a tool call may run, must ask, or is denied,
 * according to the active permission mode and session approvals.
 */
export class PermissionManager {
  private mode: PermissionMode;
  private approver: Approver;
  /** Live check for whether pentest mode is active (reads config each call). */
  private readonly isPentestActive: () => boolean;
  /** Session-scoped "allow similar" approvals (tool name or command prefix). */
  private readonly sessionApprovals = new Set<string>();

  constructor(mode: PermissionMode, approver: Approver, isPentestActive: () => boolean = () => false) {
    this.mode = mode;
    this.approver = approver;
    this.isPentestActive = isPentestActive;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setApprover(approver: Approver): void {
    this.approver = approver;
  }

  /** Synchronous pre-classification; may already return allow/deny. */
  classify(tool: ToolDefinition, args: unknown): { decision: PermissionDecision; reason: string; danger: boolean } {
    if (this.mode === 'dangerouslySkipPermissions') {
      return { decision: 'allow', reason: 'permissions skipped', danger: false };
    }
    if (this.mode === 'plan') {
      if (tool.mutating || tool.kind === 'execute') {
        return { decision: 'deny', reason: 'Plan mode: no file mutations or command execution allowed.' , danger: false };
      }
      return { decision: 'allow', reason: 'read-only', danger: false };
    }

    // Pentest toolkit: with pentest mode on, the operator is the authorized
    // owner of the target, so the security tools run without per-call prompts.
    // (Plan mode above still blocks them; dangerouslySkip already allowed.)
    if (tool.category === 'pentest' && this.isPentestActive()) {
      return { decision: 'allow', reason: 'pentest mode: authorized toolkit', danger: false };
    }

    // askAll: every single tool call requires approval. "Allow similar this
    // session" still works as the escape hatch; high-risk stays danger-flagged.
    if (this.mode === 'askAll') {
      if (this.sessionApprovals.has(sessionKey(tool, args))) {
        return { decision: 'allow', reason: 'approved for this session', danger: false };
      }
      const risk = tool.name === 'bash' ? classifyCommand((args as { command?: string }).command ?? '') : null;
      const danger = risk?.level === 'high' || tool.name === 'delete_path';
      const what =
        tool.kind === 'execute' ? 'runs a command' : tool.mutating ? 'modifies files or external state' : 'reads data';
      return { decision: 'ask', reason: `askAll mode: every action needs approval — this one ${what}`, danger };
    }

    // bash: risk-based
    if (tool.name === 'bash') {
      const command = (args as { command?: string }).command ?? '';
      const risk: RiskAssessment = classifyCommand(command);
      if (this.sessionApprovals.has(sessionKey(tool, args))) {
        return { decision: 'allow', reason: 'approved for this session', danger: false };
      }
      if (risk.level === 'high') {
        return { decision: 'ask', reason: risk.reasons.join('; ') || 'high-risk command', danger: true };
      }
      if (risk.level === 'moderate') {
        if (this.mode === 'acceptEdits') {
          return { decision: 'ask', reason: risk.reasons.join('; ') || 'potentially mutating command', danger: false };
        }
        return { decision: 'ask', reason: risk.reasons.join('; ') || 'potentially mutating command', danger: false };
      }
      return { decision: 'allow', reason: 'read-only command', danger: false };
    }

    // file mutations
    if (tool.mutating) {
      if (this.sessionApprovals.has(sessionKey(tool, args))) {
        return { decision: 'allow', reason: 'approved for this session', danger: false };
      }
      if (this.mode === 'acceptEdits') {
        // delete stays gated even in acceptEdits
        if (tool.name === 'delete_path') {
          return { decision: 'ask', reason: 'deleting files is destructive', danger: false };
        }
        return { decision: 'allow', reason: 'acceptEdits mode', danger: false };
      }
      const reason =
        tool.name === 'delete_path' ? 'deleting files is destructive' : 'modifies files on disk';
      return { decision: 'ask', reason, danger: tool.name === 'delete_path' };
    }

    // read-only tools (read_file, grep, glob, git_*, todo_write, task)
    return { decision: 'allow', reason: 'read-only', danger: false };
  }

  /** Full check including interactive approval when required. */
  async check(tool: ToolDefinition, args: unknown, summary: string): Promise<{ allowed: boolean; reason: string }> {
    const c = this.classify(tool, args);
    if (c.decision === 'allow') return { allowed: true, reason: c.reason };
    if (c.decision === 'deny') return { allowed: false, reason: c.reason };

    const response = await this.approver({
      toolName: tool.name,
      summary,
      reason: c.reason,
      danger: c.danger,
    });
    if (response === 'yes') return { allowed: true, reason: 'approved by user' };
    if (response === 'yes-session') {
      this.sessionApprovals.add(sessionKey(tool, args));
      return { allowed: true, reason: 'approved for this session' };
    }
    return { allowed: false, reason: 'denied by user' };
  }
}

function sessionKey(tool: ToolDefinition, args: unknown): string {
  if (tool.name === 'bash') {
    const command = ((args as { command?: string }).command ?? '').trim();
    const first = command.split(/\s+/).slice(0, 2).join(' ');
    return `bash:${first}`;
  }
  return `tool:${tool.name}`;
}

/** Approver used in headless mode: safe things pass, everything else is denied. */
export const headlessApprover: Approver = async () => 'no';
