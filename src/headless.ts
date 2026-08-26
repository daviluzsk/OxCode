import type { OutputFormat } from './config/types.js';
import type { Runtime } from './runtime.js';
import { headlessApprover } from './permissions/manager.js';
import type { AgentHooks } from './agent/loop.js';
import { redactSecrets } from './utils/redact.js';

/**
 * Headless (non-interactive) execution for scripts, automation and CI.
 * In headless mode permission prompts cannot be shown: read-only tools run,
 * anything requiring approval is denied unless --dangerously-skip-permissions
 * (or an auto-approving permission mode) is set.
 */
export async function runHeadless(opts: {
  runtime: Runtime;
  prompt: string;
  outputFormat: OutputFormat;
}): Promise<number> {
  const { runtime, prompt, outputFormat } = opts;
  const streamJson = outputFormat === 'stream-json';
  const plainText = outputFormat === 'text';

  const emit = (obj: Record<string, unknown>) => {
    if (streamJson) process.stdout.write(JSON.stringify(obj) + '\n');
  };

  let streamedText = '';
  const hooks: AgentHooks = {
    onTextDelta(text) {
      if (plainText) process.stdout.write(text);
      streamedText += text;
      emit({ type: 'text-delta', text });
    },
    onToolStart(call, summary) {
      if (plainText) process.stderr.write(`\n[tool] ${call.name} ${summary}\n`);
      emit({ type: 'tool-start', name: call.name, summary });
    },
    onToolEnd(call, result) {
      if (plainText) {
        const mark = result.isError ? '✗' : '✓';
        process.stderr.write(`[tool ${mark}] ${call.name}\n`);
      }
      emit({ type: 'tool-end', name: call.name, isError: result.isError ?? false, content: result.content.slice(0, 2000) });
    },
    onCompact(before, after) {
      emit({ type: 'compact', beforeMessages: before, afterMessages: after });
    },
    onError(message) {
      if (plainText) process.stderr.write(`\n[error] ${redactSecrets(message)}\n`);
      emit({ type: 'error', message: redactSecrets(message) });
    },
  };

  // Headless approvals: acceptEdits auto-approves edits; everything else
  // that requires asking is denied (documented behavior).
  runtime.permissions.setApprover(headlessApprover);

  const agent = runtime.makeAgent(hooks);
  emit({ type: 'start', model: runtime.config.model, cwd: runtime.config.cwd });
  const result = await agent.run(prompt);
  runtime.sessionStore.save(runtime.session);
  emit({ type: 'done', status: result.status });

  if (outputFormat === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          status: result.status,
          text: result.finalText,
          error: result.errorText,
          usage: runtime.session.data.usage,
          sessionId: runtime.session.data.id,
          model: runtime.config.model,
        },
        null,
        2,
      ) + '\n',
    );
  } else if (plainText) {
    if (streamedText && !streamedText.endsWith('\n')) process.stdout.write('\n');
    if (result.status === 'max-turns') {
      process.stderr.write(`\nStopped: reached --max-turns (${runtime.config.maxTurns}).\n`);
    } else if (result.status === 'error') {
      process.stderr.write(`\nFailed: ${redactSecrets(result.errorText ?? 'unknown error')}\n`);
    }
  }

  return result.status === 'completed' ? 0 : 1;
}
