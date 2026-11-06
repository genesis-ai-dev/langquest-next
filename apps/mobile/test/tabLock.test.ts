import { LOCK_NAME, startTab, type TabDeps, type TabState } from '../src/web/tabLock';

// One tab at a time on the web (decisions.md 58): two tabs of one browser, faked.

function browser(opts: { onWait?: () => void; busy?: (tab: number) => boolean; stays?: (tab: number) => boolean } = {}) {
  let holder: number | null = null;
  const waiting: { tab: number; grant: () => void }[] = [];
  const channels = new Map<number, Set<(m: string) => void>>();
  const flags = new Map<number, boolean>();
  const reloads: number[] = [];
  const tab = (id: number): TabDeps => ({
    request: async (name, o, callback) => {
      expect(name).toBe(LOCK_NAME);
      // As Web Locks do: the lock is let go once the callback's promise settles.
      const held = async () => {
        holder = id;
        await callback({});
        if (holder === id) { holder = null; waiting.shift()?.grant(); }
      };
      if (holder === null) { await held(); return; }
      if (o.ifAvailable) { await callback(null); return; }
      await new Promise<void>((grant, fail) => {
        const entry = { tab: id, grant };
        waiting.push(entry);
        // As Web Locks do: an aborted request leaves the queue and fails.
        o.signal?.addEventListener('abort', () => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          fail(new Error('AbortError'));
        });
      });
      await held();
    },
    post: (m) => { for (const [other, hs] of channels) if (other !== id) for (const h of [...hs]) h(m); },
    listen: (h) => {
      const hs = channels.get(id) ?? new Set();
      hs.add(h);
      channels.set(id, hs);
      return () => { hs.delete(h); };
    },
    busy: () => opts.busy?.(id) ?? false,
    movedFlag: { get: () => !!flags.get(id), set: () => flags.set(id, true), clear: () => flags.delete(id) },
    wait: async () => { opts.onWait?.(); },
    reload: () => {
      // The person chose Stay on the browser's "Leave site?": the page and its lock stay.
      if (opts.stays?.(id)) return;
      reloads.push(id);
      channels.delete(id);
      // The page goes, and its lock with it.
      holder = null;
      waiting.shift()?.grant();
    }
  });
  return { tab, reloads, holder: () => holder, release: () => { holder = null; } };
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

  it('a reloaded tab waits for its own last page to let go, instead of saying another tab has it', async () => {
    // Why: Chrome sometimes starts the reloaded page before the old page's
    // lock is released, and a plain reload showed "open in another tab".
    let waits = 0;
    const b = browser({ onWait: () => { waits++; if (waits === 2) b.release(); } });
    startTab(b.tab(1), () => {});
    await settle();
    const states: TabState[] = [];
    startTab(b.tab(2), (s) => states.push(s));
    await settle();
    expect(states).toEqual(['checking', 'ready']);
    expect(b.holder()).toBe(2);
  });

  it('says another tab has it once the lock stays taken', async () => {
    let waits = 0;
    const b = browser({ onWait: () => { waits++; } });
    startTab(b.tab(1), () => {});
    await settle();
    const states: TabState[] = [];
    startTab(b.tab(2), (s) => states.push(s));
    await settle();
    expect(states).toEqual(['checking', 'elsewhere']);
    expect(waits).toBeGreaterThan(1);
  });

  it('stop lets go of the lock, so the next to ask gets it', async () => {
    // Why: a page that mounts its gate again, or a tab that stops, must not
    // keep the database from the one asking next ("open in another tab").
    const b = browser();
    const one = startTab(b.tab(1), () => {});
    await settle();
    expect(b.holder()).toBe(1);
    one.stop();
    await settle();
    expect(b.holder()).toBe(null);
    const states: TabState[] = [];
    startTab(b.tab(2), (s) => states.push(s));
    await settle();
    expect(states.at(-1)).toBe('ready');
    expect(b.holder()).toBe(2);
  });

  it('a tab that is recording says so, and keeps LangQuest, instead of reloading its session away', async () => {
    // Why: a take's audio lives in the page until it is saved, and the
    // asking tab said "The other tab saves what it has" while it lost it.
    let recording = true;
    const b = browser({ busy: (tab) => tab === 1 && recording });
    startTab(b.tab(1), () => {});
    await settle();
    const states: TabState[] = [];
    const two = startTab(b.tab(2), (s) => states.push(s));
    await settle();
    two.useHere();
    await settle();
    expect(states.at(-1)).toBe('busy');
    expect(b.reloads).toEqual([]);
    expect(b.holder()).toBe(1);
    // Stopped there: asking again moves it.
    recording = false;
    two.useHere();
    await settle();
    expect(states.at(-1)).toBe('ready');
    expect(b.reloads).toEqual([1]);
    expect(b.holder()).toBe(2);
  });

  it('waiting can be cancelled, and a cancelled tab never takes the lock later', async () => {
    // Why: a holder that stays (Stay on "Leave site?") left the asking tab
    // saying "Moving LangQuest to this tab…" for ever, with no way out.
    let stays = true;
    const b = browser({ stays: (tab) => tab === 1 && stays });
    const one = startTab(b.tab(1), () => {});
    await settle();
    const states: TabState[] = [];
    const two = startTab(b.tab(2), (s) => states.push(s));
    await settle();
    two.useHere();
    await settle();
    expect(states.at(-1)).toBe('waiting');
    two.cancel();
    await settle();
    expect(states.at(-1)).toBe('elsewhere');
    stays = false;
    one.stop();
    await settle();
    expect(b.holder()).toBe(null);
    expect(states.at(-1)).toBe('elsewhere');
  });
});
