import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { userDataDir } from '../utils/paths.js';

export interface SnapshotElement {
  ref: string;
  tag: string;
  role: string;
  name: string;
  type?: string;
  href?: string;
  value?: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  /** Plain-text excerpt of the visible page content. */
  textExcerpt: string;
  truncated: boolean;
}

const MAX_ELEMENTS = 200;
const TEXT_EXCERPT_CHARS = 4000;
const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 15_000;

/**
 * Injected into the page: tags every visible interactive element with a
 * stable `data-oxref` attribute and returns a compact description of each.
 */
const TAG_SCRIPT = `(() => {
  const sel = 'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [contenteditable="true"], [onclick]';
  const els = Array.from(document.querySelectorAll(sel));
  const out = [];
  let n = 0;
  for (const el of els) {
    if (n >= ${MAX_ELEMENTS}) break;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
    n++;
    const ref = 'e' + n;
    el.setAttribute('data-oxref', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'img' ? 'img' : tag);
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('value') || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
    const item = { ref, tag, role, name };
    if (tag === 'input' || tag === 'textarea') item.type = el.getAttribute('type') || 'text';
    if (tag === 'input' && el.value) item.value = String(el.value).slice(0, 80);
    if (tag === 'a' && el.href) item.href = el.href.slice(0, 160);
    out.push(item);
  }
  return { elements: out, total: els.length, text: (document.body ? document.body.innerText : '').replace(/\\s+\\n/g, '\\n').slice(0, ${TEXT_EXCERPT_CHARS}) };
})()`;

function profileDir(): string {
  return path.join(userDataDir(), 'browser-profile');
}

/**
 * Owns a single persistent, headed browser instance (real window the user
 * can watch and intervene in). Cookies/logins persist across runs in
 * ~/.ox/browser-profile. Lazily launched on first use.
 */
export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private launching: Promise<Page> | null = null;
  /** ref → human name from the last snapshot (for approval summaries). */
  readonly lastRefs = new Map<string, string>();

  private async launch(): Promise<Page> {
    const pw = await import('playwright-core');
    fs.mkdirSync(profileDir(), { recursive: true });
    const opts = {
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    };
    // Prefer an already-installed browser (Edge ships with Windows).
    let lastErr: unknown;
    for (const channel of ['msedge', 'chrome'] as const) {
      try {
        this.context = await pw.chromium.launchPersistentContext(profileDir(), { ...opts, channel });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!this.context) {
      try {
        this.context = await pw.chromium.launchPersistentContext(profileDir(), { ...opts });
      } catch (e) {
        throw new Error(
          'No browser available. Install Edge/Chrome, or run: npx playwright install chromium\n' +
            `(${(lastErr as Error)?.message ?? e})`,
        );
      }
    }
    this.context.on('page', (p) => {
      p.on('dialog', (d) => void d.dismiss().catch(() => {}));
      this.page = p;
    });
    const pages = this.context.pages();
    this.page = pages[0] ?? (await this.context.newPage());
    this.page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    return this.page;
  }

  /** Current page, launching the browser on first call. */
  async ensure(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.context) {
      this.page = await this.context.newPage();
      this.page.on('dialog', (d) => void d.dismiss().catch(() => {}));
      return this.page;
    }
    this.launching ??= this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const page = await this.ensure();
    const normalized = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    return { url: page.url(), title: await page.title() };
  }

  async snapshot(): Promise<BrowserSnapshot> {
    const page = await this.ensure();
    const raw = (await page.evaluate(TAG_SCRIPT)) as {
      elements: SnapshotElement[];
      total: number;
      text: string;
    };
    this.lastRefs.clear();
    for (const el of raw.elements) this.lastRefs.set(el.ref, el.name || `${el.tag}`);
    return {
      url: page.url(),
      title: await page.title(),
      elements: raw.elements,
      textExcerpt: raw.text,
      truncated: raw.total > raw.elements.length,
    };
  }

  private async locatorFor(ref: string) {
    const page = await this.ensure();
    const loc = page.locator(`[data-oxref="${ref}"]`);
    if ((await loc.count()) === 0) {
      throw new Error(`Element ${ref} not found — the page changed. Take a fresh browser_snapshot.`);
    }
    return { page, loc: loc.first() };
  }

  async click(ref: string): Promise<void> {
    const { loc } = await this.locatorFor(ref);
    await loc.click({ timeout: ACTION_TIMEOUT_MS });
  }

  async fill(ref: string, text: string, submit: boolean): Promise<void> {
    const { loc } = await this.locatorFor(ref);
    await loc.fill(text, { timeout: ACTION_TIMEOUT_MS });
    if (submit) await loc.press('Enter');
  }

  async press(key: string): Promise<void> {
    const page = await this.ensure();
    await page.keyboard.press(key);
  }

  async scroll(direction: 'up' | 'down', amount: number): Promise<void> {
    const page = await this.ensure();
    await page.mouse.wheel(0, direction === 'down' ? amount : -amount);
  }

  async back(): Promise<void> {
    const page = await this.ensure();
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  }

  /** Real viewport size in pixels (window size when viewport is null). */
  async viewportSize(): Promise<{ width: number; height: number }> {
    const page = await this.ensure();
    const size = page.viewportSize();
    if (size) return size;
    return page.evaluate(() => {
      const w = globalThis as unknown as { innerWidth: number; innerHeight: number };
      return { width: w.innerWidth, height: w.innerHeight };
    });
  }

  /**
   * Screenshot the viewport as JPEG. Returns base64 data (quality-reduced if
   * too large) plus the file path it was saved to.
   */
  async screenshot(cwd: string): Promise<{ file: string; data: string; mimeType: string; width: number; height: number }> {
    const page = await this.ensure();
    const { width, height } = await this.viewportSize();
    let buf = await page.screenshot({ type: 'jpeg', quality: 65 });
    // Keep the data URL comfortably under provider limits.
    if (buf.length > 900_000) buf = await page.screenshot({ type: 'jpeg', quality: 40 });
    const dir = path.join(cwd, '.ox', 'browser');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `shot-${Date.now()}.jpg`);
    fs.writeFileSync(file, buf);
    return { file, data: buf.toString('base64'), mimeType: 'image/jpeg', width, height };
  }

  /** Click using normalized coordinates (0–1000 on both axes), as seen on the last screenshot. */
  async clickXY(x: number, y: number): Promise<{ px: number; py: number }> {
    const page = await this.ensure();
    const { width, height } = await this.viewportSize();
    const px = Math.round((x / 1000) * width);
    const py = Math.round((y / 1000) * height);
    await page.mouse.click(px, py);
    return { px, py };
  }

  async status(): Promise<{ open: boolean; url?: string; title?: string }> {
    if (!this.page || this.page.isClosed()) return { open: false };
    return { open: true, url: this.page.url(), title: await this.page.title() };
  }

  async close(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    this.lastRefs.clear();
    if (ctx) await ctx.close().catch(() => {});
  }
}
