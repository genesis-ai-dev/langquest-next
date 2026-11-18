import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { GROUPS } from '../src/pageOps';
import { ICONS, NAV, SHELL_LOGIC } from '../src/pageShell';

type NavState = Record<string, { need: number; dot: string }>;
const logic = new Function(`${SHELL_LOGIC}; return { navState };`)() as {
  navState: (sections: typeof GROUPS, results: Record<string, unknown>, levels: string[], waits?: (alerts: unknown[]) => number) => NavState;
};
const LEVELS = ['urgent', 'problem', 'watch'];
const okSection = { state: 'ok', alerts: [] };
const all = (state: unknown): Record<string, unknown> => Object.fromEntries(GROUPS.flatMap((g) => [...g.parts]).map((p) => [p, state]));

describe('the menu', () => {
  it('has every section but Look up exactly once, each with its drawing', () => {
    const ids = NAV.flatMap((g) => [...g.ids]);
    expect([...ids].sort()).toEqual(GROUPS.filter((g) => g.parts.length).map((g) => g.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...ids, 'overview', 'all']) expect(ICONS[id], id).toBeTruthy();
  });

  it('is on the page with the top line, and loads nothing from another host', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('<nav class="nav" id="nav" aria-label="Pages">');
    expect(html).toContain('<h1 id="view-title">');
    expect(html).toContain('<form class="look" id="start-look" role="search">');
    // The page's policy allows no style attribute and no outside font or picture.
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/);
    expect(html).not.toMatch(/https:\/\/fonts\./);
  });

  it('counts the lines that need a person, less those whose fix merged, and shows the most urgent level', () => {
    const results = {
      ...all(okSection),
      jobs: { state: 'ok', alerts: [{ level: 'problem', text: 'a' }, { level: 'urgent', text: 'b' }, { level: 'watch', text: 'c' }] },
      clients: { state: 'ok', alerts: [{ level: 'watch', text: 'w' }] },
      people: { state: 'error', alerts: [], error: 'down' }
    };
    const st = logic.navState(GROUPS, results, LEVELS);
    expect(st.jobs).toEqual({ need: 2, dot: 'urgent' });
    expect(st.phones).toEqual({ need: 0, dot: 'watch' });
    // A part that could not be read is a line to watch, as on the Overview.
    expect(st.people).toEqual({ need: 0, dot: 'watch' });
    expect(st.database).toEqual({ need: 0, dot: 'ok' });
    expect(st.lookup).toBeUndefined();
    expect(logic.navState(GROUPS, results, LEVELS, () => 1).jobs).toEqual({ need: 1, dot: 'urgent' });
  });

  it('says a section still loads or is not connected, never OK before every part answered', () => {
    expect(logic.navState(GROUPS, {}, LEVELS).releases).toEqual({ need: 0, dot: 'wait' });
    const part = { ...all(okSection) };
    delete part.expo;
    expect(logic.navState(GROUPS, part, LEVELS).releases!.dot).toBe('wait');
    expect(logic.navState(GROUPS, all({ state: 'off', alerts: [], setup: 'x' }), LEVELS).stores!.dot).toBe('off');
  });
});
