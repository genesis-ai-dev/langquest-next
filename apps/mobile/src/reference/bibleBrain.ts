// Bible Brain through the Worker (docs/reference-material.md, "The Worker's
// Bible routes"): the key stays on the server; a phone asks with the
// person's Supabase token, the way the reports are fetched
// (packages/client/src/reports.ts, src/useOrgSummary.ts).
import { reportsServer } from '../useOrgSummary';

export type Testaments = { OT?: string; NT?: string };

export interface BibleSummary {
  bibleId: string;
  name: string;
  abbreviation: string;
  language: string;
  languageName: string;
  text: Testaments;
  audio: Testaments;
  timestamps: { OT: boolean; NT: boolean };
}

export interface BibleDetail extends BibleSummary {
  books: { book: string; name: string; chapters: number; testament: 'OT' | 'NT' }[];
  copyright: { text?: string; audio?: string };
  offline: { text: boolean; audio: boolean };
}

export interface BibleLanguage {
  code: string;
  name: string;
  autonym?: string;
  bibles: number;
}

/** The Worker could not answer; `offline` when it was not reached at all. */
export class BibleError extends Error {
  override name = 'BibleError';
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

/** Is there a Worker to ask in this build? */
export const bibleSearchAvailable = reportsServer !== null;

async function ask<T>(path: string): Promise<T> {
  const server = reportsServer;
  if (!server) throw new BibleError('Bible Brain is reached through the LangQuest server, which this build does not name.', 0);
  const token = await server.token();
  if (!token) throw new BibleError('Your session has ended. Sign in again.', 401);
  let res: Response;
  try {
    res = await (server.fetch ?? fetch)(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new BibleError('Not connected. Try again when you are online.', null);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 503) throw new BibleError('Bible Brain is not set up on the server yet.', 503);
  if (!res.ok || !body) throw new BibleError(body?.error ?? `The server answered ${res.status}.`, res.status);
  return body;
}

const details = new Map<string, BibleDetail>();

export async function searchLanguages(q: string): Promise<BibleLanguage[]> {
  return (await ask<{ languages: BibleLanguage[] }>(`/api/bible/languages?q=${encodeURIComponent(q)}`)).languages;
}

export async function biblesIn(lang: string): Promise<BibleSummary[]> {
  return (await ask<{ bibles: BibleSummary[] }>(`/api/bible/bibles?lang=${encodeURIComponent(lang)}`)).bibles;
}

/** One Bible's books, copyright and what may be kept offline; kept for the session. */
export async function bibleDetail(bibleId: string): Promise<BibleDetail> {
  const held = details.get(bibleId);
  if (held) return held;
  const { bible } = await ask<{ bible: BibleDetail }>(`/api/bible/bibles/${encodeURIComponent(bibleId)}`);
  details.set(bibleId, bible);
  return bible;
}

/** A detail already fetched this session, without asking. */
export function heldDetail(bibleId: string): BibleDetail | null {
  return details.get(bibleId) ?? null;
}
