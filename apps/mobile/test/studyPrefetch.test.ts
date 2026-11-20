import { lookedUp } from '../src/study/prefetchModel';

// A kept passage showed "On this device" before its guide had loaded, then turned amber (Carl, 2026-11-20):
// its study files are counted as here only once its guide has been looked up, found or not (decisions.md 166).
describe('which kept passages have had their study guide looked up', () => {
  const read = (...hashes: string[]) => (h: string) => hashes.includes(h);
  const base = {
    unitIds: ['luke1', 'luke2', 'luke3'],
    found: new Set<string>(),
    offered: new Map([['luke1', ['fia']], ['luke2', ['fia', 'own']], ['luke3', []]]),
    template: 'template',
    chosen: new Map<string, string>(),
    read: read(),
    entryRead: read()
  };

  it('none while nothing has been read: a passage may have a guide that has not loaded', () => {
    expect([...lookedUp(base)]).toEqual([]);
  });

  it('a passage with no guide is looked up once the template and every document it is offered have been read', () => {
    // The template says a passage's verses: without it no guide can be matched, so nothing offered is an answer.
    expect([...lookedUp({ ...base, read: read('fia', 'own') })]).toEqual([]);
    expect([...lookedUp({ ...base, read: read('template') })]).toEqual(['luke3']);
    expect([...lookedUp({ ...base, read: read('template', 'fia') })]).toEqual(['luke1', 'luke3']);
    expect([...lookedUp({ ...base, read: read('template', 'fia', 'own') })]).toEqual(['luke1', 'luke2', 'luke3']);
  });

  it('one document that cannot be read holds back only the passages offered it', () => {
    // `own` never answers (offline, and not on this device): luke2 stays not looked up, the others are.
    const got = lookedUp({ ...base, read: read('template', 'fia') });
    expect(got.has('luke2')).toBe(false);
    expect(got.has('luke1')).toBe(true);
  });

  it('a passage whose guide is in hand is looked up, whatever else has not been read', () => {
    expect([...lookedUp({ ...base, found: new Set(['luke2']) })]).toEqual(['luke2']);
  });

  it("a passage with a guide chosen waits for that guide's own document, and a read that finds none is an answer", () => {
    const chosen = new Map([['luke1', 'entry1']]);
    const all = read('template', 'fia', 'own');
    expect(lookedUp({ ...base, read: all, chosen }).has('luke1')).toBe(false);
    // Read, and not a guide after all (the server has none, or it is not a study document): no files to want.
    expect(lookedUp({ ...base, read: all, chosen, entryRead: read('entry1') }).has('luke1')).toBe(true);
  });

  it('a language with no template needs none read, and a passage offered nothing known is not looked up', () => {
    expect([...lookedUp({ ...base, template: null, read: read('fia') })]).toEqual(['luke1', 'luke3']);
    expect([...lookedUp({ ...base, unitIds: ['luke9'], read: read('template', 'fia', 'own') })]).toEqual([]);
  });
});
