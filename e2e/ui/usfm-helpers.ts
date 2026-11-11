// What 08-usfm-bible needs in its world: an uploaded Bible (LAN-229, LAN-230,
// decisions 208 and 209) in the organization's library, as the upload screen
// publishes it, recommended to every language, and one small English Bible
// beside it so the Bible picker has a choice. Built per world, as an admin
// would, from real USFM files: Jonah as eBible.org publishes it (core's test
// fixture) and Luke cut to the chapters the passages need.
import { canonicalJson, checkUsfm, validateDoc, withDeps, type LibraryDoc, type SourceBookDoc, type SourceDoc, type UsfmBibleDoc, type UsfmBookDoc } from '@langquest-next/core';
import { type SyncClient } from '@langquest-next/sync';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientAs, send, signIn, type UiWorld } from './fixture';

export const IRV = 'IRV';
export const IRV_NAME = 'पवित्र बाइबिल (Hindi IRV)';
/** The English Bible beside it, whose abbreviation sorts first, so it is the one a translator starts on. */
export const ENGLISH = 'EGB';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  { name: '33-JONhin2017.usfm', file: path.join(here, '..', '..', 'packages/core/test/fixtures/usfm/33-JONhin2017.usfm') },
  { name: '48-LUKhin2017-15-16.usfm', file: path.join(here, '..', 'fixtures/usfm/48-LUKhin2017-15-16.usfm') }
];

const ITEM_IRV = 'ui-test.usfm-bible';
const ITEM_ENGLISH = 'ui-test.english-bible';

type Shared = { org_id: string; item_id: string; latest_hash: string };
type Row = { hash: string; body: string };

/** The books the world's Bible holds, as the library keeps them: file name, check and the file's own text. */
export function irvBooks() {
  return FILES.map(({ name, file }) => {
    const usfm = readFileSync(file, 'utf8');
    const check = checkUsfm(name, usfm);
    if (check.errors.length || !check.book) throw new Error(`${name} does not pass its check: ${JSON.stringify(check.errors)}`);
    return { check, usfm };
  });
}

/** Give the organization the uploaded Hindi Bible and a small English one, both recommended to every language. */
export async function offerUsfmWorld(world: UiWorld): Promise<void> {
  const { sb } = await signIn(world, 'ADMIN');
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  const put = async (doc: LibraryDoc): Promise<string> => {
    const body = doc.format === 'versification@1' ? doc : withDeps(doc);
    const invalid = validateDoc(body);
    if (invalid) throw new Error(`${body.format}: ${invalid}`);
    const hash = await rpc<string>('library_put_document', { p_org: world.orgId, p_body: canonicalJson(body) });
    if (hash !== createHash('sha256').update(canonicalJson(body)).digest('hex')) throw new Error(`the server named a ${body.format} differently`);
    return hash;
  };

  // The numbering the world's own template uses: LangQuest's example guides are written in it.
  const shared = await rpc<Shared[]>('library_shared_items', { p_kind: 'material', p_query: null, p_limit: 500, p_offset: 0 });
  const examples = shared.find((r) => r.item_id === 'langquest.examples.eng');
  if (!examples) throw new Error('The library has no "Example study guides (English)"; run npm run library:seed');
  const [row] = await rpc<Row[]>('library_get_documents', { p_org: world.orgId, p_hashes: [examples.latest_hash] });
  const collection = JSON.parse(row!.body) as { versification: string };

  // The uploaded Bible, as apps/mobile/src/usfm/model.ts makes it from the files that passed.
  const books = irvBooks();
  const docs = new Map<string, string>();
  for (const { check, usfm } of books) {
    const book: UsfmBookDoc = { format: 'usfmBook@1', book: check.book!, name: check.name || check.book!, chapters: check.chapters, usfm, deps: [] };
    docs.set(check.book!, await put(book));
  }
  const irv: UsfmBibleDoc = {
    format: 'usfmBible@1', name: IRV_NAME, abbreviation: IRV, language: 'hin', versification: collection.versification,
    copyright: '© Bridge Connectivity Solutions. CC BY-SA 4.0.', rightsConfirmed: true,
    books: books.map(({ check }) => ({ book: check.book!, name: check.name || check.book!, doc: docs.get(check.book!)!, chapters: check.chapters.length, verses: check.verseCount })),
    deps: []
  };
  const irvHash = await put(irv);

  // A little English Bible (Luke 15's first verses, no audio) for the picker.
  const english = await put({
    format: 'sourceBook@1', book: 'LUK',
    chapters: [{ chapter: 15, verses: [[11, 11, 'A man had two sons.'], [12, 12, 'The younger said to his father, Father, give me my share of the estate.']] }],
    deps: []
  } satisfies SourceBookDoc);
  const englishHash = await put({
    format: 'source@1', name: 'Test English Bible', abbreviation: ENGLISH, language: 'eng', description: 'Written for the UI tests; Luke 15 only.',
    versification: collection.versification, provider: { kind: 'library' }, offline: 'allowed',
    copyright: { text: 'Written for the UI tests.' }, books: [{ book: 'LUK', name: 'Luke', doc: english }], deps: []
  } satisfies SourceDoc);

  const org = await clientAs(world, 'ADMIN', 'org') as SyncClient<unknown>;
  const item = (itemId: string, name: string, description: string, docHash: string) => [
    { id: randomUUID(), type: 'v1.LibraryItemDefined', payload: { itemId, kind: 'material', name, description } },
    { id: randomUUID(), type: 'v1.LibraryVersionPublished', payload: { itemId, kind: 'material', docHash } },
    { id: randomUUID(), type: 'v1.ReferenceRecommended', payload: { itemId, recommended: true } }
  ];
  await org.appendMany([
    ...item(ITEM_IRV, IRV_NAME, 'Uploaded as USFM files: Jonah and Luke 15 and 16.', irvHash),
    ...item(ITEM_ENGLISH, 'Test English Bible', 'Luke 15, for the Bible picker.', englishHash)
  ] as never);
  await send(org, 'ADMIN offers the uploaded Hindi Bible and an English one');
}
