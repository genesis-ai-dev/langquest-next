// What the reference screens do: the level a change is made at, asking for timings and
// publishing them, and what a failure says (reference/useReference.ts holds the hooks).
import { CommandError, type LibraryDoc, type LibraryItemView, type SourceDoc, type VersificationDoc } from '@langquest-next/core';
import { commandErrorText } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { cachedDoc, hashOf, keepNewDoc, loadDocs } from '../library/docStore';
import type { SharedItem } from '../library/model';
import { useLibrary } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';
import * as server from '../server/reference';
import { BibleError } from '../sources/bibleBrainAdmin';
import { type Level } from './model';
import { timingPublication, type TimingPublication, type TimingResultRow } from '@langquest-next/core';

/** The level a screen is at: the language in its params (when it is the open language), else the organization. */
export function levelOf(ctx: Ctx): Level {
  const languageId = ctx.params['languageId'];
  return languageId && ctx.language.languageId === languageId ? { kind: 'language', languageId } : { kind: 'org' };
}

export const NETWORK = /network|fetch|offline|timed? ?out|not connected/i;

/** Say "not connected" plainly for a server action, else the fault with a code. */
export function referenceFailure(where: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof CommandError) && !(e instanceof BibleError) && NETWORK.test(e.message)) return t('common.notConnected');
  if (e instanceof CommandError) return commandErrorText(e);
  // Bible Brain's errors are worded in the language showing (sources/bibleBrain.ts).
  if (e instanceof BibleError) return e.message;
  return failureMessage(where, e);
}

/** A refusal from the server (Supabase), in the person's words: not connected, not allowed, or a general one. Its own message is English. */
export function serverRefusal(error: { message: string; code?: string }): CommandError {
  if (NETWORK.test(error.message)) return new CommandError(t('common.notConnected'));
  if (error.code === '42501') return new CommandError(t('reference.errors.notAllowed'));
  return new CommandError(t('reference.errors.serverRefused'));
}

/**
 * The hash of this organization's versification with `code` ("eng"): one
 * it has, else LangQuest's, followed now so documents may depend on it.
 */
export async function versificationHash(lib: ReturnType<typeof useLibrary>, code: string, shared: SharedItem[]): Promise<string> {
  const own = lib.items('versification').filter((v) => v.current && !v.archived);
  const docs = await loadDocs(lib.orgId, own.map((v) => v.current)).catch(() => new Map<string, LibraryDoc>());
  const hit = own.find((v) => (docs.get(v.current!) as VersificationDoc | undefined)?.code === code);
  if (hit) return hit.current!;
  const row = shared.find((s) => s.org_id === 'langquest' && s.item_id === `langquest.versification.${code}`)
    ?? shared.find((s) => s.item_id.endsWith(`.versification.${code}`));
  if (!row) throw new CommandError(t('reference.errors.noVersification', { code: code.toUpperCase() }));
  await lib.subscribe(row, true);
  return row.latest_hash;
}

/** Ask for verse timings for some books of one source's audio. One open job per audio is enough; asking again returns it. */
export async function requestTimings(orgId: string, c: { itemId: string; bibleId: string; audioFileset: string; textFileset: string | null; books: string[]; versification: string; publishTo?: { org: string; item: string } }): Promise<string> {
  const { data, error } = await server.requestTimings(orgId, c);
  if (error) throw serverRefusal(error);
  return data as string;
}

/**
 * Publish a finished job's passing results as the source's next version:
 * timing documents, the books that name them, then the source. Safe to run
 * again; what is already there is not published twice.
 */
export async function publishTimingJob(lib: ReturnType<typeof useLibrary>, it: LibraryItemView, jobId: string, base: string | null = it.current): Promise<TimingPublication> {
  if (it.source === 'subscription') throw new CommandError(t('reference.errors.followedNoTimings'));
  const { data, error } = await server.timingJobResults(lib.orgId, jobId);
  if (error) throw serverRefusal(error);
  const rows = (data ?? []) as TimingResultRow[];
  const loaded = await loadDocs(lib.orgId, [base]);
  const get = (h: string | null | undefined) => (h ? loaded.get(h) ?? cachedDoc(h) : null);
  const source = get(base) as SourceDoc | null;
  if (!source || source.format !== 'source@1') throw new CommandError(t('reference.errors.bibleNotHere'));
  // Its books, so chapters already timed keep their timings and text is carried over (books do not come with the source).
  const books = await loadDocs(lib.orgId, source.books.map((b) => b.doc), { deps: false });
  for (const [h, d] of books) loaded.set(h, d);
  if (source.books.some((b) => b.doc && !loaded.get(b.doc) && !cachedDoc(b.doc))) throw new CommandError(t('reference.errors.someBibleNotHere'));
  const own = lib.items('versification').filter((v) => v.current);
  const vdocs = await loadDocs(lib.orgId, [source.versification, ...own.map((v) => v.current)]);
  const versifications = [source.versification, ...own.map((v) => v.current!)]
    .map((hash) => ({ hash, code: (vdocs.get(hash) as VersificationDoc | undefined)?.code ?? '' }))
    .filter((v) => v.code);
  const pub = await timingPublication({ source, sourceHash: base!, rows, get, versifications }, hashOf);
  if (!pub.source) return pub;
  for (const d of pub.docs) if (d.doc.format !== 'source@1') await keepNewDoc(lib.orgId, d.text, d.hash);
  await lib.publish({
    kind: 'material', itemId: it.itemId, name: it.name, description: it.description, doc: pub.source.doc,
    // i18n-ignore: the version's note is stored in the organization's event log
    note: `Verse timings for ${pub.placed.length} chapter${pub.placed.length === 1 ? '' : 's'}`
  });
  return pub;
}
