// Publishing an uploaded Bible (LAN-229, decision 209): each book is kept as a
// document, then the Bible's header names them and becomes an organization
// library item, shared for other organizations to follow when the admin says so.
// Nothing is sent to the server by hand: documents go out through the library's
// outbox (dependencies first) and the item is the admin's events, as any
// library item is.
import type { UsfmCheck } from '@langquest-next/core';
import { keepNewDoc, prepareDoc } from '../library/docStore';
import type { SharedItem } from '../library/model';
import type { useLibrary } from '../library/useLibrary';
import { versificationHash } from '../reference/referenceActions';
import { bibleDoc, bookDoc, readyBooks, type UsfmDetails } from './model';

export interface UsfmEntry { check: UsfmCheck; text: string }

/** Publish the passing books as one Bible. Returns its library item id. */
export async function publishUsfmBible(
  lib: ReturnType<typeof useLibrary>,
  c: { entries: readonly UsfmEntry[]; details: UsfmDetails; license: string; versifications: SharedItem[] }
): Promise<string> {
  const checks = c.entries.map((e) => e.check);
  const ready = new Set(readyBooks(checks));
  const v11n = await versificationHash(lib, c.details.numbering, c.versifications);
  const docs = new Map<string, string>();
  for (const e of c.entries) {
    if (!ready.has(e.check)) continue;
    const { text, hash } = await prepareDoc(bookDoc(e.check, e.text));
    await keepNewDoc(lib.orgId, text, hash);
    docs.set(e.check.book!, hash);
  }
  const doc = bibleDoc(checks, docs, c.details, v11n, c.license);
  // i18n-ignore: the item's description is stored in the organization's library (its event log)
  const description = `${c.details.abbreviation.trim()} · uploaded USFM files · ${doc.books.length} book${doc.books.length === 1 ? '' : 's'}`;
  const { itemId } = await lib.publish({ kind: 'material', name: doc.name, description, doc });
  if (c.details.share) await lib.setSharing({ itemId, kind: 'material' }, true, true);
  return itemId;
}
