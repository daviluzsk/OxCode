import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, symbols } from '../theme.js';

export interface Completion {
  name: string;
  description: string;
}

export interface InputBoxProps {
  onSubmit(text: string): void;
  onInterrupt(): void;
  onExitRequest(): void;
  disabled: boolean;
  history: string[];
  model: string;
  mode: string;
  statusRight?: string;
  contextPct?: number;
  completions: Completion[];
  placeholder?: string;
}

const MAX_POPUP_ITEMS = 8;

/**
 * Bordered, full-width prompt input with slash-command autocomplete,
 * multiline support, history and paste handling.
 * Enter submits · Ctrl+N newline · Tab/Enter completes a /command.
 */
export function InputBox({
  onSubmit,
  onInterrupt,
  onExitRequest,
  disabled,
  history,
  model,
  mode,
  statusRight,
  contextPct,
  completions,
  placeholder,
}: InputBoxProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const lastCtrlC = useRef(0);

  const popupOpen = useMemo(() => {
    if (popupDismissed) return false;
    return value.startsWith('/') && !value.includes(' ') && value.length >= 1;
  }, [value, popupDismissed]);

  const matches = useMemo(() => {
    if (!popupOpen) return [];
    const prefix = value.slice(1).toLowerCase();
    return completions.filter((c) => c.name.toLowerCase().startsWith(prefix)).slice(0, MAX_POPUP_ITEMS);
  }, [popupOpen, value, completions]);

  const showPopup = popupOpen && matches.length > 0;
  const selectedMatch = showPopup ? matches[Math.min(selected, matches.length - 1)] : undefined;

  const submit = useCallback(() => {
    const text = value.trim();
    // While busy the host decides what to accept (e.g. /btw) and what to
    // reject with a hint — the input itself never swallows text silently.
    if (!text) return;
    setValue('');
    setCursor(0);
    setHistoryIndex(null);
    setPopupDismissed(false);
    onSubmit(text);
  }, [value, onSubmit]);

  const completeWith = useCallback((name: string) => {
    const v = `/${name}`;
    setValue(v);
    setCursor(v.length);
    setPopupDismissed(true);
  }, []);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        const now = Date.now();
        if (disabled) {
          onInterrupt();
        } else if (now - lastCtrlC.current < 1500) {
          onExitRequest();
        } else {
          lastCtrlC.current = now;
          onInterrupt();
        }
        return;
      }
      if (key.ctrl && input === 'd') {
        onExitRequest();
        return;
      }

      // Popup navigation takes precedence over history navigation.
      if (showPopup) {
        if (key.upArrow) {
          setSelected((s) => (s + matches.length - 1) % matches.length);
          return;
        }
        if (key.downArrow) {
          setSelected((s) => (s + 1) % matches.length);
          return;
        }
        if (key.tab) {
          if (selectedMatch) completeWith(selectedMatch.name);
          return;
        }
        if (key.escape) {
          setPopupDismissed(true);
          return;
        }
        if (key.return) {
          if (selectedMatch && value !== `/${selectedMatch.name}`) {
            completeWith(selectedMatch.name);
          } else {
            submit();
          }
          return;
        }
      }

      // Bulk input (paste): insert everything verbatim, including newlines.
      if (input && input.length > 1 && !key.ctrl && !key.meta) {
        const cleaned = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        setValue((v) => v.slice(0, cursor) + cleaned + v.slice(cursor));
        setCursor((c) => c + cleaned.length);
        return;
      }

      if (key.return) {
        submit();
        return;
      }
      if (key.ctrl && (input === 'n' || input === 'j')) {
        setValue((v) => v.slice(0, cursor) + '\n' + v.slice(cursor));
        setCursor((c) => c + 1);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
          setPopupDismissed(false);
          setSelected(0);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }
      if (key.upArrow) {
        if (history.length === 0) return;
        const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        const h = history[next] ?? '';
        setValue(h);
        setCursor(h.length);
        return;
      }
      if (key.downArrow) {
        if (historyIndex === null) return;
        if (historyIndex >= history.length - 1) {
          setHistoryIndex(null);
          setValue('');
          setCursor(0);
        } else {
          const next = historyIndex + 1;
          setHistoryIndex(next);
          const h = history[next] ?? '';
          setValue(h);
          setCursor(h.length);
        }
        return;
      }
      if (key.ctrl && input === 'a') {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === 'e') {
        setCursor(value.length);
        return;
      }
      if (key.ctrl && input === 'u') {
        setValue((v) => v.slice(cursor));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + input.length);
        setPopupDismissed(false);
        setSelected(0);
      }
    },
    { isActive: true },
  );

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? '';
  const after = value.slice(cursor + 1);
  const lines = (before + (at ? `‌${at}` : '‌') + after).split('\n');

  return (
    <Box flexDirection="column" marginTop={1}>
      {showPopup ? (
        <Box borderStyle="round" borderColor={colors.dim} flexDirection="column" paddingX={1} marginBottom={0}>
          {matches.map((m, i) => (
            <Box key={m.name} justifyContent="space-between" width="100%">
              <Text color={i === selected ? colors.accent : undefined} bold={i === selected}>
                {i === selected ? `${symbols.prompt} ` : '  '}/{m.name}
              </Text>
              <Text dimColor wrap="truncate-end">
                {'  '}{m.description}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor={disabled ? colors.dim : colors.accent} paddingX={1} flexDirection="column">
        {value.length === 0 ? (
          <Text>
            <Text color={colors.accent} bold>
              {symbols.prompt}{' '}
            </Text>
            <Text dimColor>{placeholder ?? 'Describe a coding task…  (/ for commands)'}</Text>
          </Text>
        ) : (
          <Box flexDirection="row">
            <Text color={colors.accent} bold>
              {symbols.prompt}{' '}
            </Text>
            <Box flexDirection="column" flexGrow={1}>
              {lines.map((line, i) => (
                <Text key={i} wrap="wrap">
                  {renderWithCursor(line)}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        <Box justifyContent="flex-end">
          <Text dimColor>
            {model} · {mode}
          </Text>
          {typeof contextPct === 'number' ? (
            <Text>
              <Text dimColor> · </Text>
              <Text color={contextPct >= 85 ? colors.error : contextPct >= 60 ? colors.warning : colors.dim}>
                {contextPct}% ctx
              </Text>
            </Text>
          ) : null}
        </Box>
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>
          Enter:send · Ctrl+N:newline · ↑↓:history{showPopup ? ' · Tab:complete' : ''} · Ctrl+C:interrupt
        </Text>
        {statusRight ? <Text dimColor>{statusRight}</Text> : null}
      </Box>
    </Box>
  );
}

function renderWithCursor(line: string): React.ReactNode {
  const idx = line.indexOf('‌'); // zero-width non-joiner marks the cursor slot
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const rest = line.slice(idx + 1);
  const cursorChar = rest[0] ?? ' ';
  const after = rest.slice(1);
  return (
    <>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </>
  );
}
