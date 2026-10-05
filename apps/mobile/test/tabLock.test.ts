import { LOCK_NAME, startTab, type TabDeps, type TabState } from '../src/tabLock';

// One tab at a time on the web (decisions.md 58): two tabs of one browser, faked.

function browser() {
  let holder: number | null = null;
  const waiting: { tab: number; grant: () => void }[] = [];
  const channels = new Map<number, (m: string) => void>();
  const flags = new Map<number, boolean>();
  const reloads: number[] = [];
  const tab = (id: number): TabDeps => ({
    request: async (name, opts, callback) => {
      expect(name).toBe(LOCK_NAME);
      if (holder === null) { holder = id; await callback({}); return; }
      if (opts.ifAvailable) { await callback(null); return; }
      await new Promise<void>((grant) => waiting.push({ tab: id, grant }));
      holder = id;
      await callback({});
    },
    post: (m) => { for (const [other, h] of channels) if (other !== id) h(m); },
    listen: (h) => { channels.set(id, h); return () => channels.delete(id); },
    movedFlag: { get: () => !!flags.get(id), set: () => flags.set(id, true), clear: () => flags.delete(id) },
    reload: () => {
      reloads.push(id);
      channels.delete(id);
      // The page goes, and its lock with it.
      holder = null;
      waiting.shift()?.grant();
    }
  });
  return { tab, reloads, holder: () => holder };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('one tab at a time', () => {
  it('the first tab holds the database, a second says where it is, and Use here moves it', async () => {
    const b = browser();
    const first: TabState[] = [];
    const second: TabState[] = [];
    startTab(b.tab(1), (s) => first.push(s));
    await settle();
    const two = startTab(b.tab(2), (s) => second.push(s));
    await settle();
    expect(first.at(-1)).toBe('ready');
    expect(second.at(-1)).toBe('elsewhere');

    two.useHere();
    await settle();
    expect(b.reloads).toEqual([1]);
    expect(b.holder()).toBe(2);
    expect(second.at(-1)).toBe('ready');

    // The first tab comes back from its reload as "moved" and opens nothing.
    const after: TabState[] = [];
    startTab(b.tab(1), (s) => after.push(s));
    await settle();
    expect(after.at(-1)).toBe('moved');
    expect(b.holder()).toBe(2);
  });

  it('a moved tab can take the database back', async () => {
    const b = browser();
    const states: TabState[] = [];
    startTab(b.tab(1), () => {});
    await settle();
    const two = startTab(b.tab(2), (s) => states.push(s));
    await settle();
    two.useHere();
    await settle();
    const back: TabState[] = [];
    const one = startTab(b.tab(1), (s) => back.push(s));
    await settle();
    one.useHere();
    await settle();
    expect(back.at(-1)).toBe('ready');
    expect(b.holder()).toBe(1);
    expect(b.reloads).toEqual([1, 2]);
  });
});
