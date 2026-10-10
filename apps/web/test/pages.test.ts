import { reviewPage } from '../worker/agent/reviewPage';
import { PAGE_CATALOGS, pageLanguage } from '../worker/i18n/pages';
import { UI_LANGUAGES } from '../../mobile/src/i18n/languages';

/** The shared review link page in the reader's language (LAN-42, worker/i18n/pages.ts). */

type Tree = { [k: string]: string | Tree };
const keys = (o: Tree, prefix = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`))).sort();
const marked = (o: Tree): Tree => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/[^{}\s]+(?![^{]*\}\})/g, 'ж') : marked(v)]));

describe('pages the Worker serves, in the reader’s language', () => {
  it('follows ?lang=, then the browser’s reviewed languages, then English', () => {
    const req = (url: string, accept = '') => new Request(url, { headers: { 'accept-language': accept } });
    expect(pageLanguage(req('https://x/r/abc?lang=ar'))).toBe('ar');
    expect(pageLanguage(req('https://x/r/abc?lang=xx'))).toBe('en');
    const es = UI_LANGUAGES.find((l) => l.code === 'es')!;
    expect(pageLanguage(req('https://x/r/abc', 'es-MX,es;q=0.9'))).toBe(es.reviewed ? 'es' : 'en');
  });

  it('lays Arabic out right to left and offers every language by its own name', async () => {
    const html = await reviewPage('a'.repeat(22), 'ar').text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    for (const l of UI_LANGUAGES) expect(html).toContain(`<option value="${l.code}"`);
  });

  it('writes no English words of its own into the page', async () => {
    const saved = PAGE_CATALOGS.my;
    PAGE_CATALOGS.my = marked(PAGE_CATALOGS.en as unknown as Tree) as typeof saved;
    try {
      const html = await reviewPage('a'.repeat(22), 'my').text();
      const [, body = ''] = /<body>([\s\S]*)<\/body>/.exec(html) ?? [];
      const markup = body.replace(/<script>[\s\S]*<\/script>/, '');
      const script = /<script>([\s\S]*)<\/script>/.exec(body)?.[1] ?? '';
      // Text between tags, and the words in attributes people see or hear.
      const shown = [...markup.matchAll(/>([^<]+)</g)].map((m) => m[1]!.trim()).filter(Boolean)
        .concat([...markup.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((m) => m[1]!));
      const names = new Set(UI_LANGUAGES.map((l) => l.name));
      expect(shown.filter((t) => /[A-Za-z]{2,}/.test(t) && !names.has(t))).toEqual([]);
      // Strings in the page's script that read like prose.
      const literals = [...script.replace(/const W = .*\n/, '').matchAll(/'([^'\n]*)'/g)].map((m) => m[1]!);
      expect(literals.filter((t) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}|^[A-Z][a-z]+[.!]?$/.test(t))).toEqual([]);
    } finally {
      PAGE_CATALOGS.my = saved;
    }
  });

  it('has the same words in every language as in English', () => {
    const want = keys(PAGE_CATALOGS.en as unknown as Tree);
    for (const l of UI_LANGUAGES) expect(keys(PAGE_CATALOGS[l.code] as unknown as Tree), l.code).toEqual(want);
  });
});

