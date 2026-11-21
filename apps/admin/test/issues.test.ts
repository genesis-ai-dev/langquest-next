import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { ISSUE_LOGIC, ISSUE_SCRIPT } from '../src/pageIssues';
import { SEND_LOGIC, SEND_SCRIPT } from '../src/pageSends';

interface Way { tab: string; pill: string; level: string; at: number; pr: { number: number } | null; claude?: boolean }
type Row = Record<string, unknown>;
const logic = new Function(`${ISSUE_LOGIC}; return { saidHtml, issueSource, issueWay, issueTabs, videoWay, noteSaid, fixFor, fixSaid, FIX_REASON, ISSUE_STEPS, VIDEO_STEPS };`)() as {
  saidHtml: (text: string) => string;
  issueSource: (keys: string[]) => string;
  issueWay: (r: Row, prs: Row[] | null, notes?: Row[] | null, fix?: Row | null) => Way;
  fixFor: (fix: Row | null, pr: Row | null) => Row | null;
  fixSaid: (fix: Row, merged: boolean) => { decision: [string, string]; reasons: [string, string][]; manager: string };
  FIX_REASON: Record<string, string>;
  noteSaid: (n: Row) => string;
  issueTabs: (ways: { tab: string; claude?: boolean }[], chosen: string | null) => { count: Record<string, number>; tab: string };
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
  const cardLink = (x) => '<a href="' + x.link + '">Open</a>', vicon = (k) => '<i>' + k + '</i>';
  const FIX_STATE = { open: 'It merges itself.', working: 'Claude writes it.' }, ADMIN_LEVEL = { fails: 'bad' }, SUGGESTION_KINDS = { voice: 'Voice' };
  const document = { addEventListener() {}, getElementById() { return null; } };
  // The page's state of taps (pageSends.ts), empty: nothing was sent from this page.
  let VIDEOS = null, results = {}, udata = null;
  const userIssuesData = () => udata;
  ${SEND_LOGIC}
  ${SEND_SCRIPT}
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
    expect(logic.issueSource(['worker:/api/agent:5xx'])).toBe('Web traffic');
    expect(logic.issueSource(['feedback:abc'])).toBe('A person sent it');
    expect(logic.issueSource(['ops:backup-late'])).toBe('The ops dashboard');
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
    expect(logic.issueTabs(ways, null)).toEqual({ count: { you: 0, nofix: 2, open: 0, claude: 0, merged: 0, closed: 1, all: 3 }, tab: 'nofix' });
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
    // Short: Wrong and Next lead; Known only when the watch wrote it.
    for (const label of ['Wrong', 'Next']) expect(html).toContain('<dt>' + label + '</dt>');
    expect(html).not.toContain('<dt>Known</dt>');
    expect(html).toContain('<p class="imeta">2 people · First seen then · The fix waits on its merge</p>');
    // The steps are behind Details.
    expect(html).toContain('<details class="imore"><summary>Details</summary><div>');
    expect(html).toContain('Step 4 of 5: the fix waits on its merge');
    expect(html).toContain('>Review pull request 7</a>');
    expect(html).toContain('>Open LAN-9 in Linear</a>');
    // The issue on another tab is drawn, hidden.
    expect(html).toContain('<article class="icard short" data-card="LAN-10" data-tab="nofix" hidden>');
    expect(html).toContain('Step 3 of 5: no fix yet');
  });

  it('leads with Wrong, Known and Next in the words the watch kept, and keeps the rest behind Details', () => {
    draw.fixes({ state: 'ok', data: { prs: [] } });
    const words = { context: 'A person saves a recording.', problem: 'The recording is <gone>.', known: 'The phone saw the save start, not its end.', solution: 'Keep the file until the save ends.' };
    const html = draw.userIssuesHtml({ issues: [issue(words)], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(html).toContain('<dl class="three"><dt>Wrong</dt><dd><p>The recording is &#60;gone&#62;.</p></dd><dt>Known</dt><dd><p>The phone saw the save start, not its end.</p></dd>' +
      '<dt>Next</dt><dd>Keep the file until the save ends.</dd></dl>');
    // Each fact once: what happened and the records' keys are behind Details, not on the card's face.
    const face = html.slice(0, html.indexOf('<details class="imore">'));
    expect(face).not.toContain('A person saves a recording.');
    expect(face).not.toContain('error:TypeError:library');
    expect(html).toContain('<h5 class="imh">What happened</h5><p>A person saves a recording.</p>');
    // An issue filed before the watch kept words shows the records' keys as Wrong.
    expect(draw.userIssuesHtml({ issues: [issue()], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null })).toContain('<dt>Wrong</dt><dd><code>error:TypeError:library</code></dd>');
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
    expect(html).toContain('<div class="said claude"><p><strong>It merges itself.</strong></p><p>A new step taps Allow.</p></div>');
    expect(html).toContain('>PR 507</a>');
    expect(html).toContain('Step 5 of 5: the change waits on its merge');
    expect(html).toContain('<dt>What happened</dt>');
    expect(html).toContain('<dt>What goes wrong</dt>');
    // What happens next is Claude's answer now, not the line written before the admin said anything.
    expect(html).not.toContain('<dt>The fix</dt>');
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
    expect(html).toContain('<dt>The fix</dt><dd>Accept: Claude makes the change.</dd>');
    expect(html).toContain('Step 3 of 5: waits on your answer');
    expect(html).toContain('placeholder="Tell Claude what to do…"');
    expect(html).not.toContain('class="talk"');
  });

  it('draws a reply to post with the comment, the reply to change, and its two steps', () => {
    const html = draw.adminCard({
      kind: 'reply', title: 'Record (fr): a reply to post', detail: 'Comment: x', at: '2026-11-17T00:00:00Z', who: 'you', next: 'Copy the reply.', tutorial: 'record', language: 'fr',
      link: 'https://www.youtube.com/watch?v=v1&lc=c1',
      reply: { id: 'r1', comment: 'Can I record <offline>?', original: 'Puis-je ?', text: 'Oui.', english: 'Yes.', link: 'https://www.youtube.com/watch?v=v1&lc=c1' }
    });
    expect(html).toContain('<article class="icard reply">');
    expect(html).toContain('<dt>Comment</dt>');
    expect(html).toContain('Can I record &#60;offline&#62;?');
    expect(html).toContain('<details><summary>As written</summary>Puis-je ?</details>');
    expect(html).toContain('<textarea id="rp-r1" maxlength="2000" rows="4">Oui.</textarea>');
    expect(html).toContain('In English: Yes.');
    expect(html).toContain('data-reply-copy="r1" data-href="https://www.youtube.com/watch?v=v1&#38;lc=c1"');
    expect(html).toContain('data-reply-done="r1" data-done="posted"');
    expect(html).toContain('data-reply-done="r1" data-done="none"');
    // The steps are the card's own; the line written for a card without them is not shown too.
    expect(html).not.toContain('<dt>The fix</dt>');
    expect(html).not.toContain('class="steps"');
  });

  it('gives a change Claude could not make Try again, with the box behind "instead"', () => {
    const card = { kind: 'fixFailed', title: 'Record: Claude could not make the change', detail: 'Its checks failed.', at: '2026-11-17T00:00:00Z', who: 'you', next: 'Try again.',
      tutorial: 'record', language: 'en', instruct: 'Claude could not make a change.', retry: 'Try this change again: say Done.' };
    const html = draw.adminCard(card);
    expect(html).toContain('<button type="button" class="vretry primary" data-retry="fixFailed">');
    expect(html).toContain('<details><summary>Tell Claude what to do instead</summary><div class="tell">');
    expect(html).toContain('<button type="button" data-instruct="fixFailed">Send to Claude</button>');
    // Once an instruction is sent, Claude has it: no second Try again.
    expect(draw.adminCard({ ...card, instructed: { at: '2026-11-17T01:00:00Z', text: 'Try this change again: say Done.', looked: false, fix: null } })).not.toContain('data-retry');
  });

  it('draws a card with nothing to tell Claude without steps or a box', () => {
    const html = draw.adminCard({ kind: 'publish', title: '12 films wait for Publish', detail: 'D', at: null, who: 'you', next: 'Choose them.', link: '#tutorials' });
    expect(html).not.toContain('class="steps"');
    expect(html).not.toContain('class="tell"');
    expect(html).toContain('<a class="button" href="#tutorials">Open</a>');
  });

  it('draws the talk and the box on an open user issue, and no box on a closed one', () => {
    const note = (over: Row = {}): Row => ({ at: '2026-11-18T01:00:00Z', text: 'Wait for the passage <first>.', state: 'waiting', answeredAt: null, result: null, answer: null, pr: null, runUrl: null, ...over });
    const closed = issue({ issue: 'LAN-5', issueUrl: 'https://linear.app/t/issue/LAN-5', state: 'Live', closedAt: '2026-11-12T00:00:00Z', verdict: 'fixed' });
    draw.fixes({ state: 'ok', data: { prs: [pr(7, 'open', ['LAN-9'])] } });
    const html = draw.userIssuesHtml({ issues: [issue(), closed], open: 1, closed: 1, fixed: 0, noiseWeek: 0, last: null, notes: {
      'LAN-9': [note({ state: 'answered', answeredAt: '2026-11-18T01:20:00Z', result: 'changed', answer: 'I moved the wait.', pr: 7 }), note({ text: 'Why 30 seconds?' })],
      'LAN-5': [note({ state: 'answered', answeredAt: '2026-11-11T00:00:00Z', result: 'answered', answer: 'The cause is the cache.' })]
    } });
    const [open, done] = html.split('<article').slice(1);
    // The admin's words are escaped, with Claude's answer under them and the pull request it changed.
    expect(open).toContain('<p class="said you">Wait for the passage &#60;first&#62;.</p>');
    expect(open).toContain('<div class="said claude"><p><strong>I moved the wait.</strong></p></div>');
    expect(open).toContain('>PR 7</a>');
    expect(open).toMatch(/<div class="said claude"><p><strong>Claude reads it at the next run of the watch, at about \d{1,2}:[0-5]\d\b[^<]*<\/strong><\/p><\/div>/);
    expect(open).toContain('<textarea id="uin-LAN-9"');
    expect(open).toContain('data-uinote="LAN-9">Send to Claude</button>');
    expect(open).toContain('placeholder="Send another instruction…"');
    // An instruction that waits: Claude acts next, in the tab the issue is in.
    expect(open).toContain('data-tab="you"');
    expect(open).toContain('<span class="ipill claude">Claude acts next</span>');
    // A closed issue keeps what was said and takes no more.
    expect(done).toContain('The cause is the cache.');
    expect(done).not.toContain('data-uinote');
    // Before the database keeps instructions, a card has no box.
    expect(draw.userIssuesHtml({ issues: [issue()], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null })).not.toContain('class="tell"');
    draw.fixes(null);
  });

  it('says what Claude does with an instruction from its state', () => {
    expect(logic.noteSaid({ state: 'working' })).toBe('Claude works on it now.');
    expect(logic.noteSaid({ state: 'stopped' })).toContain('Send the instruction again');
    expect(logic.noteSaid({ state: 'answered', result: 'changed', answer: null })).toBe('Claude changed the draft fix.');
    expect(logic.noteSaid({ state: 'answered', result: 'answered', answer: 'Yes.' })).toBe('Yes.');
    expect(logic.issueWay(issue(), [], [{ state: 'working' }])).toMatchObject({ tab: 'nofix', pill: 'Claude acts next', level: 'claude' });
    expect(logic.issueWay(issue(), [], [{ state: 'answered' }])).toMatchObject({ pill: 'No fix yet' });
  });

  it("show the agent team's record: what was decided, Claude's reasons, and what came with the problem", () => {
    const record = (over: Row = {}): Row => ({
      decision: 'merge', reason: null, why: 'The change does what it says.', pr: 7, verdict: 'fix', model: 'sonnet', effort: 'medium',
      summary: 'Chapters sort by <number>.', cause: 'listModel.ts line 42 sorts labels as text.', proof: 'The new case fails on main.', review: 'The change does what it says.',
      twins: null, runUrl: 'https://github.com/o/r/actions/runs/9', at: '2026-11-19T20:00:00Z', pictures: [{ id: 'f1', screenshot: true, picture: false }], ...over
    });
    const open = [pr(7, 'open', ['LAN-9'])];
    // A fix that merges without a person does not wait on a developer.
    expect(logic.issueWay(issue(), open, null, record())).toMatchObject({ tab: 'claude', pill: 'Merges when checks pass', level: 'claude', at: 4, claude: true });
    expect(logic.issueWay(issue(), [pr(7, 'merged', ['LAN-9'], '2026-11-19T21:00:00Z')], null, record())).toMatchObject({ tab: 'merged', pill: 'Merged by Claude', claude: true });
    expect(logic.issueWay(issue({ closedAt: '2026-11-19T22:00:00Z', state: 'Live', fixedBy: 7 }), [], null, record())).toMatchObject({ tab: 'closed', claude: true });
    // One that waits is where every open pull request is; the record is never read for another pull request.
    expect(logic.issueWay(issue(), open, null, record({ decision: 'waits', reason: 'mode' }))).toMatchObject({ tab: 'you', pill: 'Waits on you' });
    expect(logic.issueWay(issue(), [pr(8, 'open', ['LAN-9'])], null, record())).toMatchObject({ tab: 'you', pill: 'Waits on you' });
    expect(logic.issueWay(issue(), [pr(8, 'merged', ['LAN-9'], '2026-11-19T21:00:00Z')], null, record())).toMatchObject({ pill: 'Merged', claude: false });
    expect(logic.fixFor(record(), { number: 8 })).toBeNull();
    // Claude changed nothing: a developer decides, so it waits on them.
    const none = record({ decision: 'none', reason: 'unconfirmed', why: 'The cause is not proven.', pr: null, summary: null, cause: null, proof: null, review: null });
    expect(logic.issueWay(issue(), [], null, none)).toMatchObject({ tab: 'you', pill: 'Waits on you', at: 3, pr: null });
    expect(logic.issueWay(issue(), [], null, null)).toMatchObject({ tab: 'nofix' });
    // The tab Fixed by Claude holds them in whatever state the issue is.
    expect(logic.issueTabs([{ tab: 'claude', claude: true }, { tab: 'merged', claude: true }, { tab: 'merged' }, { tab: 'closed', claude: true }], 'claude'))
      .toEqual({ count: { you: 0, nofix: 0, open: 0, claude: 3, merged: 2, closed: 1, all: 4 }, tab: 'claude' });

    expect(logic.fixSaid(record(), false)).toEqual({ decision: ['This fix merges without a person when its checks pass.', ''], manager: 'sonnet, medium effort',
      reasons: [['Change', 'Chapters sort by <number>.'], ['Cause', 'listModel.ts line 42 sorts labels as text.'], ['Test', 'The new case fails on main.'], ['Reviewer', 'The change does what it says.']] });
    expect(logic.fixSaid(record(), true).decision[0]).toBe('Claude merged this fix without a person.');
    expect(logic.fixSaid(none, false)).toEqual({ decision: ['The cause is not proven.', 'The cause is not proven.'], reasons: [], manager: 'sonnet, medium effort' });

    draw.fixes({ state: 'ok', data: { prs: open } });
    const html = draw.userIssuesHtml({ issues: [issue()], fixes: { 'LAN-9': record() }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(html).toContain('data-itab="claude" aria-pressed="true">Fixed by Claude<span class="count">1</span>');
    expect(html).toContain('<article class="icard short" data-card="LAN-9" data-tab="claude" data-claude="1">');
    expect(html).toContain('<h5 class="imh">What Claude did</h5>');
    expect(html).toContain('PR 7 merges without a person when its checks pass.');
    expect(html).toContain('>Open pull request 7</a>');
    expect(html).not.toContain('Review pull request');
    expect(html).toContain('<b>This fix merges without a person when its checks pass.</b>');
    expect(html).toContain('<p><b>Change.</b> Chapters sort by &#60;number&#62;.</p>');
    expect(html).toContain('<p><b>Test.</b> The new case fails on main.</p>');
    expect(html).toContain('Issue manager: sonnet, medium effort');
    expect(html).toContain('<button type="button" class="link" data-shot="f1" data-what="screenshot">Show screenshot</button>');
    expect(html).not.toContain('Show picture');
    // A display fix: the screen before the fix and after it, each loaded for the signed-in admin.
    const shown = draw.userIssuesHtml({ issues: [issue()], fixes: { 'LAN-9': record({ beforeAfter: true }) }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(shown).toContain('<figcaption>Before the fix</figcaption><img alt="The screen before the fix" data-fixpic="LAN-9" data-what="before">');
    expect(shown).toContain('<figcaption>After the fix</figcaption><img alt="The screen after the fix" data-fixpic="LAN-9" data-what="after">');
    expect(draw.userIssuesHtml({ issues: [issue()], fixes: { 'LAN-9': record({ pr: 5, beforeAfter: true }) }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null })).not.toContain('data-fixpic');
    // A record of another pull request: its reasons are not under this one, the pictures of the problem still are.
    const other = draw.userIssuesHtml({ issues: [issue()], fixes: { 'LAN-9': record({ pr: 5 }) }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(other).not.toContain('What Claude did');
    expect(other).toContain('data-shot="f1"');
    draw.fixes({ state: 'ok', data: { prs: [] } });
    const waits = draw.userIssuesHtml({ issues: [issue()], fixes: { 'LAN-9': none }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(waits).toContain('<span class="ipill you">Waits on you</span>');
    expect(waits).toContain('Claude wrote no fix. A developer decides what happens next.');
    // Said once, never twice.
    expect(waits).toContain('<b>The cause is not proven.</b></p>');
    // Before the database keeps records, a card is as it was.
    expect(draw.userIssuesHtml({ issues: [issue()], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null })).not.toMatch(/What Claude did|data-shot/);
    draw.fixes(null);
  });

  it('says each reason a fix waits, as the gate names them', async () => {
    const { REASONS } = await import('../../../scripts/agent-team.mjs');
    expect(Object.keys(logic.FIX_REASON)).toEqual(REASONS);
  });

  it('are in the page, which still has no style attribute', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function issueCard(c)');
    expect(html).toContain('userissues(d) { return userIssuesHtml(d); }');
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/);
  });
});

describe('an image on each card', () => {
  const base = { open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null };
  const steps = [{ where: 'Person', text: 'Taps <Play>.', wrong: false }, { where: 'Browser', text: 'The request is refused.', wrong: true }];
  const waits = (over: Row = {}): Row => ({ decision: 'none', reason: 'decision', why: 'A developer decides.', pr: null, verdict: 'decision', model: 'opus', effort: 'high', summary: null, cause: null,
    proof: null, review: null, twins: null, runUrl: null, at: '2026-11-19T00:00:00Z', pictures: [], ...over });

  it('draws the diagram of an issue with no picture of the screen: each step as text, the wrong one marked', () => {
    const html = draw.userIssuesHtml({ ...base, issues: [issue()], diagrams: { 'LAN-9': steps } });
    expect(html).toContain('<ol class="idiagram"');
    expect(html).toContain('<li><b>Person</b>Taps &#60;Play&#62;.</li><li class="wrong"><b>Browser</b>The request is refused.</li>');
    expect(html).toContain('(this goes wrong)');
    expect(draw.userIssuesHtml({ ...base, issues: [issue()] })).not.toContain('idiagram');
  });

  it('shows the picture of the screen in place of the diagram when the picture job made one', () => {
    const html = draw.userIssuesHtml({ ...base, issues: [issue()], diagrams: { 'LAN-9': steps }, fixes: { 'LAN-9': waits({ before: true }) } });
    expect(html).toContain('<figcaption>The problem on the screen</figcaption><img alt="The screen where the problem shows" data-fixpic="LAN-9" data-what="before">');
    expect(html).not.toContain('idiagram');
    expect(html).not.toContain('After the fix');
  });

  it('points to the Research page under the cards', () => {
    expect(draw.userIssuesHtml({ ...base, issues: [] })).toContain('<a href="#g/research">Research</a>');
    expect(draw.userIssuesHtml({ ...base, issues: [issue()] })).toContain('<a href="#g/research">Research</a>');
  });
});


describe("Claude's answer in the talk", () => {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const said = new Function('esc', `${ISSUE_LOGIC}; return saidHtml;`)(esc) as (t: string) => string;
  it('shows the lead in bold, numbered steps, and a command in a box under its step', () => {
    const html = said('I cannot find it. Why.\n\n1. Run this:\n```\nnpm run diag -- <id>\n```\n2. Read `profile id`.\n\nNo change.');
    expect(html).toBe('<p><strong>I cannot find it.</strong> Why.</p><ol><li>Run this:<pre><code>npm run diag -- &#60;id&#62;</code>' +
      '<button type="button" class="copy" data-copy-code aria-label="Copy">Copy</button></pre></li><li>Read <code>profile id</code>.</li></ol><p>No change.</p>');
  });
  it('puts the steps of an answer on one line on their own lines, only when they count 1, 2, 3', () => {
    expect(said('Do this. 1) Run x. 2) Read y.')).toBe('<p><strong>Do this.</strong></p><ol><li>Run x.</li><li>Read y.</li></ol>');
    expect(said('See line 361) and 2) here.')).toBe('<p><strong>See line 361) and 2) here.</strong></p>');
  });
  it('escapes every word, also inside code and bold', () => {
    const html = said('<img src=x onerror=alert(1)> **<b>** `<script>`');
    expect(html).not.toMatch(/<img|<b>|<script/);
  });
});
