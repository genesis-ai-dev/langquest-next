// A source's audio kept in a browser comes through the Worker (decisions.md
// 201). The page may read only its own site and Supabase (the content
// security policy, scripts/webHeaders.mjs), and the hosts sources use allow
// no other site's reads, so a browser asking them itself always failed.
// Phones download from the source's own link, as before.
import { reportsServer } from '../reports/reportsServer';

/** Where the Worker serves a library source's audio link (apps/web/worker/sourceAudio.ts). */
export const libraryAudioPath = (url: string): string => `/api/source-audio?url=${encodeURIComponent(url)}`;

/** Where the Worker serves a Bible Brain chapter's file, for a fileset FCBH lets us download (apps/web/worker/bible.ts). */
export const bibleFilePath = (fileset: string, book: string, chapter: number): string =>
  `/api/bible/file/${encodeURIComponent(fileset)}/${book}/${chapter}`;

/** Fetch one of those as the person signed in. A refusal is an error, as any download's is. */
export async function fetchThroughWorker(path: string): Promise<Response> {
  const token = await reportsServer?.token();
  if (!reportsServer || !token) throw new Error('Not signed in.');
  const res = await (reportsServer.fetch ?? fetch)(`${reportsServer.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res;
}
