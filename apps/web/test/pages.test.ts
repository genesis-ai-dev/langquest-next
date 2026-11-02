import { connectPage } from '../worker/agent/connectPage';
import { reviewPage } from '../worker/agent/reviewPage';
import { PAGE_CATALOGS, pageLanguage } from '../worker/i18n/pages';
import { pageVideos, videosPage, type PageVideo } from '../worker/videosPage';
import { UI_LANGUAGES } from '../../mobile/src/i18n/languages';

/** The shared review link page in the reader's language (LAN-42, worker/i18n/pages.ts). */

type Tree = { [k: string]: string | Tree };
const keys = (o: Tree, prefix = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`))).sort();
const marked = (o: Tree): Tree => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/[^{}\s]+(?![^{]*\}\})/g, 'ж') : marked(v)]));

/** Runs a page's inline script once, against stand-ins for the browser, and throws what it throws at load. */
function runPageScript(script: string, given: Record<string, unknown> = {}) {
  const element = (): Record<string, unknown> => new Proxy({ addEventListener() {}, value: '', checked: false, hidden: false, innerHTML: '', textContent: '' }, {
    get: (t, k) => (k in t ? t[k as keyof typeof t] : element()),
    set: () => true
  });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const browser = {
    document: { getElementById: element, querySelectorAll: () => [], documentElement: { lang: 'en' } },
    location: { href: 'https://x/connect', search: '', origin: 'https://x', replace() {} },
    localStorage: storage, sessionStorage: storage,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: () => new Promise(() => {}),
    window: { scrollTo() {} },
    ...given
  };
  new Function(...Object.keys(browser), script)(...Object.values(browser));
}

describe('pages the Worker serves, in the reader’s language', () => {
  it('follows ?lang=, then the browser’s approved languages, then English', () => {
    const req = (url: string, accept = '') => new Request(url, { headers: { 'accept-language': accept } });
    expect(pageLanguage(req('https://x/r/abc?lang=ar'))).toBe('ar');
    expect(pageLanguage(req('https://x/r/abc?lang=xx'))).toBe('en');
    expect(pageLanguage(req('https://x/r/abc', 'es-MX,es;q=0.9'))).toBe('es');
    expect(pageLanguage(req('https://x/r/abc', 'de-DE,de;q=0.9'))).toBe('en');
  });

  it('lays Arabic out right to left and offers every language by its own name', async () => {
    const html = await reviewPage('a'.repeat(22), 'ar').text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    for (const l of UI_LANGUAGES) expect(html).toContain(`<option value="${l.code}"`);
  });

  // A video's title and playlist come from the database, in the video's language.
  const video = (tutorial: string, youtube: boolean): PageVideo => ({ tutorial, sha256: 'a'.repeat(64), title: 'ж', playlist: 'ж', seconds: 93, bytes: 12_900_000, youtube });
  const pages = {
    review: (lang: 'my' | 'es') => reviewPage('a'.repeat(22), lang),
    connect: (lang: 'my' | 'es') => connectPage({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, lang),
    videos: (lang: 'my' | 'es') => videosPage(lang, [video('record-a-passage', true), video('do-a-check', false)]),
    'empty videos': (lang: 'my' | 'es') => videosPage(lang, []),
    'failed videos': (lang: 'my' | 'es') => videosPage(lang, null)
  };

  for (const [name, page] of Object.entries(pages)) {
    it(`writes no English words of its own into the ${name} page, and its script runs`, async () => {
      const saved = PAGE_CATALOGS.my;
      PAGE_CATALOGS.my = marked(PAGE_CATALOGS.en as unknown as Tree) as typeof saved;
      try {
        const html = await page('my').text();
        const [, body = ''] = /<body>([\s\S]*)<\/body>/.exec(html) ?? [];
        const markup = body.replace(/<script>[\s\S]*<\/script>/, '');
        const script = /<script>([\s\S]*)<\/script>/.exec(body)?.[1] ?? '';
        // Parsing is not enough: a name used before its `const` (LAN-42's
        // language picker) parses and then stops the whole page at load.
        expect(() => runPageScript(script)).not.toThrow();
        // Text between tags, and the words in attributes people see or hear.
        const shown = [...markup.matchAll(/>([^<]+)</g)].map((m) => m[1]!.trim()).filter(Boolean)
          .concat([...markup.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((m) => m[1]!));
        const names = new Set(UI_LANGUAGES.map((l) => l.name));
        // A code's shape (BCDF-GHJK) has no lower-case letters and is not a word.
        expect(shown.filter((t) => /[a-z]{2,}/.test(t) && !names.has(t))).toEqual([]);
        // Strings in the page's script that read like prose (the words themselves ride in as JSON).
        const literals = [...script.replace(/^const (W|CFG) = .*$/m, '').matchAll(/'([^'\n]*)'/g)].map((m) => m[1]!);
        // Markup built in the script is not prose: what is left after its tags and attributes is.
        // 'Bearer ' is the HTTP scheme, not a word anyone reads.
        const words = (t: string) => t.replace(/<\/?[\w-]+|\/?>|[\w-]+="[^"]*"?|"|^-[\w-]+\b|\b(checked|hidden|selected)\b/g, ' ').trim();
        expect(literals.filter((t) => t !== 'Bearer ' && /[A-Za-z]{2,}\s+[A-Za-z]{2,}|^[A-Z][a-z]+[.!]?$/.test(words(t)))).toEqual([]);
      } finally {
        PAGE_CATALOGS.my = saved;
      }
    });
  }

  it('lists the videos by who they are for, each to play, download, and watch on YouTube once it is up (decisions.md 187)', async () => {
    const v = (tutorial: string, playlist: string, youtube: boolean, sha = 'a'): PageVideo =>
      ({ tutorial, sha256: sha.repeat(64), title: `<${tutorial}>`, playlist, seconds: 93, bytes: 12_900_000, youtube });
    const r = videosPage('es', [v('record-a-passage', 'Traductores', true), v('do-a-check', 'Revisores', false, 'b'), v('hear-parts', 'Traductores', false, 'c')]);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('vary')).toBe('accept-language');
    const html = await r.text();
    expect([...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(['Traductores', 'Revisores']);
    expect(html).toContain('&lt;record-a-passage&gt;');
    expect(html).not.toContain('<record-a-passage>');
    expect(html).toContain(`href="/api/tutorials/es/record-a-passage/${'a'.repeat(64)}.mp4"`);
    expect(html).toContain(`href="/api/tutorials/es/record-a-passage/${'a'.repeat(64)}.mp4?download" download`);
    expect(html).toContain('href="/v/es/record-a-passage"');
    expect(html).not.toContain('href="/v/es/do-a-check"');
    expect(html).toContain('12,3 MB');
    expect(html).toContain('1:33');
  });

  it('keeps only videos the database described whole', () => {
    const good = { tutorial: 'record-a-passage', sha256: 'a'.repeat(64), title: 'Grabar', playlist: 'Traductores', seconds: 93, bytes: 1, youtube: true };
    expect(pageVideos([good, { ...good, tutorial: '../x' }, { ...good, sha256: 'z' }, { ...good, seconds: null }, null])).toEqual([good]);
    expect(pageVideos({ not: 'a list' })).toEqual([]);
  });

  it('uses the session signed in on /connect even when the web app left an expired one', async () => {
    // The web app's session in localStorage goes stale whenever the
    // web app is closed. Signing in on /connect must not be undone by it.
    const html = await connectPage({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'en').text();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    const now = Math.floor(Date.now() / 1000);
    const stored = (value: unknown) => ({ getItem: () => JSON.stringify(value), setItem() {}, removeItem() {} });
    const sent: string[] = [];
    runPageScript(script, {
      localStorage: stored({ access_token: 'stale', expires_at: now - 60 }),
      sessionStorage: stored({ access_token: 'fresh', expires_at: now + 3600 }),
      fetch: (_url: string, init: { headers: Record<string, string> }) => {
        sent.push(init.headers.authorization!);
        return new Promise(() => {});
      }
    });
    expect(sent).toEqual(['Bearer fresh']);
  });

  it('has the same words in every language as in English', () => {
    const want = keys(PAGE_CATALOGS.en as unknown as Tree);
    for (const l of UI_LANGUAGES) expect(keys(PAGE_CATALOGS[l.code] as unknown as Tree), l.code).toEqual(want);
  });
});

