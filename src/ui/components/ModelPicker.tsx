import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { MODEL_PRESETS } from '../../commands/slash.js';
import { colors, symbols } from '../theme.js';

export function ModelPicker({
  current,
  onPick,
}: {
  current: string;
  onPick: (model: string | null) => void;
}): React.JSX.Element {
  // presets first; if the current model isn't among them, show it on top
  const items = MODEL_PRESETS.some((p) => p.id === current)
    ? MODEL_PRESETS
    : [{ id: current, note: 'current' }, ...MODEL_PRESETS];
  const [selected, setSelected] = useState(Math.max(0, items.findIndex((i) => i.id === current)));

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => (s + items.length - 1) % items.length);
    else if (key.downArrow) setSelected((s) => (s + 1) % items.length);
    else if (key.return) onPick(items[selected]?.id ?? null);
    else if (key.escape || (key.ctrl && input === 'c')) onPick(null);
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Select a model (Enter to choose, Esc to cancel, or type /model &lt;name&gt; for any other)</Text>
      <Box flexDirection="column" marginTop={1} marginLeft={1}>
        {items.map((m, i) => (
          <Box key={m.id}>
            <Text color={i === selected ? colors.accent : undefined} bold={i === selected}>
              {i === selected ? `${symbols.prompt} ` : '  '}
              {m.id}
              {m.id === current ? ' ✓' : ''}
            </Text>
            <Text dimColor>{`  ${m.note}`}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
