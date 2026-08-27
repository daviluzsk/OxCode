import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import type { ContentPart } from '../api/index.js';
import type { AgentHooks } from '../agent/loop.js';
import type { TodoItem } from '../agent/todo.js';
import { BUILTIN_COMMANDS, handleSlashCommand, type CommandHost, type ChoiceSpec } from '../commands/slash.js';
import { loadCustomCommands } from '../commands/custom.js';
import type { ApprovalRequest, ApprovalResponse } from '../permissions/manager.js';
import type { Runtime } from '../runtime.js';
import { loadInputHistory, saveInputHistory } from './inputHistory.js';
import { colors, symbols, brand, applyTheme, FSOCIETY_BANNER } from './theme.js';
import { resolveAttachments } from './attachments.js';
import { Header } from './components/Header.js';
import { HistoryView, type HistoryEntry } from './components/HistoryView.js';
import type { ToolEntry } from './components/ToolView.js';
import { ToolView } from './components/ToolView.js';
import { ApprovalPrompt } from './components/ApprovalPrompt.js';
import { InputBox } from './components/InputBox.js';
import { ModelPicker } from './components/ModelPicker.js';
import { OptionPicker } from './components/OptionPicker.js';
import { SessionPicker } from './components/SessionPicker.js';
import { TodoPanel } from './components/TodoPanel.js';
import { displayPath } from '../utils/paths.js';
import { estimateMessagesTokens } from '../agent/loop.js';
import { formatCount, formatDuration } from '../utils/format.js';
import { Markdown } from './markdown.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (r: ApprovalResponse) => void;
}

export function App({ runtime, startWithResumePicker }: { runtime: Runtime; startWithResumePicker: boolean }): React.JSX.Element {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activeTools, setActiveTools] = useState<ToolEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [showResume, setShowResume] = useState(startWithResumePicker);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [choice, setChoice] = useState<ChoiceSpec | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>(() => loadInputHistory(runtime.config.cwd));
  const [model, setModel] = useState(runtime.config.model);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [exitHint, setExitHint] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [, setMrRobot] = useState(false); // forces a repaint when the theme flips

  const idRef = useRef(0);
  const runStartRef = useRef(0);
  const runAbortRef = useRef<AbortController | null>(null);
  const changedRef = useRef<{ files: Set<string>; added: number; removed: number }>({ files: new Set(), added: 0, removed: 0 });
  /** Live UI state for the /btw side channel (avoids stale closures). */
  const btwStateRef = useRef({ todos, activeTools, busy });
  useEffect(() => {
    btwStateRef.current = { todos, activeTools, busy };
  });

  const nextId = () => `h${++idRef.current}`;

  const pushEntry = useCallback((entry: HistoryEntry) => {
    setHistory((h) => [...h, entry]);
  }, []);

  const pushInfo = useCallback((text: string) => pushEntry({ id: nextId(), kind: 'info', text }), [pushEntry]);
  const pushError = useCallback((text: string) => pushEntry({ id: nextId(), kind: 'error', text }), [pushEntry]);

  // todo updates
  useEffect(() => runtime.todoStore.onChange(setTodos), [runtime]);

  // spinner + elapsed-time ticker (shared 90ms interval)
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER.length);
      setElapsed(Date.now() - runStartRef.current);
    }, 90);
    return () => clearInterval(t);
  }, [busy]);

  // approval callback wired to the permission manager
  useEffect(() => {
    runtime.permissions.setApprover(
      (request) =>
        new Promise<ApprovalResponse>((resolve) => {
          setApproval({ request, resolve });
        }),
    );
  }, [runtime]);

  const flushStreaming = useCallback(() => {
    setStreaming((current) => {
      const text = current.trim();
      if (text) {
        setHistory((h) => [...h, { id: nextId(), kind: 'assistant', text }]);
      }
      return '';
    });
  }, []);

  const makeHooks = useCallback((): AgentHooks => {
    return {
      onTextDelta: (text) => setStreaming((s) => s + text),
      onToolStart: (call, summary) => {
        flushStreaming();
        setActiveTools((tools) => [
          ...tools,
          { id: call.id, name: call.name, summary, status: 'running' },
        ]);
      },
      onToolEnd: (call, result) => {
        setActiveTools((tools) => {
          const finished = tools.find((t) => t.id === call.id);
          const entry: ToolEntry = {
            id: call.id,
            name: call.name,
            summary: finished?.summary ?? call.name,
            status: result.isError ? 'error' : 'done',
            diff: result.ui?.diff,
            diffPath: result.ui?.diffPath,
          };
          setHistory((h) => [...h, { id: nextId(), kind: 'tool', tool: entry }]);
          return tools.filter((t) => t.id !== call.id);
        });
        if (result.ui?.diff) {
          changedRef.current.added += result.ui.diff.added;
          changedRef.current.removed += result.ui.diff.removed;
          if (result.ui.diffPath) changedRef.current.files.add(result.ui.diffPath);
        } else if (result.ui && (result.ui.kind === 'delete' || result.ui.kind === 'move') && result.ui.detail) {
          changedRef.current.files.add(result.ui.detail);
        }
      },
      onCompact: (before, after) => pushInfo(`Context compacted: ${before} → ${after} messages.`),
      onError: (message) => pushError(message),
    };
  }, [flushStreaming, pushError, pushInfo]);

  const commandHost: CommandHost = useMemo(
    () => ({
      print: pushInfo,
      clear: () => setHistory([]),
      requestExit: () => {
        runtime.dispose();
        exit();
      },
      setModel: (m) => {
        runtime.setModel(m);
        setModel(m);
      },
      pickSession: () =>
        new Promise<string | null>((resolve) => {
          resumeResolveRef.current = resolve;
          setShowResume(true);
        }),
      pickModel: () =>
        new Promise<string | null>((resolve) => {
          modelResolveRef.current = resolve;
          setShowModelPicker(true);
        }),
      pickChoice: (spec) =>
        new Promise<string | null>((resolve) => {
          choiceResolveRef.current = resolve;
          setChoice(spec);
        }),
      setMrRobot: (on) => {
        applyTheme(on ? 'mrrobot' : 'ox');
        setMrRobot(on);
        if (on) pushEntry({ id: nextId(), kind: 'banner', lines: FSOCIETY_BANNER });
        else pushInfo('fsociety mode off — back to OxCode.');
      },
      loadSession: (s) => {
        runtime.replaceSession(s);
        changedRef.current = { files: new Set(), added: 0, removed: 0 };
      },
      btw: (text) => {
        void (async () => {
          const { todos: td, activeTools: at, busy: isBusy } = btwStateRef.current;
          const tail = runtime.session.messages
            .slice(-8)
            .map((m) => {
              const c = typeof m.content === 'string' ? m.content : '[content with attachment]';
              const calls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0 ? ` → tools: ${m.tool_calls.map((t) => t.name).join(', ')}` : '';
              return `[${m.role}] ${c.replace(/\n/g, ' ').slice(0, 200)}${calls}`;
            })
            .join('\n');
          const note = [
            isBusy ? 'The main run is currently WORKING.' : 'The main run is currently IDLE (waiting for user input).',
            td.length > 0 ? `Task list:\n${td.map((t) => `- [${t.status}] ${t.content}`).join('\n')}` : '',
            at.length > 0 ? `Tools running right now:\n${at.map((t) => `- ${t.name}: ${t.summary}`).join('\n')}` : '',
            tail ? `Recent conversation tail:\n${tail}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          pushInfo(`💬 /btw: ${text}`);
          try {
            const result = await runtime.makeSideAgent(note).run(text);
            if (result.finalText.trim()) {
              pushInfo(`💬 ${result.finalText.trim()}`);
            } else if (result.status === 'error' && result.errorText) {
              pushError(`/btw failed: ${result.errorText}`);
            }
          } catch (e) {
            pushError(`/btw failed: ${(e as Error).message}`);
          }
        })();
      },
    }),
    [exit, pushInfo, pushError, runtime],
  );

  const resumeResolveRef = useRef<((id: string | null) => void) | null>(null);
  const modelResolveRef = useRef<((id: string | null) => void) | null>(null);
  const choiceResolveRef = useRef<((id: string | null) => void) | null>(null);

  const runAgent = useCallback(
    async (input: string) => {
      const { parts, notes } = resolveAttachments(runtime.config.cwd, input);
      for (const n of notes) pushInfo(n);
      const content: string | ContentPart[] = parts.length > 0 ? [...parts, { type: 'text', text: input }] : input;

      setBusy(true);
      runStartRef.current = Date.now();
      setElapsed(0);
      changedRef.current = { files: new Set(), added: 0, removed: 0 };
      const abort = new AbortController();
      runAbortRef.current = abort;
      const agent = runtime.makeAgent(makeHooks(), abort.signal);
      try {
        const result = await agent.run(content);
        flushStreaming();
        const changed = changedRef.current;
        if (changed.files.size > 0) {
          pushEntry({
            id: nextId(),
            kind: 'summary',
            files: changed.files.size,
            added: changed.added,
            removed: changed.removed,
            durationMs: Date.now() - runStartRef.current,
          });
        }
        if (result.status === 'max-turns') {
          pushInfo(`Stopped after reaching the turn limit (${runtime.config.maxTurns}). Use /compact or continue the request.`);
        } else if (result.status === 'error' && result.errorText) {
          pushError(result.errorText);
        }
        runtime.sessionStore.save(runtime.session);
      } finally {
        setBusy(false);
        runAbortRef.current = null;
      }
    },
    [flushStreaming, makeHooks, pushEntry, pushError, pushInfo, runtime],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      // While the agent is working, only /btw goes through — everything else
      // gets a hint instead of silently vanishing or corrupting the run.
      if (busy && !/^\/btw\b/i.test(text)) {
        pushInfo('Agent is working — message not sent. Use /btw <question> to chat without interrupting, or Ctrl+C to stop the run.');
        return;
      }

      setInputHistory((h) => {
        const next = [...h.filter((x) => x !== text), text].slice(-200);
        saveInputHistory(runtime.config.cwd, next);
        return next;
      });

      if (text.startsWith('/')) {
        void (async () => {
          const outcome = await handleSlashCommand(text, {
            host: commandHost,
            session: () => runtime.session,
            agent: () => runtime.makeAgent(makeHooks(), runAbortRef.current?.signal),
            config: runtime.config,
            permissions: runtime.permissions,
            sessionStore: runtime.sessionStore,
            registry: runtime.registry,
            mcp: runtime.mcp,
            profile: runtime.profile,
            skills: runtime.skills,
            swarm: runtime.swarm,
          });
          if (outcome.kind === 'prompt') {
            pushEntry({ id: nextId(), kind: 'user', text });
            await runAgent(outcome.text);
          } else if (outcome.kind === 'unknown') {
            pushError(`Unknown command: /${outcome.name}. Type /help for available commands.`);
          }
        })();
        return;
      }
      pushEntry({ id: nextId(), kind: 'user', text });
      void runAgent(text);
    },
    [busy, commandHost, makeHooks, pushEntry, pushError, pushInfo, runAgent, runtime],
  );

  const handleInterrupt = useCallback(() => {
    if (busy) {
      runAbortRef.current?.abort();
      pushInfo('Interrupted. Cleaning up…');
    } else {
      setExitHint(true);
      setTimeout(() => setExitHint(false), 1600);
    }
  }, [busy, pushInfo]);

  const handleExit = useCallback(() => {
    try {
      runtime.sessionStore.save(runtime.session);
    } catch {
      /* best effort */
    }
    runtime.dispose();
    exit();
  }, [exit, runtime]);

  const sessions = useMemo(() => runtime.sessionStore.list(runtime.config.cwd), [runtime, showResume]);

  const completions = useMemo(() => {
    const custom = loadCustomCommands(runtime.config.cwd);
    return [
      ...BUILTIN_COMMANDS.map((c) => ({ name: c.name, description: c.description })),
      ...[...custom.values()].map((c) => ({ name: c.name, description: `${c.description} (custom)` })),
    ];
  }, [runtime]);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: 'header' }, ...history]}>
        {(item) =>
          item.id === 'header' ? (
            <Header
              key="header"
              cwd={displayPath(runtime.config.cwd, runtime.config.cwd)}
              model={model}
              provider={runtime.config.provider}
              fileCount={runtime.profile.fileCount}
              gitBranch={runtime.profile.gitBranch}
              dangerMode={runtime.config.permissionMode === 'dangerouslySkipPermissions'}
            />
          ) : (
            <HistoryView key={item.id} entry={item as HistoryEntry} />
          )
        }
      </Static>

      <TodoPanel items={todos} />

      {streaming ? (
        <Box marginLeft={1} marginTop={1} flexDirection="column">
          <Markdown text={streaming} />
        </Box>
      ) : null}

      {activeTools.map((t) => (
        <ToolView key={t.id} entry={t} />
      ))}

      {busy ? (
        <Box marginLeft={1} marginTop={activeTools.length === 0 && !streaming ? 1 : 0}>
          <Text color={colors.accent}>
            <Text dimColor>{brand.mascotMini} </Text>
            {SPINNER[spinnerFrame]} {streaming ? '' : 'Thinking… '}
            <Text dimColor>
              {formatDuration(elapsed)}
              {runtime.session.data.usage.outputTokens > 0
                ? ` · ${symbols.arrow}${formatCount(runtime.session.data.usage.outputTokens)} tok`
                : ''}
              {' · Ctrl+C to interrupt'}
            </Text>
          </Text>
        </Box>
      ) : null}

      {showResume ? (
        <SessionPicker
          sessions={sessions}
          onPick={(id) => {
            setShowResume(false);
            const resolve = resumeResolveRef.current;
            resumeResolveRef.current = null;
            if (resolve) {
              resolve(id);
            } else if (id) {
              const session = runtime.sessionStore.load(id);
              if (session) {
                runtime.replaceSession(session);
                pushInfo(`Resumed session ${session.data.id} (${session.messages.length} messages).`);
              }
            }
          }}
        />
      ) : choice ? (
        <OptionPicker
          spec={choice}
          onPick={(id) => {
            setChoice(null);
            const resolve = choiceResolveRef.current;
            choiceResolveRef.current = null;
            resolve?.(id);
          }}
        />
      ) : showModelPicker ? (
        <ModelPicker
          current={model}
          onPick={(picked) => {
            setShowModelPicker(false);
            const resolve = modelResolveRef.current;
            modelResolveRef.current = null;
            resolve?.(picked);
          }}
        />
      ) : approval ? (
        <ApprovalPrompt
          request={approval.request}
          onAnswer={(r) => {
            approval.resolve(r);
            setApproval(null);
          }}
        />
      ) : (
        <InputBox
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
          onExitRequest={handleExit}
          disabled={busy}
          history={inputHistory}
          model={runtime.config.reasoningEffort ? `${model} (${runtime.config.reasoningEffort})` : model}
          mode={runtime.config.pentest ? `${runtime.permissions.getMode()}·pentest` : runtime.permissions.getMode()}
          statusRight={`${runtime.session.data.usage.inputTokens.toLocaleString()} in / ${runtime.session.data.usage.outputTokens.toLocaleString()} out`}
          contextPct={Math.min(100, Math.round((estimateMessagesTokens(runtime.session.messages) / runtime.config.compactThreshold) * 100))}
          completions={completions}
          placeholder={busy ? 'Working…  /btw <question> to chat · Ctrl+C to interrupt' : undefined}
        />
      )}

      {exitHint && !busy ? (
        <Box marginLeft={1}>
          <Text dimColor>Press Ctrl+C again to exit.</Text>
        </Box>
      ) : null}
    </Box>
  );
}
