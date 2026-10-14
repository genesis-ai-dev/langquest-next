// Measuring helpers for 17-accessibility.spec.ts (docs/ui-test-suite/17):
// the pressables and the text on the screen showing, read from the DOM the
// web export renders, so sizes are CSS px (1 CSS px = 1 pt at phone width).
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';

export interface Target {
  name: string; role: string; testId: string | null; w: number; h: number; x: number; y: number;
  /** Which scroll area holds it (-1: none). Targets in different ones can slide past each other. */
  scroller: number;
}
export interface SmallText { text: string; size: number }

/**
 * Every pressable that shows on the screen now: role button, tab, link,
 * switch, checkbox, radio, slider, or anything else keyboard-focusable that
 * is not a text field. Hidden screens of the stack (display none, opacity 0,
 * aria-hidden, or covered by a sheet) are left out.
 */
export async function pressables(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const sel = '[role=button],[role=tab],[role=link],[role=switch],[role=checkbox],[role=radio],[role=slider],[role=menuitem],a[href],button,[tabindex="0"]';
    const shown = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        if (e.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    };
    // A modal sheet covers the screen under it: then only what is inside the top modal counts.
    const modals = [...document.querySelectorAll('[aria-modal="true"],[role=dialog]')].filter(shown);
    const top = modals.length ? modals[modals.length - 1]! : null;
    const out: { name: string; role: string; testId: string | null; w: number; h: number; x: number; y: number; scroller: number }[] = [];
    const scrollers: Element[] = [];
    const scrollerOf = (el: Element): number => {
      for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll') {
          if (!scrollers.includes(e)) scrollers.push(e);
          return scrollers.indexOf(e);
        }
      }
      return -1;
    };
    const seen = new Set<Element>();
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.matches('input,textarea,select,[contenteditable=true]')) continue;
      if (el.getAttribute('aria-disabled') === 'true' && el.getAttribute('role') === null) continue;
      if (top && !top.contains(el)) continue;
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Off to the side (a horizontally scrolled-away pane) is not on this screen.
      if (r.right <= 0 || r.left >= innerWidth) continue;
      // Behind something else (the stack's previous screen under the current card).
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const cy = r.top + r.height / 2;
      if (cy > 0 && cy < innerHeight) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el.contains(hit) && !hit.contains(el)) {
          // Something else is on top: an overlay, the next screen, or a fixed header or footer.
          // Keep it only when a scroll area holds it (it can be scrolled out from under the footer).
          let scrolls = false;
          for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight) { scrolls = true; break; }
          }
          if (!scrolls) continue;
        }
      }
      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      out.push({ name, role: el.getAttribute('role') ?? el.tagName.toLowerCase(), testId: el.getAttribute('data-testid'), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.left), y: Math.round(r.top), scroller: scrollerOf(el) });
    }
    return out;
  });
}

/** Text on the screen showing smaller than `min` CSS px. */
export async function smallText(page: Page, min = 13): Promise<SmallText[]> {
  return page.evaluate((min) => {
    const shown = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        if (e.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    };
    const modals = [...document.querySelectorAll('[aria-modal="true"],[role=dialog]')].filter(shown);
    const top = modals.length ? modals[modals.length - 1]! : null;
    const out = new Map<string, number>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const value = (n.textContent ?? '').trim();
      if (!value) continue;
      const el = n.parentElement;
      if (!el || el.closest('script,style,noscript')) continue;
      if (top && !top.contains(el)) continue;
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= innerWidth) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size + 0.01 < min) out.set(value.slice(0, 60), size);
    }
    return [...out].map(([text, size]) => ({ text, size }));
  }, min);
}

export interface AxeFinding { rule: string; impact: string; count: number; sample: string }

/** Serious and critical axe findings (WCAG 2 A and AA), as the web smoke test reads them. */
export async function axeSerious(page: Page): Promise<AxeFinding[]> {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({
    rule: v.id, impact: v.impact ?? '', count: v.nodes.length,
    sample: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.html.slice(0, 90)}`).join(' | ')
  }));
}

/** The element with keyboard focus: its name, and whether a focus ring shows on it. */
export async function focused(page: Page): Promise<{ name: string; role: string; ring: boolean; testId: string | null } | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== 'none' && s.boxShadow !== '';
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { name, role: el.getAttribute('role') ?? el.tagName.toLowerCase(), ring: outline || shadow, testId: el.getAttribute('data-testid') };
  });
}

/**
 * Keep Metro's hot reloading out of this browser. Other people edit the app
 * while the suite runs against the shared dev server; a hot update remounts
 * the app mid-test (it jumps to My Work, or says it is open in another tab).
 * The socket is answered here and never hears from Metro.
 */
export async function noHotReload(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/\/hot(\?|$)/, () => { /* no updates */ });
}
