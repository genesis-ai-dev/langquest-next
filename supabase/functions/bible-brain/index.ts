import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const cache = new Map<string, { expires: number; value: unknown }>();
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(object) : [];

async function upstream(path: string, params: Record<string, string> = {}) {
  const id = `${path}?${new URLSearchParams(params)}`;
  const previous = cache.get(id);
  if (previous && previous.expires > Date.now()) return previous.value;
  const key = Deno.env.get('BIBLE_BRAIN_ACCESS_KEY');
  if (!key) throw new Error('Bible Brain is not configured. BSB audio remains available.');
  const url = new URL(`https://4.dbt.io/api${path}`);
  url.search = new URLSearchParams({ v: '4', key, ...params }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Bible Brain rejected the server credential. BSB audio remains available.');
  }
  if (!response.ok) throw new Error(`Bible Brain is unavailable (${response.status}).`);
  const body = await response.json();
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const value = object(body).data ?? body;
  cache.set(id, { expires: Date.now() + 300000, value });
  return value;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false }
    });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return reply({ error: 'Sign in required' }, 401);
  let body: Record<string, unknown>;
  try { body = object(await request.json()); }
  catch { return reply({ error: 'Invalid JSON' }, 400); }
  try {
    if (body.action === 'catalog') {
      if (typeof body.language !== 'string' || !/^[a-z]{3}$/.test(body.language)) {
        return reply({ error: 'Use a three-letter ISO language code.' }, 400);
      }
      const page = Number(body.page ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > 100) return reply({ error: 'Invalid page' }, 400);
      const bibles = list(await upstream('/bibles', {
        language_code: body.language, limit: '50', page: String(page)
      }));
      const filesets = bibles.flatMap(b =>
        list(object(b.filesets)['dbp-prod']).filter(f => f.type === 'audio' || f.type === 'audio_drama')
          .map(f => ({ id: f.id, bibleId: b.abbr, name: b.name,
            type: f.type, size: f.size })));
      return reply({ filesets, more: bibles.length === 50 });
    }
    if (body.action === 'chapter') {
      const fileset = body.filesetId, book = body.book;
      const chapter = Number(body.chapter);
      if (typeof fileset !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(fileset) ||
        typeof book !== 'string' || !/^[A-Z0-9]{3}$/.test(book) ||
        !Number.isInteger(chapter) || chapter < 1 || chapter > 150) {
        return reply({ error: 'Invalid audio chapter' }, 400);
      }
      const path = `${fileset}/${book}/${chapter}`;
      const [audio, timestamps, copyright] = await Promise.all([
        upstream(`/bibles/filesets/${path}`),
        upstream(`/timestamps/${path}`).catch(() => []),
        upstream(`/bibles/filesets/${fileset}/copyright`)
      ]);
      const item = list(audio).find(a => typeof a.path === 'string' && a.path.startsWith('https://'));
      if (!item) return reply({ error: 'This fileset has no audio for this chapter.' }, 404);
      const timings = list(timestamps).filter(t =>
        t.timestamp !== null && t.timestamp !== undefined && t.timestamp !== '')
        .map(t => ({
        verse: Number(t.verse_start), start: Number(t.timestamp)
      })).filter(t => Number.isInteger(t.verse) && t.verse > 0 && Number.isFinite(t.start) && t.start >= 0);
      const nestedCopyright = object(copyright).copyright;
      const noticeSource = typeof nestedCopyright === 'object' ? nestedCopyright : copyright;
      const notices = (Array.isArray(noticeSource) ? list(noticeSource) : [object(noticeSource)])
        .flatMap(c => [c.copyright, c.copyright_text, c.copyright_date, c.organization,
          ...list(c.organizations).map(o => object(list(o.translations)[0]).name ?? o.slug)])
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      return reply({ uri: item.path, duration: Number(item.duration) || 0,
        timings, copyright: notices.join(' · ') });
    }
    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    // Never return upstream URLs or request objects: the URL contains a secret.
    const message = e instanceof Error && e.message.startsWith('Bible Brain')
      ? e.message : 'Bible Brain could not load. BSB audio remains available.';
    return reply({ error: message }, 503);
  }
});
