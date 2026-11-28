import { describe, expect, it } from 'vitest';
import { handleRoadmap, parseSend, pictureBytes, type RoadmapDeps, type RoadmapSend } from '../worker/roadmap';
import { roadmapItems, roadmapPage, type RoadmapItem } from '../worker/roadmapPage';

/** The public roadmap (worker/roadmap.ts, docs/roadmap.md): the page, its pictures, and what anyone may send. */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const item = (id: string, state: RoadmapItem['state'], title: string, picture: number | null = null): RoadmapItem =>
  ({ id, state, title, body: 'Body of ' + title, picture, doneAt: state === 'done' ? '2026-11-20T10:00:00Z' : null });

function deps(over: Partial<RoadmapDeps> = {}): RoadmapDeps & { sent: RoadmapSend[] } {
  const sent: RoadmapSend[] = [];
  return {
    sent,
    list: async () => [item(A, 'progress', 'Clean <noise>', 7), item(B, 'done', 'Undo')],
    picture: async (id) => (id === A ? 'data:image/webp;base64,UklGRg==' : null),
    send: async (row) => { sent.push(row); return row.item === B ? 'not_found' : 'ok'; },
    allowed: async () => true,
    language: () => 'en',
    ...over
  };
}
const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('https://x/roadmap/send', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('the public roadmap', () => {
  it('shows the three parts and the Done tab, escaped, with nobody named and no issue', async () => {
    const r = roadmapPage('en', [item(A, 'progress', 'Clean <noise>', 7), item(B, 'considering', 'Map'), item('33333333-3333-4333-8333-333333333333', 'done', 'Undo')]);
    expect(r.headers.get('content-security-policy')).toContain("img-src 'self'");
    expect(r.headers.get('vary')).toBe('accept-language');
    const html = await r.text();
    expect([...html.matchAll(/<h2 class="part">.*?<\/svg>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(['In progress', 'Planned', 'Under consideration']);
    expect(html).toContain('Clean &lt;noise&gt;');
    expect(html).not.toContain('<noise>');
    expect(html).toContain(`src="/roadmap/p/${A}?v=7"`);
    expect(html).toContain('<time>Nov 20, 2026</time>');
    expect(html).toContain('href="/privacy#roadmap"');
    // A part with no item says so; a page the database did not answer says that.
    expect(html).toContain('Nothing here yet.');
    expect(await roadmapPage('en', null).text()).toContain('The roadmap did not load.');
  });

  it('keeps only items the database described whole', () => {
    const good = item(A, 'planned', 'Map');
    expect(roadmapItems([good, { ...good, id: 'x' }, { ...good, state: 'hidden' }, { ...good, title: '' }, { ...good, picture: 'big' }, null])).toEqual([good]);
    expect(roadmapItems({ not: 'a list' })).toEqual([]);
  });

  it('checks what a reader sends: a vote needs an item, a suggestion needs words, an email must look like one', () => {
    expect(parseSend({ item: A, importance: 3, words: ' We need it. ', email: ' a@b.org ', language: 'fr' }))
      .toEqual({ item: A, importance: 3, words: 'We need it.', email: 'a@b.org', language: 'fr' });
    expect(parseSend({ item: A, importance: 0, language: 'en' })).toEqual({ item: A, importance: 0, words: null, email: null, language: 'en' });
    expect(parseSend({ item: null, importance: 2, words: 'Dark pages', language: 'en' })).toMatchObject({ item: null, words: 'Dark pages' });
    for (const bad of [{ item: null, importance: 2, language: 'en' }, { item: 'x', importance: 2, language: 'en' }, { item: A, importance: 4, language: 'en' },
      { item: A, importance: 1.5, language: 'en' }, { item: A, importance: 2, language: 'de' }, { item: A, importance: 2, email: 'not an email', language: 'en' },
      { item: A, importance: 2, words: 'x'.repeat(2001), language: 'en' }, 'text']) {
      expect(parseSend(bad)).toBeNull();
    }
    expect(parseSend({ item: A, importance: 2, language: 'en', website: 'http://spam' })).toBe('trap');
  });

  it('keeps a send, and answers a full day, a hidden item, a flood and a script without keeping anything more', async () => {
    const d = deps();
    expect((await handleRoadmap(post({ item: A, importance: 2, words: 'Yes', email: '', language: 'es' }), d))!.status).toBe(204);
    expect(d.sent).toEqual([{ item: A, importance: 2, words: 'Yes', email: null, language: 'es' }]);
    expect((await handleRoadmap(post({ item: B, importance: 2, language: 'es' }), d))!.status).toBe(404);
    expect((await handleRoadmap(post({ item: A, importance: 2, language: 'es', website: 'x' }), d))!.status).toBe(204);
    expect(d.sent).toHaveLength(2);
    expect((await handleRoadmap(post({ item: A, importance: 2, language: 'es' }), deps({ allowed: async () => false })))!.status).toBe(429);
    expect((await handleRoadmap(post({ item: A, importance: 2, language: 'es' }), deps({ send: async () => 'full' })))!.status).toBe(429);
    expect((await handleRoadmap(post({ item: A, importance: 2, language: 'es' }), deps({ send: async () => { throw new Error('down'); } })))!.status).toBe(503);
    expect((await handleRoadmap(post('{'), d))!.status).toBe(400);
    expect((await handleRoadmap(post({ item: A }, { 'content-type': 'text/plain' }), d))!.status).toBe(415);
    expect((await handleRoadmap(post(JSON.stringify({ words: 'x'.repeat(13_000) })), d))!.status).toBe(413);
    expect((await handleRoadmap(new Request('https://x/roadmap/send'), d))!.status).toBe(405);
  });

  it('serves a picture by its version for a year, and nothing for an item without one', async () => {
    const d = deps();
    const r = (await handleRoadmap(new Request(`https://x/roadmap/p/${A}?v=7`), d))!;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/webp');
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0x52, 0x49, 0x46, 0x46]);
    expect((await handleRoadmap(new Request(`https://x/roadmap/p/${B}`), d))!.status).toBe(404);
    expect((await handleRoadmap(new Request('https://x/roadmap/p/not-a-picture'), d))!.status).toBe(404);
    expect(pictureBytes('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
  });

  it('answers the page, a page the database could not give, and leaves other paths to the rest of the Worker', async () => {
    expect((await handleRoadmap(new Request('https://x/roadmap'), deps()))!.status).toBe(200);
    const failed = await handleRoadmap(new Request('https://x/roadmap'), deps({ list: async () => { throw new Error('down'); } }));
    expect(await failed!.text()).toContain('The roadmap did not load.');
    expect((await handleRoadmap(new Request('https://x/roadmap/other'), deps()))!.status).toBe(404);
    expect(await handleRoadmap(new Request('https://x/videos'), deps())).toBeNull();
  });
});
