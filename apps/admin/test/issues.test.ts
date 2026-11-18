import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { ISSUE_LOGIC, ISSUE_SCRIPT } from '../src/pageIssues';

interface Way { tab: string; pill: string; level: string; at: number; pr: { number: number } | null }
type Row = Record<string, unknown>;
const logic = new Function(`${ISSUE_LOGIC}; return { issueSource, issueWay, issueTabs, videoWay, ISSUE_STEPS, VIDEO_STEPS };`)() as {
  issueSource: (keys: string[]) => string;
  issueWay: (r: Row, prs: Row[] | null) => Way;
  issueTabs: (ways: { tab: string }[], chosen: string | null) => { count: Record<string, number>; tab: string };
  videoWay: (a: Row) => { at: number };
  ISSUE_STEPS: [string, string][]; VIDEO_STEPS: [string, string][];
};

/** The drawing code with the page's helpers as plain stand-ins, so a card's words can be read without a browser. */
const draw = new Function(`
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const when = (iso) => iso ? 'then' : 'never', num = String, stat = () => '', NOW = '', LAST_WEEK = '';
  const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';
  const PR_URL = 'https://github.com/o/r/pull/', prLink = (p) => 'PR ' + p.number;
  const pictureStrip = (p) => p && p.length ? '<i>pictures</i>' : '';
  const detailParts = (t) => String(t || '').split('|'), cardId = (a) => a.kind, languageName = (c) => 'language ' + c;
  const cardLink = (x) => '<a href="' + x.link + '">Open</a>';
  const FIX_STATE = { open: 'It merges itself.', working: 'Claude writes it.' }, ADMIN_LEVEL = { fails: 'bad' }, SUGGESTION_KINDS = { voice: 'Voice' };
  const document = { addEventListener() {} };
  let fixData = null;
  ${ISSUE_LOGIC}
  ${ISSUE_SCRIPT}
  return { adminCard, userIssuesHtml, fixes: (f) => { fixData = f; } };
`)() as { adminCard: (a: Row) => string; userIssuesHtml: (d: Row) => string; fixes: (f: unknown) => void };

const issue = (over: Row = {}): Row => ({
  issue: 'LAN-9', issueUrl: 'https://linear.app/t/issue/LAN-9', title: 'A thing fails', verdict: 'filed', state: 'Todo', closedAt: null,
  fixedBy: null, fixedAt: null, keys: ['error:TypeError:library'], people: 2, firstAt: '2026-11-10T00:00:00Z', lookedAt: '2026-11-17T00:00:00Z', ...over
});
const pr = (number: number, state: 'open' | 'merged', issues: string[], mergedAt: string | null = null): Row => ({ number, title: 'A fix', url: 'https://github.com/o/r/pull/' + number, state, mergedAt, issues });

describe('where a user issue is', () => {
  it('names where the watch found it from its first key', () => {
    expect(logic.issueSource(['error:TypeError:x'])).toBe('Phones and browsers');
    expect(logic.issueSource(['transfer:down:http_500'])).toBe('Phones and browsers');
    expect(logic.issueSource(['job:projection:stopped'])).toBe('Server jobs');
    expect(logic.issueSource(['worker:/api/agent:5xx'])).toBe('Workers and traffic');
    expect(logic.issueSource(['feedback:abc'])).toBe('A person sent it');
    expect(logic.issueSource(['ops:backup-late'])).toBe('A line on this dashboard');
    expect(logic.issueSource([])).toBe('');
    expect(logic.issueSource(['other:x'])).toBe('');
  });

  it('waits on a person only when a pull request that names it is open', () => {
    expect(logic.issueWay(issue(), [])).toMatchObject({ tab: 'nofix', pill: 'No fix yet', at: 3, pr: null });
    expect(logic.issueWay(issue(), [pr(7, 'open', ['LAN-8'])])).toMatchObject({ tab: 'nofix' });
    expect(logic.issueWay(issue(), [pr(7, 'open', ['LAN-9'])])).toMatchObject({ tab: 'you', pill: 'Waits on you', level: 'you', at: 4, pr: { number: 7 } });
  });

  it('says only Open before the pull requests are read', () => {
    expect(logic.issueWay(issue(), null)).toMatchObject({ tab: 'open', pill: 'Open', at: 3 });
  });

  it('is merged with its newest merged pull request, and a newer open one waits on a person again', () => {
    const merged = [pr(5, 'merged', ['LAN-9'], '2026-11-12T00:00:00Z'), pr(6, 'merged', ['LAN-9'], '2026-11-14T00:00:00Z')];
    expect(logic.issueWay(issue(), merged)).toMatchObject({ tab: 'merged', pill: 'Merged', at: 5, pr: { number: 6 } });
    expect(logic.issueWay(issue(), [...merged, pr(7, 'open', ['LAN-9'])])).toMatchObject({ tab: 'you', pr: { number: 7 } });
  });

  it('is closed with every step done when Linear closed it, and has no steps when Linear dropped it or the watch found it already fixed', () => {
    const closed = issue({ closedAt: '2026-11-15T00:00:00Z', state: 'Live', fixedBy: 5, fixedAt: '2026-11-14T00:00:00Z', verdict: 'fixed' });
    expect(logic.issueWay(closed, [])).toMatchObject({ tab: 'closed', pill: 'Closed', level: 'done', at: logic.ISSUE_STEPS.length + 1, pr: { number: 5 } });
    expect(logic.issueWay({ ...closed, state: 'Duplicate', fixedBy: null }, [])).toMatchObject({ tab: 'closed', pill: 'Duplicate', at: 0, pr: null });
    expect(logic.issueWay({ ...closed, state: 'Canceled' }, [])).toMatchObject({ pill: 'Canceled', at: 0 });
    expect(logic.issueWay(issue({ issue: null, issueUrl: null, verdict: 'fixed', fixedBy: 4, fixedAt: '2026-11-09T00:00:00Z' }), [])).toMatchObject({ tab: 'closed', pill: 'Already fixed', at: 0, pr: { number: 4 } });
  });

  it('opens the first tab that holds an issue, and keeps a chosen tab while it holds one', () => {
    const ways = [{ tab: 'nofix' }, { tab: 'nofix' }, { tab: 'closed' }];
    expect(logic.issueTabs(ways, null)).toEqual({ count: { you: 0, nofix: 2, open: 0, merged: 0, closed: 1, all: 3 }, tab: 'nofix' });
    expect(logic.issueTabs(ways, 'closed').tab).toBe('closed');
    expect(logic.issueTabs(ways, 'all').tab).toBe('all');
    expect(logic.issueTabs(ways, 'you').tab).toBe('nofix');
    expect(logic.issueTabs([], null).tab).toBe('all');
  });
});

describe('where a question about a tutorial video is', () => {
  const card = (over: Row = {}): Row => ({ kind: 'held', title: 'T', detail: 'D', at: null, who: 'claude', next: 'N', instruct: 'The film was held.', ...over });
  const told = (fix: Row | null): Row => ({ at: '2026-11-17T00:00:00Z', text: 'Do this.', looked: true, fix });

  it('waits on Claude, then on a person, then on the change and its merge', () => {
    expect(logic.videoWay(card())).toEqual({ at: 2 });
    expect(logic.videoWay(card({ who: 'you' }))).toEqual({ at: 3 });
    expect(logic.videoWay(card({ instructed: told(null) }))).toEqual({ at: 4 });
    expect(logic.videoWay(card({ instructed: told({ state: 'working' }) }))).toEqual({ at: 4 });
    expect(logic.videoWay(card({ instructed: told({ state: 'open' }) }))).toEqual({ at: 5 });
    expect(logic.videoWay(card({ instructed: told({ state: 'merged' }) }))).toEqual({ at: logic.VIDEO_STEPS.length + 1 });
    expect(logic.videoWay(card({ instructed: told({ state: 'closed' }) }))).toEqual({ at: 3 });
  });

  it('has no steps where there is nothing to tell Claude', () => {
    expect(logic.videoWay({ kind: 'publish', who: 'you' })).toEqual({ at: 0 });
    expect(logic.videoWay({ kind: 'approve', who: 'you', suggestion: { id: 's' } })).toEqual({ at: 3 });
  });
});

describe('the cards', () => {
  it('draws a user issue with its lines, its step, and the pull request to review', () => {
    draw.fixes({ state: 'ok', data: { prs: [pr(7, 'open', ['LAN-9'])] } });
    const html = draw.userIssuesHtml({ issues: [issue(), issue({ issue: 'LAN-10', issueUrl: 'https://linear.app/t/issue/LAN-10', keys: ['job:x:stopped'] })], open: 2, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(html).toContain('<button type="button" data-itab="you" aria-pressed="true">Waits on you<span class="count">1</span></button>');
    expect(html).toContain('<button type="button" data-itab="nofix" aria-pressed="false">No fix yet<span class="count">1</span></button>');
    expect(html).not.toContain('data-itab="open"');
    for (const label of ['Context', 'Issue', 'Solution']) expect(html).toContain('<dt>' + label + '</dt>');
    expect(html).toContain('Step 4 of 5: the fix waits on its merge');
    expect(html).toContain('>Review pull request 7</a>');
    expect(html).toContain('>Open LAN-9 in Linear</a>');
    // The issue on another tab is drawn, hidden.
    expect(html).toContain('<article class="icard" data-tab="nofix" hidden>');
    expect(html).toContain('Step 3 of 5: no fix yet');
  });

  it('says so when the pull requests could not be read, and never says No fix yet then', () => {
    draw.fixes({ state: 'error', error: 'GitHub said no' });
    const html = draw.userIssuesHtml({ issues: [issue()], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(html).toContain('Could not read the pull requests: GitHub said no');
    expect(html).toContain('data-itab="open" aria-pressed="true">Open<span class="count">1</span>');
    expect(html).not.toContain('No pull request names');
    expect(html).not.toContain('<span class="ipill ">No fix yet');
  });

  it('draws a video question with what an admin said, where Claude is with it, and the box to say more', () => {
    const html = draw.adminCard({
      kind: 'held', title: 'Share (en): the new film was held back', detail: 'A dialog covers the screen.|step 3', at: '2026-11-17T00:00:00Z', who: 'claude', next: 'Claude looks.',
      tutorial: 'share', language: 'en', instruct: 'The film was held.', pictures: [{ picture: 'a' }],
      instructed: { at: '2026-11-17T01:00:00Z', text: 'Dismiss <the> dialog.', looked: true, fix: { state: 'open', pr: 507, at: '2026-11-17T02:00:00Z', run: null, note: 'A new step taps Allow.' } }
    });
    expect(html).toContain('<article class="icard pics">');
    expect(html).toContain('<span class="ipill claude">Claude acts next</span>');
    expect(html).toContain('<p class="said you">Dismiss &#60;the&#62; dialog.</p>');
    expect(html).toContain('<p class="said claude">It merges itself.\nA new step taps Allow.</p>');
    expect(html).toContain('>PR 507</a>');
    expect(html).toContain('Step 5 of 5: the change waits on its merge');
    expect(html).toContain('<dt>Context</dt>');
    expect(html).toContain('<dt>Issue</dt>');
    // What happens next is Claude's answer now, not the line written before the admin said anything.
    expect(html).not.toContain('<dt>Solution</dt>');
    expect(html).toContain('data-instruct="held"');
    expect(html).toContain('placeholder="Send another instruction…"');
  });

  it('draws a suggestion with Accept and Reject, what came in, and the box before anything was said', () => {
    const html = draw.adminCard({
      kind: 'approve', title: 'Record: say Done in step 9', detail: 'The voice says Save.', at: '2026-11-17T00:00:00Z', who: 'you', next: 'Accept: Claude makes the change.',
      tutorial: 'record', language: 'en', instruct: 'About the suggestion.',
      suggestion: { id: 'abc', kind: 'voice', detail: 'The voice says Save.', inputs: [{ kind: 'comment', at: '2026-11-16T00:00:00Z', text: 'x', english: 'The button is Done.' }] }
    });
    expect(html).toContain('<span class="ipill you">Waits on you</span>');
    expect(html).toContain('data-sg="abc" data-decision="accept" data-kind="voice">Accept</button>');
    expect(html).toContain('data-sg="abc" data-decision="reject">Reject</button>');
    expect(html).toContain('The button is Done.');
    expect(html).toContain('<dt>Solution</dt><dd>Accept: Claude makes the change.</dd>');
    expect(html).toContain('Step 3 of 5: waits on your answer');
    expect(html).toContain('placeholder="Tell Claude what to do…"');
    expect(html).not.toContain('class="talk"');
  });

  it('draws a card with nothing to tell Claude without steps or a box', () => {
    const html = draw.adminCard({ kind: 'publish', title: '12 films wait for Publish', detail: 'D', at: null, who: 'you', next: 'Choose them.', link: '#tutorials' });
    expect(html).not.toContain('class="steps"');
    expect(html).not.toContain('class="tell"');
    expect(html).toContain('<a class="button" href="#tutorials">Open</a>');
  });

  it('are in the page, which still has no style attribute', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function issueCard(c)');
    expect(html).toContain('userissues(d) { return userIssuesHtml(d); }');
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/);
  });
});
