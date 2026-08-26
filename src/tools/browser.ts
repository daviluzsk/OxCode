import { z } from 'zod';
import type { BrowserManager } from '../browser/manager.js';
import { err, ok, type ToolDefinition, type ToolResult } from './types.js';

const WORKFLOW =
  'Workflow: navigate → browser_snapshot (lists interactive elements as refs like e1, e2…) → ' +
  'browser_click / browser_fill with a ref → browser_snapshot again (refs change after every action).';

function browserErr(e: unknown): ToolResult {
  const msg = (e as Error).message ?? String(e);
  return err(msg);
}

function fmtSnapshot(s: {
  url: string;
  title: string;
  elements: Array<{ ref: string; role: string; name: string; type?: string; href?: string; value?: string }>;
  textExcerpt: string;
  truncated: boolean;
}): string {
  const els = s.elements
    .map((el) => {
      const extra = [el.type ? `type=${el.type}` : '', el.value ? `value="${el.value}"` : '', el.href ? `href=${el.href}` : '']
        .filter(Boolean)
        .join(' ');
      return `${el.ref}  ${el.role}${extra ? ` (${extra})` : ''}  "${el.name}"`;
    })
    .join('\n');
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    '',
    '--- Interactive elements (use these refs) ---',
    els || '(none found)',
    s.truncated ? '…list truncated; scroll or narrow the page.' : '',
    '',
    '--- Page text (excerpt) ---',
    s.textExcerpt || '(empty)',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const navigateSchema = z.object({
  url: z.string().min(1).describe('URL to open, e.g. https://www.mercadolivre.com.br'),
});
type NavigateArgs = z.infer<typeof navigateSchema>;

const refSchema = z.object({
  ref: z.string().min(1).describe('Element ref from the latest browser_snapshot, e.g. e7'),
});
type RefArgs = z.infer<typeof refSchema>;

const fillSchema = z.object({
  ref: z.string().min(1).describe('Input/textarea ref from the latest browser_snapshot'),
  text: z.string().describe('Text to type into the field'),
  submit: z.boolean().optional().describe('Press Enter after typing (default false)'),
});
type FillArgs = z.infer<typeof fillSchema>;

const pressSchema = z.object({
  key: z.string().min(1).describe('Key name: Enter, Tab, Escape, ArrowDown, Backspace…'),
});
type PressArgs = z.infer<typeof pressSchema>;

const scrollSchema = z.object({
  direction: z.enum(['up', 'down']).describe('Scroll direction'),
  amount: z.number().int().min(100).max(3000).optional().describe('Pixels (default 700)'),
});
type ScrollArgs = z.infer<typeof scrollSchema>;

const emptySchema = z.object({}).strict();
type EmptyArgs = z.infer<typeof emptySchema>;

const xySchema = z.object({
  x: z.number().min(0).max(1000).describe('Horizontal position 0–1000 (0 = left, 1000 = right)'),
  y: z.number().min(0).max(1000).describe('Vertical position 0–1000 (0 = top, 1000 = bottom)'),
});
type XYArgs = z.infer<typeof xySchema>;

/** Browser automation tools backed by a persistent, visible browser window. */
export function createBrowserTools(manager: BrowserManager): ToolDefinition[] {
  const open: ToolDefinition<NavigateArgs> = {
    name: 'browser_open',
    description:
      'Open the agent-controlled browser window (persistent profile: logins stay saved) and navigate to a URL. ' +
      WORKFLOW,
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to open.' } },
      required: ['url'],
    },
    schema: navigateSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `open ${a.url}`,
    async execute(args) {
      try {
        const r = await manager.navigate(args.url);
        return ok(`Browser opened at ${r.url}\nTitle: ${r.title}\nNow call browser_snapshot to see the interactive elements.`, {
          kind: 'info',
          title: 'Browser',
          detail: r.url,
        });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const navigate: ToolDefinition<NavigateArgs> = {
    name: 'browser_navigate',
    description: 'Navigate the agent browser to a new URL. ' + WORKFLOW,
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to open.' } },
      required: ['url'],
    },
    schema: navigateSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `goto ${a.url}`,
    async execute(args) {
      try {
        const r = await manager.navigate(args.url);
        return ok(`Navigated to ${r.url}\nTitle: ${r.title}`, { kind: 'info', title: 'Browser', detail: r.url });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const snapshot: ToolDefinition<EmptyArgs> = {
    name: 'browser_snapshot',
    description:
      'Read the current page: URL, title, a text excerpt, and the numbered refs of all interactive elements. ' +
      'Call this after every navigation or click before acting — refs are only valid for the page state they were taken from.',
    parameters: { type: 'object', properties: {} },
    schema: emptySchema,
    kind: 'read',
    mutating: false,
    summarize: () => 'read page',
    async execute(_args, ctx) {
      try {
        void ctx;
        return ok(fmtSnapshot(await manager.snapshot()), { kind: 'info', title: 'Browser' });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const click: ToolDefinition<RefArgs> = {
    name: 'browser_click',
    description:
      'Click an element by its ref from the latest browser_snapshot. May trigger purchases, submissions or navigation — ' +
      'the user approves each click in default permission mode. Take a fresh snapshot afterwards.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Element ref, e.g. e7' } },
      required: ['ref'],
    },
    schema: refSchema,
    kind: 'write',
    mutating: true,
    summarize: (a) => {
      const name = manager.lastRefs.get(a.ref);
      return name ? `click ${a.ref} "${name}"` : `click ${a.ref}`;
    },
    async execute(args) {
      try {
        await manager.click(args.ref);
        return ok(`Clicked ${args.ref}. Take a browser_snapshot to see the result.`, {
          kind: 'info',
          title: 'Browser',
        });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const fill: ToolDefinition<FillArgs> = {
    name: 'browser_fill',
    description: 'Type text into an input/textarea by ref (optionally pressing Enter). Take a fresh snapshot afterwards.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Input ref, e.g. e3' },
        text: { type: 'string', description: 'Text to enter' },
        submit: { type: 'boolean', description: 'Press Enter after typing' },
      },
      required: ['ref', 'text'],
    },
    schema: fillSchema,
    kind: 'write',
    mutating: true,
    summarize: (a) => {
      const name = manager.lastRefs.get(a.ref);
      const target = name ? `${a.ref} "${name}"` : a.ref;
      return `type "${a.text.slice(0, 40)}" into ${target}`;
    },
    async execute(args) {
      try {
        await manager.fill(args.ref, args.text, args.submit ?? false);
        return ok(`Filled ${args.ref}${args.submit ? ' and pressed Enter' : ''}. Take a browser_snapshot to see the result.`, {
          kind: 'info',
          title: 'Browser',
        });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const press: ToolDefinition<PressArgs> = {
    name: 'browser_press',
    description: 'Press a keyboard key in the browser (Enter, Tab, Escape, ArrowDown…).',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Key name' } },
      required: ['key'],
    },
    schema: pressSchema,
    kind: 'write',
    mutating: true,
    summarize: (a) => `press ${a.key}`,
    async execute(args) {
      try {
        await manager.press(args.key);
        return ok(`Pressed ${args.key}.`, { kind: 'info', title: 'Browser' });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const scroll: ToolDefinition<ScrollArgs> = {
    name: 'browser_scroll',
    description: 'Scroll the page up or down, then take a snapshot to see newly visible elements.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', description: 'Pixels (default 700)' },
      },
      required: ['direction'],
    },
    schema: scrollSchema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `scroll ${a.direction}`,
    async execute(args) {
      try {
        await manager.scroll(args.direction, args.amount ?? 700);
        return ok(`Scrolled ${args.direction}.`, { kind: 'info', title: 'Browser' });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const back: ToolDefinition<EmptyArgs> = {
    name: 'browser_back',
    description: 'Go back to the previous page.',
    parameters: { type: 'object', properties: {} },
    schema: emptySchema,
    kind: 'read',
    mutating: false,
    summarize: () => 'go back',
    async execute() {
      try {
        await manager.back();
        return ok('Went back. Take a browser_snapshot to see the page.', { kind: 'info', title: 'Browser' });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const screenshot: ToolDefinition<EmptyArgs> = {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page and SEE it: the image is returned directly to you. ' +
      'Use it to read on-screen text (including image-based CAPTCHAs), check layout, or locate click targets. ' +
      'To click something you see, use browser_click_xy with normalized coordinates (0–1000 on both axes, ' +
      'x left→right, y top→bottom) matching what you see in the image. Also saved to .ox/browser/.',
    parameters: { type: 'object', properties: {} },
    schema: emptySchema,
    kind: 'read',
    mutating: false,
    summarize: () => 'look at the page',
    async execute(_args, ctx) {
      try {
        const shot = await manager.screenshot(ctx.cwd);
        return {
          content:
            `Screenshot attached (${shot.width}x${shot.height} viewport pixels, shown to you as an image).\n` +
            `Saved at: ${shot.file}\n` +
            'If you need to click something visible here, estimate its position in the image and call ' +
            'browser_click_xy with normalized coordinates 0–1000 (e.g. center = 500,500).',
          images: [{ data: shot.data, mimeType: shot.mimeType }],
          ui: { kind: 'info', title: 'Browser', detail: shot.file },
        };
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const clickXY: ToolDefinition<XYArgs> = {
    name: 'browser_click_xy',
    description:
      'Click a point on the page by normalized coordinates (0–1000 for both x and y) as seen on the latest ' +
      'browser_screenshot image. Use for image-based UI such as CAPTCHA grids. Approval-gated like browser_click. ' +
      'Take a fresh screenshot afterwards to verify.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal position 0–1000 (0 = left edge, 1000 = right edge)' },
        y: { type: 'number', description: 'Vertical position 0–1000 (0 = top, 1000 = bottom)' },
      },
      required: ['x', 'y'],
    },
    schema: xySchema,
    kind: 'write',
    mutating: true,
    summarize: (a) => `click at (${a.x}, ${a.y})`,
    async execute(args) {
      try {
        const { px, py } = await manager.clickXY(args.x, args.y);
        return ok(`Clicked at (${args.x}, ${args.y}) → pixel (${px}, ${py}). Take a browser_screenshot to see the result.`, {
          kind: 'info',
          title: 'Browser',
        });
      } catch (e) {
        return browserErr(e);
      }
    },
  };

  const close: ToolDefinition<EmptyArgs> = {
    name: 'browser_close',
    description: 'Close the agent browser window (the saved profile/logins persist).',
    parameters: { type: 'object', properties: {} },
    schema: emptySchema,
    kind: 'read',
    mutating: false,
    summarize: () => 'close browser',
    async execute() {
      await manager.close();
      return ok('Browser closed.', { kind: 'info', title: 'Browser' });
    },
  };

  return [open, navigate, snapshot, click, clickXY, fill, press, scroll, back, screenshot, close];
}
