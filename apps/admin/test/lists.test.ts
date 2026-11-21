import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { LISTS_LOGIC, LISTS_SCRIPT } from '../src/pageLists';
import { PART_TITLES } from '../src/pageOps';

interface Item { s: string; name: string; at: string | null; fields: [string, unknown][]; link?: string | null; lang?: boolean; short?: string; v?: number; crashes?: number; shipped?: number; days?: number | null }
interface Row { label: string; items: Item[]; lang?: boolean; draw?: string; count?: boolean }

/** The list pictures' pure helpers, as the page runs them (pageLists.ts LISTS_LOGIC). */
const logic = new Function(`${LISTS_LOGIC}; return { listRows, shareCells, LIST_ORDER, SHARE_PAST };`)() as {
  listRows: (part: string, d: unknown) => Row[] | null;
  shareCells: (items: { s: string }[], n: number) => string[];
  LIST_ORDER: string[];
  SHARE_PAST: number;
};
const states = (r: Row) => r.items.map((x) => x.s);
const field = (x: Item, name: string) => x.fields.find((f) => f[0] === name)?.[1];
const LISTED = ['nightly', 'expo', 'v2', 'userissues', 'feedback', 'tutorials', 'videofeedback', 'videos', 'pipeline', 'releases', 'expiry', 'appstore'];

describe('a square for each item of a fixed list (plan 5c2)', () => {
  it('draws a list for each part it names, each with a title, and none for the rest', () => {
    for (const p of LISTED) {
      expect(PART_TITLES[p], p).toBeTruthy();
      expect(LISTS_SCRIPT, p).toContain(`  ${p}: { one: '`);
      expect(Array.isArray(logic.listRows(p, {})), p).toBe(true);
    }
    expect(logic.listRows('jobs', {})).toBeNull();
    expect(logic.listRows('nightly', null)).toBeNull();
  });

  it('puts a suite that broke before one whose tests failed, before one that passed, and opens its Linear issue', () => {
    const run = { number: 9, url: 'https://github.com/o/r/actions/runs/9', at: '2026-11-17T04:00:00Z', sha: 'abc12345', conclusion: 'failure' };
    const rows = logic.listRows('nightly', { runs: [
      { title: 'Guardrails nightly', run, suites: [
        { suite: 'ui-web', ran: 40, passed: 40, failed: false, broke: null, issues: [] },
        { suite: 'fleet', ran: null, passed: null, failed: true, broke: 'the job timed out.', issues: [] },
        { suite: 'mutation', ran: 10, passed: 8, failed: true, broke: null, issues: [{ id: 'LAN-9', url: 'https://linear.app/x/issue/LAN-9' }] }
      ] },
      { title: 'Phone tests', run: null, suites: [] }
    ] })!;
    expect(rows.map((r) => r.label)).toEqual(['Guardrails nightly']);
    expect(states(rows[0]!)).toEqual(['fail', 'part', 'ok']);
    const [broke, failed, passed] = rows[0]!.items as [Item, Item, Item];
    expect(field(broke, 'Broke')).toBe('the job timed out.');
    expect(broke.link).toBe(run.url);
    expect(failed.link).toBe('https://linear.app/x/issue/LAN-9');
    expect(field(failed, 'Tests')).toBe('8 of 10 passed');
    expect(passed.fields.map((f) => f[0])).not.toContain('Broke');
  });

  it('shows EAS builds, submissions and updates newest on the right, a failure red and a running one apart', () => {
    const rows = logic.listRows('expo', {
      builds: [{ platform: 'IOS', profile: 'production', status: 'IN_PROGRESS', at: '2026-11-17T03:00:00Z', appVersion: '2026.1117.3', runtime: null },
        { platform: 'ANDROID', profile: 'production', status: 'ERRORED', at: '2026-11-16T03:00:00Z', appVersion: null, runtime: '7' },
        { platform: 'IOS', profile: 'preview', status: 'CANCELED', at: '2026-11-15T03:00:00Z', appVersion: null, runtime: null }],
      submissions: [], updates: [{ branch: 'production', platform: 'ios, android', runtime: '7', group: 'g1', at: '2026-11-17T05:00:00Z' }]
    })!;
    expect(rows.map((r) => r.label)).toEqual(['Builds', 'Updates']);
    expect(states(rows[0]!)).toEqual(['off', 'fail', 'run']);
    expect(rows[0]!.items[2]!.name).toBe('IOS · production · 2026.1117.3');
  });

  it('counts the v2 projects the page does not read, so a few hundred done stay squares, and past 200 each is 1%', () => {
    const project = (state: string, i: number) => ({ project_id: `p${i}-0000000`, state, step: null, done: 1, total: 4, started_at: '2026-11-01T00:00:00Z', finished_at: null, failed_7d: 0 });
    const rows = logic.listRows('v2', { states: { done: 300, error: 1, running: 1 }, projects: [project('error', 1), project('running', 2), ...[3, 4, 5, 6, 7].map((i) => project('done', i))] })!;
    const items = rows[0]!.items;
    expect(items).toHaveLength(302);
    expect(items[0]).toMatchObject({ s: 'fail', name: 'Project p1-00000' });
    expect(field(items[0]!, 'Progress')).toBe('1 of 4');
    expect(items.filter((x) => x.name === 'A project that is done')).toHaveLength(295);
    expect(items.length).toBeGreaterThan(logic.SHARE_PAST);
    const cells = logic.shareCells(items, 100);
    expect(cells).toHaveLength(100);
    expect(cells.slice(0, 2)).toEqual(['fail', 'run']);
  });

  it('marks a user issue open in Linear as waiting, a closed one done, and one already fixed apart', () => {
    const issue = (over: object) => ({ issue: 'LAN-1', issueUrl: 'https://linear.app/x/issue/LAN-1', title: 'Upload stops', verdict: 'filed', state: 'Todo', closedAt: null,
      fixedBy: null, fixedAt: null, keys: ['E-1'], people: 3, firstAt: '2026-11-10T00:00:00Z', lookedAt: '2026-11-17T00:00:00Z', ...over });
    const rows = logic.listRows('userissues', { issues: [issue({ closedAt: '2026-11-12T00:00:00Z', state: 'Done', fixedBy: 480 }), issue({ verdict: 'fixed', issue: null, issueUrl: null, fixedBy: 470 }), issue({})] })!;
    expect(states(rows[0]!)).toEqual(['part', 'ok', 'off']);
    expect(rows[0]!.items[0]!.name).toBe('LAN-1: Upload stops');
    expect(rows[0]!.items[2]!.link).toBe('https://github.com/genesis-ai-dev/langquest-next/pull/470');
    expect(field(rows[0]!.items[1]!, 'Fixed by')).toBe('PR 480');
  });

  it('never puts a name or an email from feedback in a square or its detail', () => {
    const rows = logic.listRows('feedback', { items: [
      { id: 'f1', created_at: '2026-11-17T00:00:00Z', kind: 'bug', body: 'It stops', status: null, install_id: 'i-1', context: { screen: 'Record', os: 'android' },
        has_screenshot: true, voice_format: null, voice_ms: null, shared_name: 'Sam Smith', shared_email: 'sam@example.org' },
      { id: 'f2', created_at: '2026-11-16T00:00:00Z', kind: 'idea', body: '', status: 'done', install_id: null, context: null, has_screenshot: false, voice_format: 'm4a', voice_ms: 900, shared_name: null, shared_email: null },
      { id: 'f3', created_at: '2026-11-15T00:00:00Z', kind: 'bug', body: 'x', status: 'seen', install_id: null, context: null, has_screenshot: false, voice_format: null, voice_ms: null, shared_name: null, shared_email: null }
    ] })!;
    expect(states(rows[0]!)).toEqual(['part', 'run', 'ok']);
    expect(rows[0]!.items[0]!.name).toBe('Bug · Record');
    expect(field(rows[0]!.items[2]!, 'Says')).toBe('(a voice note)');
    expect(JSON.stringify(rows)).not.toMatch(/Sam Smith|sam@example\.org/);
  });

  it('keeps the channels in the order of the app languages: failed, not connected, waiting and connected apart', () => {
    const channel = (language: string, over: object) => ({ language, channelId: `UC${language}`, title: language, connectedAt: '2026-11-01T00:00:00Z', section: null,
      branded: true, brandFailed: null, held: 0, videos: 40, latestAt: '2026-11-16T00:00:00Z', ...over });
    const rows = logic.listRows('tutorials', {
      channels: [channel('en', {}), channel('fr', { brandFailed: 'youtube_invalid_grant' }), channel('es', { connectedAt: null }), channel('pt', { held: 2 }), channel('ar', {})],
      waiting: [{ tutorial: 'record', language: 'ar', sha256: 's', title: 't', playlist: 'p', seconds: 60, madeAt: '2026-11-16T00:00:00Z', chosenAt: null, failed: null, failedAt: null, replaces: null }]
    })!;
    expect(rows[0]!.items.map((x) => x.name)).toEqual(['en', 'fr', 'es', 'pt', 'ar']);
    expect(states(rows[0]!)).toEqual(['ok', 'fail', 'none', 'part', 'part']);
    expect(field(rows[0]!.items[4]!, 'Ready to publish')).toBe(1);
    expect(rows[0]!.items[0]!.link).toBe('https://www.youtube.com/channel/UCen');
  });

  it('shows what Claude did with each suggestion and each thing that came in', () => {
    const sug = (over: object) => ({ id: 's', kind: 'script', tutorial: 'record', title: 'Say tap', detail: '', madeAt: '2026-11-16T00:00:00Z', editedAt: null,
      decision: 'accepted', decidedAt: '2026-11-16T01:00:00Z', reason: null, issue: null, issueUrl: null, fix: null, inputs: [], ...over });
    const fix = (state: string) => ({ state, pr: 500, at: '2026-11-16T02:00:00Z', run: null, note: null });
    const rows = logic.listRows('videofeedback', {
      suggestions: [sug({ fix: fix('merged') }), sug({ decision: null }), sug({ fix: fix('failed') }), sug({ decision: 'rejected', reason: 'no' }), sug({ fix: fix('open') })],
      inputs: [{ id: 'i', kind: 'comment', tutorial: null, language: 'fr', at: '2026-11-16T00:00:00Z', ref: null, youtubeId: null, pr: null, text: 'Bien', english: 'Good', reply: null, replyEnglish: null, lookedAt: null, outcome: null },
        { id: 'j', kind: 'code', tutorial: 'record', language: null, at: '2026-11-15T00:00:00Z', ref: 'abc', youtubeId: null, pr: 499, text: 'PR', english: null, reply: null, replyEnglish: null, lookedAt: '2026-11-16T00:00:00Z', outcome: 'no change' }]
    })!;
    expect(states(rows[0]!)).toEqual(['fail', 'part', 'run', 'ok', 'off']);
    expect(rows[0]!.items[0]!.link).toBe('https://github.com/genesis-ai-dev/langquest-next/pull/500');
    expect(states(rows[1]!)).toEqual(['off', 'none']);
    expect(field(rows[1]!.items[1]!, 'Says')).toBe('Good');
  });

  it('draws the videos as a row for each language with each video in the same column, a paused language grey', () => {
    const video = (tutorial: string, language: string, key: string, level: string) => ({ tutorial, language, title: tutorial, states: [{ key, text: key, level }], film: null, marks: [] });
    const rows = logic.listRows('videos', {
      languages: [{ language: 'en', nightly: true, statusAt: null, issues: 1 }, { language: 'fr', nightly: false, statusAt: null, issues: 0 }, { language: 'tl', nightly: true, statusAt: null, issues: 0 }],
      videos: [video('a', 'en', 'current', 'good'), video('b', 'en', 'approve', 'bad'), video('a', 'fr', 'paused', 'info'), video('b', 'fr', 'paused', 'info')]
    })!;
    expect(rows.map((r) => r.label)).toEqual(['en', 'fr']);
    expect(rows.map((r) => r.items.map((x) => x.name))).toEqual([['a', 'b'], ['a', 'b']]);
    expect(rows.map(states)).toEqual([['ok', 'fail'], ['off', 'off']]);
  });

  it('puts each store build on its lane\'s track at its stage, the most urgent build marking the stage', () => {
    const card = (build: string, tone: string, state: string) => ({ title: 'build ' + build, build, version: '2026.1117.1', state, tone, at: '2026-11-17T01:00:00Z', updates: [{ id: 'u' }] });
    const rows = logic.listRows('pipeline', { repo: 'o/r', activeDays: 14, lanes: [{ id: 'ios', title: 'iPhone store builds', notes: [], stages: [
      { id: 'eas', title: 'EAS build', cards: [] },
      { id: 'tf', title: 'TestFlight', cards: [card('53', 'busy', 'In TestFlight'), card('52', 'bad', 'Copy needs a person')] },
      { id: 'review', title: 'App Review', cards: [card('51', 'wait', 'In review for 26 h')] },
      { id: 'store', title: 'App Store', cards: [], unseen: 'App Store Connect is not connected.' }] }] })!;
    expect(rows[0]).toMatchObject({ label: 'iPhone store builds', draw: 'track' });
    expect(states(rows[0]!)).toEqual(['none', 'fail', 'part', 'none']);
    expect(rows[0]!.items[1]!.short).toBe('53 +1');
    expect(rows[0]!.items[1]!.fields.map((f) => f[0])).toEqual(['build 53 (2026.1117.1)', 'Since', 'Updates it takes', 'build 52 (2026.1117.1)', 'Since', 'Updates it takes']);
    expect(rows[0]!.items[3]!.fields).toEqual([['Builds', 'App Store Connect is not connected.']]);
  });

  it('draws errors a day oldest first, with what shipped each day, and a crash day red', () => {
    const rows = logic.listRows('releases', { hosts: [], migrations: {}, notes: [],
      errorsByDay: [{ day: '2026-11-17', errors: 5, crashes: 0, installs: 3 }, { day: '2026-11-16', errors: 9, crashes: 2, installs: 4 }],
      timeline: [{ at: '2026-11-17T08:00:00Z', kind: 'merge', text: 'PR 486' }, { at: '2026-11-17T09:00:00Z', kind: 'deploy', text: 'Worker' }] })!;
    expect(rows[0]!.draw).toBe('line');
    expect(rows[0]!.items.map((x) => [x.name, x.s, x.v, x.crashes, x.shipped])).toEqual([['2026-11-16', 'fail', 9, 2, 0], ['2026-11-17', 'run', 5, 0, 2]]);
    expect(rows[0]!.items[1]!.fields).toContainEqual(['merge', 'PR 486']);
  });

  it('puts each key on its days left: expired and 7 days red, 30 days amber, no date last', () => {
    const at = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    const rows = logic.listRows('expiry', { notes: [], items: [{ what: 'Play key', expires: at(90), source: 'Google' }, { what: 'Hand key', expires: null, source: 'apps/admin/expiry.json' },
      { what: 'Apple cert', expires: at(20), source: 'Apple' }, { what: 'Old token', expires: at(-2), source: 'Cloudflare' }, { what: 'Soon', expires: at(5), source: 'GitHub' }] })!;
    expect(rows[0]!.draw).toBe('axis');
    expect(rows[0]!.items.map((x) => [x.name, x.s])).toEqual([['Old token', 'fail'], ['Soon', 'fail'], ['Apple cert', 'part'], ['Play key', 'ok'], ['Hand key', 'none']]);
    expect(field(rows[0]!.items[2]!, 'Days left')).toBe(20);
  });

  it('shows the App Store versions and builds oldest first, a rejection red', () => {
    const rows = logic.listRows('appstore', { notes: [], testflightCrashes: null, reviews: null,
      versions: [{ version: '2026.1117', platform: 'IOS', state: 'WAITING_FOR_REVIEW', at: '2026-11-17T00:00:00Z' }, { version: '2026.1105', platform: 'IOS', state: 'REJECTED', at: '2026-11-05T00:00:00Z' },
        { version: '2026.1020', platform: 'IOS', state: 'READY_FOR_SALE', at: '2026-10-20T00:00:00Z' }],
      builds: [{ version: '2026.1117', build: '53', state: 'PROCESSING', uploadedAt: '2026-11-17T00:00:00Z', expired: false }, { version: '2026.1001', build: '40', state: 'VALID', uploadedAt: '2026-10-01T00:00:00Z', expired: true }] })!;
    expect(rows.map((r) => states(r))).toEqual([['ok', 'fail', 'part'], ['off', 'run']]);
    expect(rows[1]!.items[1]!.name).toBe('2026.1117 (53)');
  });

  it('turns a long row into 100 squares, worst first, keeping every state that has an item', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...logic.LIST_ORDER), { minLength: 1, maxLength: 3000 }), (ss) => {
      const items = ss.map((s) => ({ s }));
      const cells = logic.shareCells(items, 100);
      expect(cells).toHaveLength(100);
      const ranks = cells.map((c) => logic.LIST_ORDER.indexOf(c));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      for (const s of new Set(ss)) {
        const got = cells.filter((c) => c === s).length;
        expect(got).toBeGreaterThanOrEqual(1);
        // Within a square or two of its share; the squares a rare state takes come from the largest.
        expect(Math.abs(got - (ss.filter((x) => x === s).length * 100) / ss.length)).toBeLessThan(logic.LIST_ORDER.length + 1);
      }
    }));
    expect(logic.shareCells([], 100)).toEqual([]);
    expect(logic.shareCells([{ s: 'fail' }, ...Array.from({ length: 4999 }, () => ({ s: 'ok' }))], 100).filter((c) => c === 'fail')).toHaveLength(1);
  });

  it('puts the pictures in the page, opened from a square, and leaves the bars to the charts', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function listRows(part, d)');
    expect(html).toContain("const pic = listPicture(id, s.data);");
    expect(html).toContain("e.target.closest('.chart:not(.lstbox) svg')");
    expect(html).not.toMatch(/ style="/);
  });
});
