import React from 'react';
import { Box, Text } from 'ink';
import type { DiffSummary } from '../../utils/diffView.js';
import { colors, symbols } from '../theme.js';

export interface ToolEntry {
  id: string;
  name: string;
  summary: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  diff?: DiffSummary;
  diffPath?: string;
}

const MAX_DIFF_LINES = 24;

function DiffView({ diff }: { diff: DiffSummary }): React.JSX.Element {
  const rows: React.JSX.Element[] = [];
  let shown = 0;
  let hidden = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'ctx') continue;
      if (shown >= MAX_DIFF_LINES) {
        hidden++;
        continue;
      }
      shown++;
      rows.push(
        <Text key={rows.length} color={line.type === 'add' ? colors.add : colors.del} wrap="wrap">
          {line.type === 'add' ? '+' : '-'} {line.text}
        </Text>,
      );
    }
  }
  if (hidden > 0) {
    rows.push(
      <Text key="more" dimColor>
        {symbols.ellipsis} {hidden} more changed lines
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" marginLeft={7}>
      {rows}
    </Box>
  );
}

/** Compact single-line rendering for one tool call, with inline diff for edits. */
export function ToolView({ entry }: { entry: ToolEntry }): React.JSX.Element {
  const statusIcon =
    entry.status === 'running' ? (
      <Text color={colors.accent}>{symbols.working}</Text>
    ) : entry.status === 'error' ? (
      <Text color={colors.error}>{symbols.failure}</Text>
    ) : (
      <Text color={colors.success}>{symbols.success}</Text>
    );

  const label = toolLabel(entry.name);
  const counts =
    entry.diff && (entry.diff.added > 0 || entry.diff.removed > 0)
      ? `  +${entry.diff.added} -${entry.diff.removed}`
      : '';

  return (
    <Box flexDirection="column">
      <Box marginLeft={2}>
        <Text>
          {entry.status === 'running' ? statusIcon : null}
          {entry.status === 'running' ? ' ' : ''}
          <Text color={colors.toolName} bold>
            {label.padEnd(7)}
          </Text>
          <Text> {entry.summary}</Text>
          {entry.status === 'error' ? <Text color={colors.error}> {symbols.failure}</Text> : null}
          <Text dimColor>{counts}</Text>
        </Text>
      </Box>
      {entry.diff && entry.status !== 'running' ? <DiffView diff={entry.diff} /> : null}
    </Box>
  );
}

function toolLabel(name: string): string {
  switch (name) {
    case 'read_file':
      return 'Read';
    case 'list_directory':
      return 'List';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Search';
    case 'write_file':
      return 'Write';
    case 'apply_patch':
      return 'Edit';
    case 'delete_path':
      return 'Delete';
    case 'move_path':
      return 'Move';
    case 'bash':
      return 'Bash';
    case 'git_status':
    case 'git_diff':
    case 'git_log':
      return 'Git';
    case 'todo_write':
      return 'Tasks';
    case 'task':
      return 'Task';
    default:
      return name.startsWith('mcp__') ? 'MCP' : name;
  }
}
