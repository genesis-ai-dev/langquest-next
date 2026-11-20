import { emptyLanguageState, foldLanguage, selectTemplateSpecs, type AnyEvent, type EventSpec, type LanguageState, type TemplateDoc } from '@langquest-next/core';
import { languageEntries } from '../src/map/mapModel';
import { booksToAdd, mapFolders, nameReady, newNodeId, outlineAdds, ownCopy, withOutlineAdded, withOutlineRenamed } from '../src/map/outlineEditModel';

const H = (c: string) => c.repeat(64);
const outline = (nodes: NonNullable<TemplateDoc['outline']>): TemplateDoc =>
  ({ format: 'template@1', name: 'Stories', description: '', structure: 'outline', levels: [{ name: 'Folder' }, { name: 'Story' }], outline: nodes, deps: [] });

let at = 10;
function use(state: LanguageState, doc: TemplateDoc): LanguageState {
  const specs: EventSpec[] = selectTemplateSpecs(state, { commandId: `c${at}`, itemId: 'st', docHash: H(String(at % 10)), doc, versification: null });
  const events = specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L1', actorId: 'a', deviceId: 'd', hlc: `${String(at + i).padStart(15, '0')}:000000:d` }) as AnyEvent);
  at += 100;
  return foldLanguage(events, state);
}
const folders = (state: LanguageState) => mapFolders(state, languageEntries(state, new Map())).map((f) => [f.name, f.entries.map((e) => e.unitId)]);

describe('folders and stories added on the map (LAN-239)', () => {
  const start = outline([{ id: 'f1', title: 'Beginnings', children: [{ id: 's1', title: 'Creation' }] }]);

  it('adds a story to the end of its folder and a folder at the end of the map, empty, where it can be filled', () => {
    // Why: a folder just made has nothing in it; it must still show on the map so a story can go in it.
    let state = use(emptyLanguageState(), start);
    const withStory = withOutlineAdded(start, { parentId: 'f1', id: 's2', name: '  The flood ', folder: false });
    const withFolder = withOutlineAdded(withStory, { parentId: 'f1', id: 'f2', name: 'Healing', folder: true });
    state = use(state, withFolder);
    expect(folders(state)).toEqual([['Beginnings', ['st/s1', 'st/s2']], ['Healing', []]]);
    expect(mapFolders(state, languageEntries(state, new Map())).map((f) => f.nodeId)).toEqual(['f1', 'f2']);
    state = use(state, withOutlineAdded(withFolder, { parentId: 'f2', id: 's3', name: 'The sick man', folder: false }));
    expect(folders(state)).toEqual([['Beginnings', ['st/s1', 'st/s2']], ['Healing', ['st/s3']]]);
  });

  it('shows a folder renamed on the map by its new name', () => {
    let state = use(emptyLanguageState(), start);
    state = use(state, withOutlineRenamed(start, 'f1', 'How it began'));
    expect(folders(state)).toEqual([['How it began', ['st/s1']]]);
  });

  it('offers a story only in a folder of stories, and a new folder only where the top holds folders', () => {
    // Why: a folder holds folders or stories, never both, as the template editor has it.
    const adds = outlineAdds(start);
    expect([adds.newFolder, adds.storyIn('f1'), adds.storyIn(null)]).toEqual([true, true, false]);
    const flat = outlineAdds(outline([{ id: 's1', title: 'Creation' }]));
    expect([flat.newFolder, flat.storyIn(null)]).toEqual([false, true]);
    expect(outlineAdds(null).newFolder).toBe(false);
  });

  it('takes a name with something in it that differs from the one it has, and makes ids with no / or @', () => {
    expect([nameReady('  '), nameReady('Healing'), nameReady(' Healing ', 'Healing'), nameReady('Health', 'Healing')]).toEqual([false, true, false, true]);
    expect(newNodeId('0f8e-4c2a-9b1d-77aa')).toBe('n0f8e4c2a9b');
  });

  it('offers the books the numbering has that the template leaves out', () => {
    const bible: TemplateDoc = { format: 'template@2', name: 'B', description: '', structure: 'bible', levels: [{ name: 'Book' }], bible: { versification: H('e'), books: [{ book: 'MAT', name: 'Matthew' }] }, deps: [] };
    expect(booksToAdd(bible, ['MAT', 'MRK', 'LUK'])).toEqual(['MRK', 'LUK']);
    expect(booksToAdd(start, ['MAT'])).toEqual([]);
    // A New Testament team on a whole-Bible template is offered the books it does not cover.
    expect(booksToAdd(bible, ['GEN', 'MAT', 'MRK'], ['MAT'])).toEqual(['GEN', 'MRK']);
  });

  it("copies a template for the language on its first change, and changes the language's own copy after", () => {
    // Why: Caleb chose "only this language": the library's template must stay as it was for the next language.
    expect(ownCopy({ name: 'Village stories', source: 'own' }, 'Tessa')).toBe(false);
    expect(ownCopy({ name: 'Village stories (Tessa)', source: 'copy' }, 'Tessa')).toBe(true);
    expect(ownCopy({ name: 'Village stories (Tessa and Oscar)', source: 'copy' }, 'Tessa')).toBe(false);
    expect(ownCopy({ name: 'FIA passages (Tessa)', source: 'subscription' }, 'Tessa')).toBe(false);
  });
});
