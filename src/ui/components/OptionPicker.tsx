import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ChoiceSpec } from '../../commands/slash.js';
import { colors, symbols } from '../theme.js';

/**
 * Generic single-choice picker (arrow keys + Enter), styled to match the
 * model picker. Used for reasoning effort, permission mode, pentest, etc.
 */
export function OptionPicker({ spec, onPick }: { spec: ChoiceSpec; onPick: (id: string | null) => void }): React.JSX.Element {
  const { title, options, current } = spec;
  const [selected, setSelected] = useState(Math.max(0, options.findIndex((o) => o.id === current)));

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => (s + options.length - 1) % options.length);
    else if (key.downArrow) setSelected((s) => (s + 1) % options.length);
    else if (key.return) onPick(options[selected]?.id ?? null);
    else if (key.escape || (key.ctrl && input === 'c')) onPick(null);
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>
        {title} <Text dimColor>(↑↓ to move, Enter to choose, Esc to cancel)</Text>
      </Text>
      <Box flexDirection="column" marginTop={1} marginLeft={1}>
        {options.map((o, i) => (
          <Box key={o.id}>
            <Text color={i === selected ? colors.accent : undefined} bold={i === selected}>
              {i === selected ? `${symbols.prompt} ` : '  '}
              {o.label ?? o.id}
              {o.id === current ? ' ✓' : ''}
            </Text>
            {o.note ? <Text dimColor>{`  ${o.note}`}</Text> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
