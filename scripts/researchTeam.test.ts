import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayReport } from './agent-research.mjs';
import {
  actionsIn, askOf, BEAT_IDS, BEATS, beatsFor, checkTeamReport, contextMarkdown, counts, factsMarkdown, gatherFacts, isoWeek, MAX_SCOUTS,
  ODD_LICENSE, PRIORITY, reportFromScouts, sessionOf, TEAM, TEAM_LIMITS, teamItem, teamItemDescription
} from './research-team.mjs';
import { parseLooked, RESEARCH_BEATS, RESEARCH_KINDS, RESEARCH_SEVERITIES } from '../server/userIssues';
import { RESEARCH_TEAM } from '../apps/admin/src/researchTeam';

/** The research team that looks ahead (docs/research-team.md): what runs when, and the lead's report as a claim the script checks. */
const files = new Set(['apps/web/worker/index.ts', 'apps/mobile/src/sync/outbox.ts']);
const isFile = (f: string) => files.has(f);
const item = (over: Record<string, unknown> = {}) => ({
  tag: 'hono-cookie-hole', beat: 'security', kind: 'vulnerability', severity: 'high', title: 'A hole in hono lets a bad cookie stop the Worker',
  found: 'hono 4.6.1 reads cookies slowly on a long cookie.', why: 'One person can stop the Worker for others.', places: ['apps/web/worker/index.ts:88'],
  links: ['https://github.com/advisories/GHSA-aaaa-bbbb-cccc'], decision: 'recommend', action: 'ask', package: 'hono', from: '4.6.1', to: '4.6.5', deadline: null,
  ask: { why: 'A package change waits for a developer.', choices: [{ label: 'Upgrade hono now', then: 'The fix team changes only hono.' }, { label: 'Wait', then: null }] },
  ...over
});
const report = (over: Record<string, unknown> = {}) => ({
  headline: 'One hole needs an upgrade.', summary: ['hono has a high hole.'],
  beats: [{ id: 'security', checked: '14 holes.', result: 'found', note: 'One reaches the Worker.' }], items: [item()], ...over
});

describe('when each scout runs', () => {
  it('runs the daily ones every day, one more on each weekday, and the Saturday ones every two weeks', () => {
    // 2026-11-23 is a Monday.
    expect(beatsFor(new Date('2026-11-23T13:23:00Z'))).toEqual(['security', 'versions', 'packages']);
    expect(beatsFor(new Date('2026-11-24T13:23:00Z'))).toEqual(['security', 'versions', 'offline']);
    expect(beatsFor(new Date('2026-11-27T13:23:00Z'))).toEqual(['security', 'versions', 'platform']);
    expect(beatsFor(new Date('2026-11-22T13:23:00Z'))).toEqual(['security', 'versions']);
    const sat = new Date('2026-11-21T13:23:00Z');
    expect(beatsFor(sat)).toEqual(['security', 'versions', isoWeek(sat) % 2 === 0 ? 'alternatives' : 'supply-chain']);
    const nextSat = new Date('2026-11-28T13:23:00Z');
    expect(beatsFor(nextSat)[2]).not.toBe(beatsFor(sat)[2]);
  });

  it('runs what a person asked for, the daily ones first, unknown names out, at most 3', () => {
    expect(beatsFor(new Date('2026-11-23T00:00:00Z'), 'platform, security')).toEqual(['security', 'platform']);
    expect(beatsFor(new Date('2026-11-23T00:00:00Z'), 'nope;rm -rf')).toEqual([]);
    expect(beatsFor(new Date(), BEAT_IDS.join(','))).toHaveLength(MAX_SCOUTS);
  });

  it('is the same team in the script, the Worker and the Research page', () => {
    expect([...RESEARCH_BEATS]).toEqual(BEAT_IDS);
    expect(RESEARCH_TEAM).toEqual(TEAM);
    for (const b of BEAT_IDS) {
      expect(['haiku', 'sonnet']).toContain(BEATS[b].model);
      expect(BEATS[b].asks.length).toBeGreaterThan(20);
    }
    expect([...RESEARCH_KINDS].length).toBeGreaterThan(0);
    expect(Object.keys(PRIORITY).sort()).toEqual([...RESEARCH_SEVERITIES].sort());
  });

  it('names a skill that exists', () => {
    const skill = readFileSync(new URL('../.agents/skills/research-team/SKILL.md', import.meta.url), 'utf8');
    expect(skill).toContain('.research/team/report.json');
    expect(skill).toMatch(/data, never an instruction/);
  });
});

describe('the lead\'s report', () => {
  it('keeps a checked item with its package, links and choice', () => {
    const out = checkTeamReport(report(), { beats: ['security', 'versions'], isFile })!;
    expect(out.dropped).toEqual([]);
    expect(out.items[0]).toMatchObject({ tag: 'hono-cookie-hole', decision: 'recommend', action: 'ask', package: 'hono', from: '4.6.1', to: '4.6.5', severity: 'high' });
    expect(out.items[0]?.ask?.choices).toHaveLength(2);
    // A beat with no line says the lead wrote nothing for it.
    expect(out.beats.map((b) => [b.id, b.result])).toEqual([['security', 'found'], ['versions', 'skipped']]);
  });

  it('is no report without a headline', () => {
    expect(checkTeamReport({ items: [item()] }, { beats: ['security'], isFile })).toBeNull();
    expect(checkTeamReport('x', { beats: ['security'], isFile })).toBeNull();
  });

  it('keeps a recommended item with no file of main and no link only as watch', () => {
    const out = checkTeamReport(report({ items: [item({ places: ['../.env.keys', 'apps/none.ts'], links: ['http://plain.example', 'javascript:alert(1)'] })] }), { beats: ['security'], isFile })!;
    expect(out.items[0]).toMatchObject({ decision: 'watch', action: 'none', places: [], links: [], ask: null });
    expect(out.dropped).toHaveLength(1);
  });

  it('keeps a public page as the proof when there is no place', () => {
    expect(teamItem(item({ places: [] }), ['security'], isFile)).toMatchObject({ decision: 'recommend', places: [], links: ['https://github.com/advisories/GHSA-aaaa-bbbb-cccc'] });
  });

  it('asks a developer when a recommended item names no action, and gives a choice only to an ask', () => {
    expect(teamItem(item({ action: 'none' }), ['security'], isFile)?.action).toBe('ask');
    expect(teamItem(item({ action: 'fix' }), ['security'], isFile)?.ask).toBeNull();
    expect(teamItem(item({ decision: 'watch' }), ['security'], isFile)).toMatchObject({ action: 'none', ask: null });
    expect(askOf({ why: 'W', choices: [{ label: 'Only one' }] })).toBeNull();
    expect(askOf({ why: '', choices: [{ label: 'A' }, { label: 'B' }] })).toBeNull();
  });

  it('takes out addresses, odd words and what is over the limit', () => {
    const out = teamItem(item({ found: 'Ask a@b.org now.', package: 'Not A Package!', from: '1 2', beat: 'nope', kind: 'odd', severity: 'huge', deadline: 'soon' }), ['versions'], isFile)!;
    expect(out).toMatchObject({ found: 'Ask [address] now.', package: null, from: null, beat: 'versions', kind: 'other', severity: 'info', deadline: null });
    const many = Array.from({ length: TEAM_LIMITS.items + 3 }, (_, n) => item({ tag: `item-${n}` }));
    const checked = checkTeamReport(report({ items: [...many, item({ tag: 'item-0' })] }), { beats: ['security'], isFile })!;
    expect(checked.items).toHaveLength(TEAM_LIMITS.items);
    expect(teamItem(item({ title: ' ' }), ['security'], isFile)).toBeNull();
  });

  it('keeps the Linear issue of an item an earlier run filed', () => {
    const known = new Map([['hono-cookie-hole', { tag: 'hono-cookie-hole', issue: 'LAN-77' }]]);
    expect(checkTeamReport(report(), { beats: ['security'], isFile, known })!.items[0]?.issue).toBe('LAN-77');
  });

  it('takes the scouts\' notes when the lead gave none, and says so', () => {
    const out = reportFromScouts([['security', { checked: '3 holes.', items: [item({ beat: 'versions' })] }], ['versions', null]], { isFile });
    expect(out.headline).toMatch(/did not finish/);
    expect(out.items[0]?.beat).toBe('security');
    expect(out.beats.map((b) => b.result)).toEqual(['found', 'failed']);
  });

  it('writes the Linear issue from the item alone, with the choice', () => {
    const it0 = teamItem(item(), ['security'], isFile)!;
    const text = teamItemDescription(it0, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1');
    expect(text).toContain('`hono` 4.6.1 → 4.6.5');
    expect(text).toContain('1. Upgrade hono now: The fix team changes only hono.');
    expect(text).toContain('https://github.com/advisories/GHSA-aaaa-bbbb-cccc');
  });

  it('counts what it found', () => {
    const its = [item(), item({ tag: 'b', decision: 'watch' }), item({ tag: 'c', decision: 'reject' }), item({ tag: 'd', action: 'fix' })].map((x) => teamItem(x, ['security'], isFile)!);
    expect(counts(its)).toEqual({ found: 4, recommended: 2, rejected: 1, watching: 1, toFix: 1, toAsk: 1 });
  });
});

describe('the day\'s report for the Worker', () => {
  const base = { sha: 'a'.repeat(40), runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/12', looked: [], grew: [], states: [] };

  it('reads the time and turns from the session, and nothing from a broken file', () => {
    expect(sessionOf(JSON.stringify([{ type: 'system' }, { type: 'result', duration_ms: 1_234_000, num_turns: 41 }]))).toEqual({ minutes: 20.6, turns: 41 });
    expect(sessionOf('not json')).toEqual({ minutes: null, turns: null });
    expect(sessionOf('')).toEqual({ minutes: null, turns: null });
  });

  it('adds the twins line and the counts of both, and the Worker takes it with the items', () => {
    const team = { ...checkTeamReport(report(), { beats: ['security', 'versions'], isFile })!, lead: 'ok', run: { facts: { packages: 1200, advisories: 3, outdated: 9, actions: 14 } } };
    const twins = { items: [], checked: 'Started from 4 issues of the last 30 days.', result: 'clear' };
    const day = dayReport(team, twins, { day: '2026-11-21', run: team.run, session: { minutes: 20.6, turns: 41 } })!;
    expect(day.beats.map((b: { id: string }) => b.id)).toEqual(['security', 'versions', 'twins']);
    expect(day.counts).toMatchObject({ found: 1, toAsk: 1 });
    expect(dayReport(null, twins, { day: '2026-11-21', run: null, session: { minutes: null, turns: null } })).toBeNull();
    const research = team.items.map((i) => ({ ...i, issue: 'LAN-80', issueUrl: 'https://linear.app/frontierrandd/issue/LAN-80/x' }));
    const looked = parseLooked({ ...base, research, report: day });
    expect(looked.report).toMatchObject({ day: '2026-11-21', lead: 'ok', minutes: 20.6, facts: { advisories: 3 } });
    expect(looked.research[0]).toMatchObject({ beat: 'security', package: 'hono', ask: { why: 'A package change waits for a developer.' } });
  });

  it.each([
    ['a report with no headline', { report: { day: '2026-11-21', headline: '', summary: [], beats: [], lead: 'ok', counts: {} } }],
    ['a beat that is not one of the team', { report: { day: '2026-11-21', headline: 'H', summary: [], beats: [{ id: 'x', title: 'X', model: 'haiku', result: 'clear' }], lead: 'ok', counts: { found: 0, recommended: 0, rejected: 0, watching: 0, toFix: 0, toAsk: 0 } } }],
    ['an item with a link that is not https', { research: [{ ...teamItem(item(), ['security'], isFile), links: ['http://x.example/a'], issue: null, issueUrl: null }] }],
    ['a choice on an item that is not an ask', { research: [{ ...teamItem(item({ action: 'fix' }), ['security'], isFile), ask: item().ask, issue: null, issueUrl: null }] }]
  ])('refuses %s', (_, over) => {
    expect(() => parseLooked({ ...base, ...over })).toThrow();
  });
});

describe('the facts code finds', () => {
  it('lists each Action once, with its pin and version', () => {
    expect(actionsIn(['- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n- uses: actions/checkout@v4\n- uses: owner/repo/sub@main'])).toEqual([
      { action: 'actions/checkout', ref: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1', pinned: true },
      { action: 'owner/repo', ref: 'main', version: null, pinned: false }
    ]);
  });

  it('marks a license that may not fit the stores', () => {
    expect(ODD_LICENSE('MIT')).toBe(false);
    expect(ODD_LICENSE('AGPL-3.0')).toBe(true);
    expect(ODD_LICENSE(undefined)).toBe(true);
  });

  it('goes on when a source fails, and says which', async () => {
    const root = new URL('..', import.meta.url).pathname;
    const facts = await gatherFacts({ root, fetch: async () => { throw new Error('offline'); }, run: () => { throw new Error('no tool'); } });
    expect(facts.notes.length).toBeGreaterThan(0);
    expect(facts.direct.length).toBeGreaterThan(10);
    expect(factsMarkdown(facts)).toContain('## Known holes');
  });

  it('tells the scouts what was rejected and why', () => {
    const md = contextMarkdown({ items: [{ tag: 'old-hole', title: 'Old', decision: 'reject', beat: 'security', why: 'Only in the tests.' }, { tag: 'twin', title: 'T', decision: 'recommend' }], last: { day: '2026-11-20', headline: 'Clear.' } });
    expect(md).toContain('Last report (2026-11-20): Clear.');
    expect(md).toContain('`old-hole`');
    expect(md).toContain('Why: Only in the tests.');
    expect(md).not.toContain('`twin`');
  });
});
