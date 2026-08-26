import { describe, expect, it } from 'vitest';
import { BrowserManager } from '../src/browser/manager.js';
import { createBrowserTools } from '../src/tools/browser.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { validateArgs } from '../src/tools/types.js';

function setup() {
  const manager = new BrowserManager();
  const tools = createBrowserTools(manager);
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  return { manager, tools, registry };
}

describe('browser tools', () => {
  it('registers the full browser tool set', () => {
    const { registry } = setup();
    const names = registry.all().map((t) => t.name);
    for (const expected of [
      'browser_open',
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_click_xy',
      'browser_fill',
      'browser_press',
      'browser_scroll',
      'browser_back',
      'browser_screenshot',
      'browser_close',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('marks consequential actions as mutating (approval in default mode)', () => {
    const { registry } = setup();
    for (const name of ['browser_click', 'browser_click_xy', 'browser_fill', 'browser_press']) {
      expect(registry.get(name)!.mutating).toBe(true);
    }
    for (const name of ['browser_open', 'browser_navigate', 'browser_snapshot', 'browser_scroll', 'browser_back', 'browser_screenshot', 'browser_close']) {
      expect(registry.get(name)!.mutating).toBe(false);
    }
  });

  it('validates click_xy normalized coordinates', () => {
    const { registry } = setup();
    const click = registry.get('browser_click_xy')!;
    expect(validateArgs(click, '{"x":500,"y":250}').ok).toBe(true);
    expect(validateArgs(click, '{"x":1200,"y":250}').ok).toBe(false);
    expect(validateArgs(click, '{"x":-5,"y":250}').ok).toBe(false);
    expect(validateArgs(click, '{"x":500}').ok).toBe(false);
  });

  it('validates arguments', () => {
    const { registry } = setup();
    const click = registry.get('browser_click')!;
    expect(validateArgs(click, '{}').ok).toBe(false);
    expect(validateArgs(click, '{"ref":"e3"}').ok).toBe(true);
    const fill = registry.get('browser_fill')!;
    const bad = validateArgs(fill, '{"ref":"e3"}');
    expect(bad.ok).toBe(false);
    expect(validateArgs(fill, '{"ref":"e3","text":"fone bluetooth","submit":true}').ok).toBe(true);
  });

  it('summarize includes the element name from the last snapshot', () => {
    const { manager, registry } = setup();
    manager.lastRefs.set('e7', 'Comprar agora');
    expect(registry.get('browser_click')!.summarize({ ref: 'e7' })).toBe('click e7 "Comprar agora"');
    expect(registry.get('browser_click')!.summarize({ ref: 'e9' })).toBe('click e9');
    manager.lastRefs.set('e3', 'Buscar');
    expect(registry.get('browser_fill')!.summarize({ ref: 'e3', text: 'fone' })).toBe('type "fone" into e3 "Buscar"');
  });

  it('reports not-open status before launch', async () => {
    const { manager } = setup();
    expect(await manager.status()).toEqual({ open: false });
  });
});
