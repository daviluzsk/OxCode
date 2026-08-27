import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../theme.js';
import { ToolView, type ToolEntry } from './ToolView.js';
import { formatDuration } from '../../utils/format.js';
import { Markdown } from '../markdown.js';

export type HistoryEntry =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'tool'; tool: ToolEntry }
  | { id: string; kind: 'info'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'summary'; files: number; added: number; removed: number; durationMs?: number }
  | { id: string; kind: 'banner'; lines: string[] };

export function HistoryView({ entry }: { entry: HistoryEntry }): React.JSX.Element | null {
  switch (entry.kind) {
    case 'user':
      return (
        <Box marginTop={1} marginLeft={1}>
          <Text bold color={colors.user}>
            {symbols.prompt} {entry.text}
          </Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box flexDirection="column" marginTop={1} marginLeft={1}>
          <Markdown text={entry.text} />
        </Box>
      );
    case 'banner':
      return (
        <Box flexDirection="column" marginTop={1}>
          {entry.lines.map((l, i) => (
            <Text key={i} color={colors.accent} bold wrap="truncate-end">
              {l}
            </Text>
          ))}
        </Box>
      );
    case 'tool':
      return <ToolView entry={entry.tool} />;
    case 'info':
      return (
        <Box marginTop={1} marginLeft={1} flexDirection="column">
          {entry.text.split('\n').map((line, i) => (
            <Text key={i} dimColor wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={1} marginLeft={1}>
          <Text color={colors.error} wrap="wrap">
            {symbols.failure} {entry.text}
          </Text>
        </Box>
      );
    case 'summary':
      return (
        <Box marginTop={1} marginLeft={1}>
          <Text dimColor>
            {entry.files} file{entry.files === 1 ? '' : 's'} changed{' '}
            <Text color={colors.add}>+{entry.added}</Text>{' '}
            <Text color={colors.del}>-{entry.removed}</Text>
            {entry.durationMs ? ` ${symbols.bullet} ${formatDuration(entry.durationMs)}` : ''}
          </Text>
        </Box>
      );
    default:
      return null;
  }
}
