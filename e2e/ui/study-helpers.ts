// What 08-study-and-reference needs in its world that the local LangQuest
// library does not hold: a guide with a recorded step and glossary words, and
// a Bible of the organization's own. They are the organization's own library
// items (an admin's, as the guide editor and the library screens make them),
// built per world, so the shared library seed stays what production seeds.
import { canonicalJson, ORG_STREAM, validateDoc, withDeps, type LibraryDoc, type OrgState, type SourceBookDoc, type SourceDoc, type StudyDoc, type StudyDoc2 } from '@langquest-next/core';
import { blobKey, type SyncClient } from '@langquest-next/sync';
import { setupBlobs } from './blob-upload';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { VOICE_WAV } from '../fixtures/voice';
import { clientAs, send, signIn, type UiWorld } from './fixture';

/** The glossary word the guide's second step links, and the Bible's abbreviation (08-study-and-reference). */
export const GLOSSARY_WORD = 'inheritance';
export const OWN_BIBLE = 'TLB';

const ITEM_GUIDES = 'ui-test.study-guides';
const ITEM_BIBLE = 'ui-test.bible';

type Shared = { org_id: string; item_id: string; latest_hash: string };
type Row = { hash: string; body: string };

/**
 * Give the organization, as its admin, what the study tests read:
 *  - the example guides (LangQuest's "Example study guides (English)") with
 *    Luke 15:11-32 rewritten as a `study@2` guide whose first step is
 *    recorded (the test voice) and whose second step links a glossary word
 *    that has a recording of its own; John 3:1-21 stays as it is;
 *  - a small Bible with Luke's text, kept in the organization's library and
 *    recommended by nobody (so it is found under More Bibles).
 */
export async function offerStudyWorld(world: UiWorld): Promise<void> {
  const { sb, session } = await signIn(world, 'ADMIN');
  const blobs = setupBlobs(world.apiUrl, session.access_token);
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
  const read = async (hash: string): Promise<LibraryDoc> => {
    const [row] = await rpc<Row[]>('library_get_documents', { p_org: world.orgId, p_hashes: [hash] });
    if (!row) throw new Error(`the library has no document ${hash}`);
    return JSON.parse(row.body) as LibraryDoc;
  };

  // The example guides, read as anyone browsing the library does.
  const shared = await rpc<Shared[]>('library_shared_items', { p_kind: 'material', p_query: null, p_limit: 500, p_offset: 0 });
  const examples = shared.find((r) => r.item_id === 'langquest.examples.eng');
  if (!examples) throw new Error('The library has no "Example study guides (English)"; run npm run library:seed');
  const collection = await read(examples.latest_hash);
  if (collection.format !== 'collection@1') throw new Error('the example guides are not a collection');
  const luke = collection.entries.find((e) => /^LUK 15:11/.test(e.ref));
  const john = collection.entries.find((e) => /^JHN 3:1/.test(e.ref));
  if (!luke || !john) throw new Error('the example guides lack Luke 15:11-32 or John 3:1-21');
  const lukeDoc = (await read(luke.doc)) as StudyDoc;
  const johnDoc = (await read(john.doc)) as StudyDoc;

  // The recording: the test voice, as the guide editor keeps a guide's file (the organization's guide files).
  const wav = new Uint8Array(readFileSync(VOICE_WAV));
  const audio = { hash: createHash('sha256').update(wav).digest('hex'), format: 'wav', seconds: 4 };
  await blobs.put(blobKey(world.orgId, ORG_STREAM, audio.hash, 'wav'), wav);

  const study: StudyDoc2 = {
    format: 'study@2', title: lukeDoc.title, pattern: lukeDoc.pattern, about: lukeDoc.about, source: lukeDoc.source, language: lukeDoc.language,
    ref: lukeDoc.ref, versification: lukeDoc.versification,
    steps: lukeDoc.steps.map((s, i) => ({
      id: s.id, title: s.title, ...(s.phase ? { phase: s.phase } : {}), ...(s.purpose ? { purpose: s.purpose } : {}),
      text: i === 1 ? `${s.text}\n\nThe younger son's [${GLOSSARY_WORD}](#${GLOSSARY_WORD}) was his share of the family land.` : s.text,
      ...(i === 0 ? { audio } : {})
    })),
    resources: [{ ref: GLOSSARY_WORD, kind: 'term', title: GLOSSARY_WORD, description: 'What a father leaves to his children.' }],
    terms: [{
      id: GLOSSARY_WORD, term: GLOSSARY_WORD, hint: 'What a father leaves to his children.',
      body: 'In the story the younger son asks for his share while his father is alive.', audio
    }],
    deps: []
  };
  const studyHash = await put(study);
  const johnHash = await put(johnDoc);
  const guides = await put({
    format: 'collection@1', title: 'Study guides for the UI tests', description: 'Luke 15:11-32 with a recorded step and a glossary word, and John 3:1-21 as FIA\'s example has it.',
    language: 'eng', versification: collection.versification,
    entries: [{ ref: lukeDoc.ref, title: lukeDoc.title, doc: studyHash }, { ref: johnDoc.ref, title: johnDoc.title, doc: johnHash }],
    deps: []
  });

  // A Bible of the organization's own: Luke 15's text, in English Bibles' numbering, with no audio.
  const verses: [number, number, string][] = [
    [11, 11, 'A man had two sons.'], [12, 12, 'The younger said to his father, Father, give me my share of the estate.'],
    [20, 20, 'While he was still far off, his father saw him and ran to him.']
  ];
  const book = await put({ format: 'sourceBook@1', book: 'LUK', chapters: [{ chapter: 15, verses }], deps: [] } satisfies SourceBookDoc);
  const bible = await put({
    format: 'source@1', name: 'Test Library Bible', abbreviation: OWN_BIBLE, language: 'eng', description: 'Written for the UI tests; Luke 15 only.',
    versification: collection.versification, provider: { kind: 'library' }, offline: 'allowed',
    copyright: { text: 'Written for the UI tests.' }, books: [{ book: 'LUK', name: 'Luke', doc: book }], deps: []
  } satisfies SourceDoc);

  const org = await clientAs(world, 'ADMIN', 'org') as SyncClient<OrgState>;
  const item = (itemId: string, name: string, description: string, docHash: string) => [
    { id: randomUUID(), type: 'v1.LibraryItemDefined', payload: { itemId, kind: 'material', name, description } },
    { id: randomUUID(), type: 'v1.LibraryVersionPublished', payload: { itemId, kind: 'material', docHash } }
  ];
  await org.appendMany([
    ...item(ITEM_GUIDES, 'Study guides for the UI tests', 'Luke 15:11-32 with a recorded step and a glossary word; John 3:1-21.', guides),
    ...item(ITEM_BIBLE, 'Test Library Bible', 'Luke 15, for the Bible tests.', bible)
  ] as never);
  await send(org as SyncClient<unknown>, 'ADMIN offers the study tests\' guides and Bible');
}
