import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionMeta } from '../../sessions/store.js';
import { colors, symbols } from '../theme.js';

export function SessionPicker({
  sessions,
  onPick,
}: {
  sessions: SessionMeta[];
  onPick: (id: string | null) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => (s + sessions.length - 1) % sessions.length);
    else if (key.downArrow) setSelected((s) => (s + 1) % sessions.length);
    else if (key.return) onPick(sessions[selected]?.id ?? null);
    else if (key.escape || (key.ctrl && input === 'c')) onPick(null);
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Resume a session (Enter to select, Esc to cancel)</Text>
      <Box flexDirection="column" marginTop={1} marginLeft={1}>
        {sessions.slice(0, 12).map((s, i) => (
          <Text key={s.id} color={i === selected ? colors.accent : undefined} bold={i === selected} wrap="truncate">
            {i === selected ? `${symbols.prompt} ` : '  '}
            {s.updatedAt.slice(0, 16).replace('T', ' ')} {symbols.bullet} {s.messageCount} msgs{' '}
            {symbols.bullet} {s.preview || '(empty)'}
          </Text>
        ))}
        {sessions.length === 0 ? <Text dimColor>No previous sessions in this directory.</Text> : null}
      </Box>
    </Box>
  );
}
