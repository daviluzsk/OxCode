import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../../agent/todo.js';
import { colors, symbols } from '../theme.js';

export function TodoPanel({ items }: { items: TodoItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" marginLeft={1} marginBottom={1}>
      <Text bold dimColor>
        Tasks
      </Text>
      {items.map((t, i) => {
        const mark =
          t.status === 'done' ? (
            <Text color={colors.success}>{symbols.success}</Text>
          ) : t.status === 'in_progress' ? (
            <Text color={colors.accent}>{symbols.working}</Text>
          ) : (
            <Text dimColor>○</Text>
          );
        return (
          <Box key={i} marginLeft={1}>
            <Text>
              {mark} <Text dimColor={t.status !== 'in_progress'}>{t.content}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
