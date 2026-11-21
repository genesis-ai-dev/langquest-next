import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { ISSUE_LOGIC, ISSUE_SCRIPT } from '../src/pageIssues';
import { RESEARCH_LOGIC, RESEARCH_SCRIPT } from '../src/pageResearch';
import { RESEARCH_TEAM } from '../src/researchTeam';
import { researchAlerts, researchWaiting, type Research } from '../src/sources/ops';

/** The Research page (docs/research-team.md): the team's report of a day, its map and week, and one card for each thing found. */
type Row = Record<string, unknown>;
interface Way { tab: string; pill: [string, string] }
const logic = new Function(`${RESEARCH_LOGIC}; return { researchWay, researchTabs, researchOrder, researchReport, researchDays, researchSays, choiceText, weekOf };`)() as {
  researchWay: (item: Row, fix: Row | null, notes: Row[] | null) => Way;
  researchTabs: (ways: Way[], chosen: string | null) => { count: Record<string, number>; tab: string };
  researchOrder: (items: Row[]) => Row[];
  researchReport: (reports: Row[], day: string | null) => Row | null;
  researchDays: (reports: Row[]) => string[];
  researchSays: (item: Row) => string;
  choiceText: (c: Row) => string;
  weekOf: (team: readonly Row[]) => { day: string; beats: Row[] }[];
};

/** The drawing code with the page's helpers as plain stand-ins, as in issues.test.ts. */
const draw = new Function(`
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const when = (iso) => iso ? 'then' : 'never', num = String, stat = (v, l) => '<b>' + v + ' ' + l + '</b>', NOW = '', LAST_WEEK = '';
  const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';
  const PR_URL = 'https://github.com/o/r/pull/', prLink = (p) => 'PR ' + p.number;
  const pictureStrip = (p) => p && p.length ? '<i>pictures</i>' : '';
  const detailParts = (t) => String(t || '').split('|'), cardId = (a) => a.kind, languageName = (c) => 'language ' + c;
  const cardLink = (x) => '<a href="' + x.link + '">Open</a>', vicon = (k) => '<i>' + k + '</i>';
  const FIX_STATE = { open: 'It merges itself.', working: 'Claude writes it.' }, ADMIN_LEVEL = { fails: 'bad' }, SUGGESTION_KINDS = { voice: 'Voice' };
  const document = { addEventListener() {}, getElementById() { return null; } };
  const RESEARCH_TEAM = ${JSON.stringify(RESEARCH_TEAM)};
  ${ISSUE_LOGIC}
  ${ISSUE_SCRIPT}
  ${RESEARCH_LOGIC}
  ${RESEARCH_SCRIPT}
  return { researchHtml };
`)() as { researchHtml: (d: Row) => string };

const ask = { why: 'A package change waits for a developer.', choices: [{ label: 'Upgrade hono now', then: 'The fix team changes only hono.' }, { label: 'Wait', then: null }] };
const item = (over: Row = {}): Row => ({
  tag: 'hono-cookie-hole', title: 'A hole in hono lets a bad cookie stop the Worker', found: 'hono 4.6.1 reads cookies slowly.', why: 'One person can stop the Worker.',
  places: ['apps/web/worker/index.ts:88'], links: ['https://github.com/advisories/GHSA-aaaa'], steps: null, decision: 'recommend', action: 'ask',
  issue: 'LAN-80', issueUrl: 'https://linear.app/t/issue/LAN-80', handedAt: null, firstAt: '2026-11-20T13:40:00Z', at: '2026-11-21T13:40:00Z',
  beat: 'security', kind: 'vulnerability', severity: 'high', package: 'hono', from: '4.6.1', to: '4.6.5', deadline: null, ask, ...over
});
const report = (over: Row = {}): Row => ({
  day: '2026-11-21', at: '2026-11-21T14:10:00Z', runUrl: 'https://github.com/o/r/actions/runs/1', headline: 'One hole needs an upgrade.', summary: ['hono has a high hole.'],
  beats: [{ id: 'security', title: 'Security holes', model: 'sonnet', checked: '14 holes.', result: 'found', note: null }, { id: 'versions', title: 'New versions', model: 'haiku', checked: '22 packages.', result: 'clear', note: null }],
  lead: 'ok', minutes: 21.4, turns: 40, counts: { found: 1, recommended: 1, rejected: 0, watching: 0, toFix: 0, toAsk: 1 }, facts: { packages: 1200, advisories: 3, outdated: 22, actions: 14 }, ...over
});

describe('where a research item is', () => {
  it('waits on you for a choice, goes to the fix team once you chose, and shows a fix', () => {
    expect(logic.researchWay(item(), null, [])).toEqual({ tab: 'you', pill: ['Your choice', 'you'] });
    expect(logic.researchWay(item(), null, [{ state: 'waiting' }])).toEqual({ tab: 'team', pill: ['Claude acts next', 'claude'] });
    expect(logic.researchWay(item({ action: 'fix' }), null, [])).toEqual({ tab: 'team', pill: ['Waits on the fix team', ''] });
    expect(logic.researchWay(item({ action: 'fix', handedAt: '2026-11-21T00:00:00Z' }), null, [])).toMatchObject({ pill: ['The fix team has it', ''] });
    expect(logic.researchWay(item(), { decision: 'merge', pr: 9 }, [])).toMatchObject({ tab: 'fixed', pill: ['Fixed by Claude', 'done'] });
    expect(logic.researchWay(item(), { decision: 'review', pr: 9 }, [])).toMatchObject({ tab: 'you', pill: ['Fix waits on you', 'you'] });
    expect(logic.researchWay(item({ decision: 'watch' }), null, null).tab).toBe('watch');
    expect(logic.researchWay(item({ decision: 'reject' }), null, null).tab).toBe('reject');
  });

  it('opens the tab chosen while it holds an item, else the first that does', () => {
    const ways = [logic.researchWay(item({ decision: 'watch' }), null, null), logic.researchWay(item({ decision: 'reject' }), null, null)];
    expect(logic.researchTabs(ways, null)).toMatchObject({ tab: 'watch', count: { you: 0, watch: 1, reject: 1, all: 2 } });
    expect(logic.researchTabs(ways, 'reject').tab).toBe('reject');
    expect(logic.researchTabs(ways, 'you').tab).toBe('watch');
    expect(logic.researchTabs([], 'you').tab).toBe('all');
  });

  it('lists the worst first, then the newest', () => {
    const out = logic.researchOrder([item({ tag: 'a', severity: 'low' }), item({ tag: 'b', severity: 'critical' }), item({ tag: 'c', severity: 'low', firstAt: '2026-11-21T00:00:00Z' }), item({ tag: 'd', severity: null })]);
    expect(out.map((i) => i.tag)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('says the upgrade first, and nothing to do for a watched or rejected item', () => {
    expect(logic.researchSays(item())).toBe('Upgrade hono from 4.6.1 to 4.6.5.');
    expect(logic.researchSays(item({ package: null }))).toBe('');
    expect(logic.researchSays(item({ decision: 'watch' }))).toMatch(/^Nothing now/);
    expect(logic.choiceText(ask.choices[0]!)).toBe('I choose: Upgrade hono now. The fix team changes only hono.');
    expect(logic.choiceText(ask.choices[1]!)).toBe('I choose: Wait.');
  });
});

describe('the report of a day and the week', () => {
  it('takes the day picked, else the newest, and of two runs on a day the one with more subjects', () => {
    const reports = [report({ at: '2026-11-21T20:00:00Z', beats: [{ id: 'platform' }] }), report(), report({ day: '2026-11-20', headline: 'Clear.' })];
    expect(logic.researchReport(reports, null)?.headline).toBe('One hole needs an upgrade.');
    expect(logic.researchReport(reports, '2026-11-20')?.headline).toBe('Clear.');
    expect(logic.researchReport(reports, '2026-01-01')?.day).toBe('2026-11-21');
    expect(logic.researchReport([], null)).toBeNull();
    expect(logic.researchDays(reports)).toEqual(['2026-11-21', '2026-11-20']);
  });

  it('puts each weekly subject on its day and both Saturday ones on Saturday', () => {
    const week = logic.weekOf(RESEARCH_TEAM);
    expect(week.map((d) => d.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(week.find((d) => d.day === 'mon')?.beats.map((b) => b.id)).toEqual(['packages']);
    expect(week.find((d) => d.day === 'sat')?.beats.map((b) => b.id)).toEqual(['alternatives', 'supply-chain']);
    expect(week.find((d) => d.day === 'sun')?.beats).toEqual([]);
  });
});

describe('the Research page', () => {
  it('draws the headline, the map, the week, each scout and a card with choice buttons', () => {
    const html = draw.researchHtml({ items: [item()], reports: [report()], notes: {}, fixes: {} });
    expect(html).toContain('<h3>One hole needs an upgrade.</h3>');
    expect(html).toContain('1200 packages · 3 known holes · 22 with a new version');
    expect(html).toContain('<b>Each day:</b> Security holes, New versions, Same mistake in other places');
    expect(html).toContain('What each scout looked at');
    expect(html).toContain('Upgrade hono from 4.6.1 to 4.6.5.');
    expect(html).toContain('data-rchoice="LAN-80" data-text="I choose: Upgrade hono now. The fix team changes only hono."');
    expect(html).toContain('github.com/advisories');
    expect(html).toContain('The team took 21 minutes and 40 turns.');
  });

  it('shows no choice once an instruction was sent, and no buttons before the item has an issue', () => {
    expect(draw.researchHtml({ items: [item()], reports: [], notes: { 'LAN-80': [{ state: 'waiting', text: 'x' }] }, fixes: {} })).not.toContain('data-rchoice');
    expect(draw.researchHtml({ items: [item({ issue: null, issueUrl: null })], reports: [], notes: {}, fixes: {} })).not.toContain('data-rchoice');
  });

  it('says there is no report yet and still draws the week', () => {
    const html = draw.researchHtml({ items: [], reports: [], notes: {}, fixes: {} });
    expect(html).toContain('No report yet.');
    expect(html).toContain('Nothing found yet.');
    expect(html).toContain('Store and platform rules');
  });

  it('escapes what Claude wrote', () => {
    const html = draw.researchHtml({ items: [item({ title: '<img src=x onerror=alert(1)>' })], reports: [report({ headline: '<script>x</script>' })], notes: {}, fixes: {} });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x');
  });

  it('is in the page', async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function researchHtml(d)');
    expect(html).toContain('const RESEARCH_TEAM = [');
  });
});

describe('the lines the research team adds', () => {
  const r = (over: Partial<Research> = {}): Research => ({ items: [], lastAt: null, reports: [], notes: {}, fixes: {}, ...over });
  const it0 = item() as unknown as Research['items'][number];
  const fresh = report({ at: new Date().toISOString() }) as unknown as NonNullable<Research['reports']>[number];

  it('says a serious hole and a choice that waits, and nothing once it is fixed or told', () => {
    expect(researchAlerts(r({ items: [it0], reports: [fresh] })).map((a) => [a.key, a.level])).toEqual([['research-security-hole', 'problem'], ['research-waits', 'watch']]);
    expect(researchAlerts(r({ items: [it0], reports: [fresh], fixes: { 'LAN-80': { decision: 'merge', pr: 9 } as never } }))).toEqual([]);
    expect(researchWaiting(r({ items: [it0], notes: { 'LAN-80': [{ state: 'waiting' } as never] } }))).toEqual([]);
  });

  it('says the team stopped when its newest report is older than 2 days, and nothing before its first', () => {
    const old = { ...fresh, at: new Date(Date.now() - 51 * 3_600_000).toISOString() };
    expect(researchAlerts(r({ reports: [old] })).map((a) => a.key)).toEqual(['research-stopped']);
    expect(researchAlerts(r({ reports: [] }))).toEqual([]);
    expect(researchAlerts(r({ reports: [fresh] }))).toEqual([]);
  });
});
