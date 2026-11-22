import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { LOADING_SCRIPT } from '../src/pageLoading';
import { OVERVIEW_SCRIPT } from '../src/pageOverview';
import { SUMMARY_SCRIPT } from '../src/pageSummary';
import { DIAG_CONNECTIONS } from '../src/db';

/** The page's script between two markers. */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// The helpers alone, without the page: document is only used by the click handlers.
const helpers = new Function('esc', 'document', LOADING_SCRIPT + '; return { skel, failed, retryPart, readOf };')(esc, { addEventListener() {} }) as {
  skel: (kind: string, n?: number) => string;
  failed: (words: string, attrs: string) => string;
  retryPart: (part: string) => string;
  readOf: (part: string) => string;
};

describe('the first load shows each box loading, never an empty page', async () => {
  const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();

  it('shows the page before the sign-in check answers, and reads at the same time', () => {
    const start = between(html, 'async function start() {', '\n}');
    expect(start.indexOf("$('board').hidden = false")).toBeGreaterThanOrEqual(0);
    expect(start.indexOf("$('board').hidden = false")).toBeLessThan(start.indexOf("api('/ops/api/me')"));
    expect(start).not.toMatch(/await api\('\/ops\/api\/me'\)/);
    expect(start).toMatch(/Promise\.all\(\[me, load\(false\)\]\)/);
  });

  it('draws a shimmering shape that screen readers hear as loading', () => {
    for (const kind of ['lines', 'cards', 'chart']) {
      const s = helpers.skel(kind);
      expect(s).toContain('role="status"');
      expect(s).toContain('aria-busy="true"');
      expect(s).toContain('class="sk');
      // The page's CSP allows no style attribute.
      expect(s).not.toContain('style=');
    }
    expect(helpers.skel('tiles', 3).match(/class="stile skt"/g)).toHaveLength(3);
    expect(html).toContain('@keyframes sk-shine');
    expect(html).toMatch(/prefers-reduced-motion: reduce\) \{ \.sk,/);
  });

  it('puts a shape, not grey words, where a part, a summary or the Overview waits', () => {
    expect(between(html, 'function partHtml(g, id) {', '\n}')).toMatch(/if \(!s\) return head \+ skel\('lines'\)/);
    expect(SUMMARY_SCRIPT).toContain("skel('cards')");
    expect(SUMMARY_SCRIPT).not.toContain("'<p class=\"sempty\">Loading…</p>'");
    expect(OVERVIEW_SCRIPT).toContain("skel('chart')");
    expect(OVERVIEW_SCRIPT).not.toContain('Loading the charts…');
  });

  it('offers Try again on a part that failed, and reads it with the parts read together', () => {
    const f = helpers.failed('Could not read: <x>.', helpers.retryPart('userissues'));
    expect(f).toContain('Could not read: &#60;x&#62;.');
    expect(f).toContain('data-retry="userissues"');
    expect(f).toContain('>Try again</button>');
    expect(helpers.readOf('userissues')).toBe('ops');
    expect(helpers.readOf('feedback')).toBe('diag');
    expect(helpers.readOf('code')).toBe('code');
  });

  it('runs one answer\'s statements on a few connections, not one after another', () => {
    expect(DIAG_CONNECTIONS).toBeGreaterThan(1);
    expect(DIAG_CONNECTIONS).toBeLessThanOrEqual(10);
  });
});
