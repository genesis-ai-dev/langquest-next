/**
 * The names library items go by in the app's language, from a teammate's phone (decision 195;
 * 2026-11-24, review item 13). Why these tests: a newcomer whose app is in French saw English
 * template and guide names where the inviter saw French ones, because only the server gave them.
 * A teammate's names fill only what this phone lacks, and once the server's read replaces the set,
 * no teammate is asked again.
 */

const fake = vi.hoisted(() => ({ saved: new Map<string, string>(), shared: [] as unknown[], fail: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.saved.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.saved.set(k, v); },
    multiSet: async (rows: [string, string][]) => { for (const [k, v] of rows) fake.saved.set(k, v); },
    removeItem: async (k: string) => { fake.saved.delete(k); }
  }
}));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/server/library', () => ({ sharedItems: async () => (fake.fail ? { data: null, error: { message: 'offline' } } : { data: fake.shared, error: null }) }));
vi.mock('../src/library/docStore', () => ({ loadDocs: async () => new Map() }));

beforeEach(() => {
  fake.saved.clear();
  fake.shared = [];
  fake.fail = false;
  vi.resetModules();
});

describe('names from a teammate\'s phone', () => {
  it('fill only the items this phone has none for, show at once, and mark the set as not yet the server\'s', async () => {
    const labels = { ...await import('../src/library/labels'), ...await import('../src/library/labelsTeammate.native') };
    fake.saved.set('library-labels:fra', JSON.stringify([['fia/guides', { name: 'Guides (serveur)' }]]));
    expect(await labels.labelsFromServer('fra')).toBe(true);
    await labels.keepTeammateLabels('fra', new Map([['fia/guides', { name: 'Guides' }], ['pub/tpl', { name: 'Modèle' }]]));
    expect([...await labels.keptLabels('fra')]).toEqual([['fia/guides', { name: 'Guides (serveur)' }], ['pub/tpl', { name: 'Modèle' }]]);
    expect(await labels.labelsFromServer('fra')).toBe(false);
    expect(labels.labelsNow('fra').get('pub/tpl')).toEqual({ name: 'Modèle' });
    // Nothing new: nothing written.
    fake.saved.delete('library-labels-teammate:fra');
    await labels.keepTeammateLabels('fra', new Map([['pub/tpl', { name: 'Autre' }]]));
    expect(fake.saved.has('library-labels-teammate:fra')).toBe(false);
  });

  it('a phone with none keeps none from the server and asks a teammate; the server\'s read ends that', async () => {
    const labels = { ...await import('../src/library/labels'), ...await import('../src/library/labelsTeammate.native') };
    expect(await labels.labelsFromServer('fra')).toBe(false);
    expect((await labels.keptLabels('fra')).size).toBe(0);
    await labels.keepTeammateLabels('fra', new Map([['pub/tpl', { name: 'Modèle' }]]));
    expect(await labels.labelsFromServer('fra')).toBe(false);
    await labels.loadLabels('o1', 'fra');
    expect(await labels.labelsFromServer('fra')).toBe(true);
  });

  it('a set that cannot be read reads as none', async () => {
    const labels = await import('../src/library/labelsTeammate.native');
    fake.saved.set('library-labels:fra', 'not json');
    expect((await labels.keptLabels('fra')).size).toBe(0);
    await labels.keepTeammateLabels('fra', new Map([['pub/tpl', { name: 'Modèle' }]]));
    expect([...await labels.keptLabels('fra')]).toEqual([['pub/tpl', { name: 'Modèle' }]]);
  });
});
