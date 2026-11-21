import { describe, expect, it } from 'vitest';
import { SEND_LOGIC, SEND_SCRIPT } from '../src/pageSends';
import { ISSUE_LOGIC, ISSUE_SCRIPT } from '../src/pageIssues';

type Row = Record<string, unknown>;
type Send = { key: string; text: string; at: number; state: 'sending' | 'sent' | 'refused'; error?: string };

/** The page's own logic, as it runs there (pageSends.ts SEND_LOGIC). */
const logic = new Function(`${SEND_LOGIC}; return { nextRun, sendHeld, notesWithSends, cardWithSend, withGone, recordSaid, cardRecord, FIX_RUN_MINUTES, WATCH_MINUTES };`)() as {
  nextRun: (now: number, minutes: number[]) => number;
  sendHeld: (send: Send, said: Row[]) => boolean;
  notesWithSends: (notes: Record<string, Row[]> | undefined, sends: Map<string, Send>) => Record<string, Row[]> | undefined;
  cardWithSend: (a: Row, send: Send | undefined) => Row;
  withGone: (cards: Row[], gone: Map<string, Row>, keyOf: (a: Row) => string) => Row[];
  recordSaid: (r: Row) => { who: string; said: string; words: string; bad: boolean };
  cardRecord: (records: Row[], key: string, sends: Map<string, Send>, sendKey: string, found: Row | null) => Row[];
  FIX_RUN_MINUTES: number[]; WATCH_MINUTES: number[];
};

/** The drawing, with the page's helpers as plain stand-ins (as in issues.test.ts), and a page state to set. */
const page = new Function(`
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const when = (iso) => iso ? 'then' : 'never', num = String, stat = () => '', NOW = '', LAST_WEEK = '';
  const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';
  const PR_URL = 'https://github.com/o/r/pull/', prLink = (p) => 'PR ' + p.number;
  const pictureStrip = () => '', detailParts = (t) => [String(t || ''), ''], cardId = (a) => a.kind + '-' + a.tutorial, languageName = (c) => 'language ' + c;
  const cardLink = () => '', vicon = (k) => '<i>' + k + '</i>';
  const FIX_STATE = {}, ADMIN_LEVEL = {}, SUGGESTION_KINDS = {};
  const document = { addEventListener() {}, getElementById() { return null; } };
  let VIDEOS = null, results = {}, udata = null, fixData = null;
  const userIssuesData = () => udata;
  ${SEND_LOGIC}
  ${SEND_SCRIPT}
  ${ISSUE_LOGIC}
  ${ISSUE_SCRIPT}
  return { SENDS, GONE, adminCard, userIssuesHtml, goneCard, recordHtml, set: (v, u) => { VIDEOS = v; udata = u; } };
`)() as {
  SENDS: Map<string, Send>; GONE: Map<string, Row>;
  adminCard: (a: Row) => string; userIssuesHtml: (d: Row) => string; goneCard: (g: Row) => string;
  recordHtml: (entries: Row[], turn: [string, string] | null) => string; set: (videos: Row | null, issues: Row | null) => void;
};

const at = (iso: string) => Date.parse(iso);

describe('when the job that reads a message starts', () => {
  it('is the next of its minutes each hour, in the next hour after the last', () => {
    expect(new Date(logic.nextRun(at('2026-11-21T21:05:30Z'), logic.FIX_RUN_MINUTES)).toISOString()).toBe('2026-11-21T21:20:00.000Z');
    expect(new Date(logic.nextRun(at('2026-11-21T21:20:00Z'), logic.FIX_RUN_MINUTES)).toISOString()).toBe('2026-11-21T21:50:00.000Z');
    expect(new Date(logic.nextRun(at('2026-11-21T23:55:00Z'), logic.FIX_RUN_MINUTES)).toISOString()).toBe('2026-11-22T00:20:00.000Z');
    expect(new Date(logic.nextRun(at('2026-11-21T21:46:00Z'), logic.WATCH_MINUTES)).toISOString()).toBe('2026-11-21T22:00:00.000Z');
  });
});

describe('a message sent from the page', () => {
  const sent: Send = { key: 'issue:LAN-9', text: 'Prove the cause', at: at('2026-11-21T21:00:00Z'), state: 'sent' };

  it('is held by the server when the same words came at most 10 minutes before the send, or after', () => {
    expect(logic.sendHeld(sent, [{ text: ' Prove the cause ', at: '2026-11-21T20:58:00Z' }])).toBe(true);
    expect(logic.sendHeld(sent, [{ text: 'Prove the cause', at: '2026-11-21T20:40:00Z' }])).toBe(false);
    expect(logic.sendHeld(sent, [{ text: 'Another thing', at: '2026-11-21T21:00:01Z' }])).toBe(false);
  });

  it('shows in its issue\'s talk in its state until the server holds it', () => {
    const sending = new Map([['issue:LAN-9', { ...sent, state: 'sending' as const }]]);
    expect(logic.notesWithSends({ 'LAN-9': [] }, sending)!['LAN-9']).toMatchObject([{ text: 'Prove the cause', state: 'sending', local: true }]);
    expect(logic.notesWithSends({}, new Map([['issue:LAN-9', sent]]))!['LAN-9']).toMatchObject([{ state: 'waiting', local: true }]);
    const refused = new Map([['issue:LAN-9', { ...sent, state: 'refused' as const, error: 'Signed out' }]]);
    expect(logic.notesWithSends({}, refused)!['LAN-9']).toMatchObject([{ state: 'refused', error: 'Signed out' }]);
    // Once the server holds it, it shows once, as the server's.
    expect(logic.notesWithSends({ 'LAN-9': [{ text: 'Prove the cause', at: '2026-11-21T21:00:02Z', state: 'waiting' }] }, new Map([['issue:LAN-9', sent]]))!['LAN-9']).toHaveLength(1);
    // A page that sent nothing keeps "no instructions kept" as it was.
    expect(logic.notesWithSends(undefined, new Map())).toBeUndefined();
  });

  it('moves a video card to Claude\'s step once sent, and keeps it as it is while it goes', () => {
    const card = { kind: 'held', tutorial: 'v', language: 'es', who: 'you', instruct: 'The film was held.' };
    expect(logic.cardWithSend(card, undefined)).toBe(card);
    expect(logic.cardWithSend(card, { ...sent, key: 'video:x', state: 'sending' })).toMatchObject({ who: 'you', send: { state: 'sending' } });
    expect(logic.cardWithSend(card, { ...sent, key: 'video:x' })).toMatchObject({ who: 'claude', instructed: { text: 'Prove the cause', looked: true, fix: null } });
    const held = { ...card, who: 'claude', instructed: { at: '2026-11-21T21:00:01Z', text: 'Prove the cause', looked: true, fix: null } };
    expect(logic.cardWithSend(held, { ...sent, key: 'video:x' })).toBe(held);
  });
});

describe('a card answered on its tab', () => {
  const key = (a: Row) => String(a.id);
  it('leaves its short card where it was, also after the server took it off the list', () => {
    const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const gone = new Map([['b', { key: 'b', index: 1 }]]);
    expect(logic.withGone(cards, gone, key).map((x) => (x.gone ? 'gone:' + (x.gone as Row).key : (x.card as Row).id))).toEqual(['a', 'gone:b', 'c']);
    expect(logic.withGone([{ id: 'a' }, { id: 'c' }], gone, key).map((x) => (x.gone ? 'gone' : (x.card as Row).id))).toEqual(['a', 'gone', 'c']);
    expect(logic.withGone([], new Map([['z', { key: 'z', index: 4 }]]), key)).toHaveLength(1);
  });

  it('says what happened, the words sent, and where the card is now, with the way there', () => {
    const html = page.goneCard({ key: 'held-v', title: 'The film was held <back>', said: 'Sent. Claude starts the change at its next fix run.', text: 'Fix the capital letter', at: at('2026-11-21T20:56:00Z'),
      where: ['The card is now under Automatic.', 'auto', 'Show Automatic'], pill: ['Claude acts next', 'claude'] });
    expect(html).toContain('The film was held &#60;back&#62;');
    expect(html).toContain('role="status"');
    expect(html).toContain('<p class="said you">Fix the capital letter</p>');
    expect(html).toContain('<button type="button" data-vtab="auto">Show Automatic</button>');
    expect(html).toContain('<span class="ipill claude">Claude acts next</span>');
  });
});

describe('the cards while a message goes', () => {
  const card = { kind: 'held', tutorial: 'v', language: 'es', title: 'Held', detail: 'D', at: null, who: 'you', next: 'Tell Claude.', instruct: 'The film was held.' };
  it('show the words as sending, the box read-only and the button busy', () => {
    const html = page.adminCard({ ...card, send: { key: 'video:held-v', text: 'Fix it', at: Date.now(), state: 'sending' } });
    expect(html).toContain('<p class="said you sending">Fix it</p>');
    expect(html).toContain(' readonly');
    expect(html).toContain('disabled aria-busy="true">Sending…</button>');
  });
  it('show why a message was not sent, and that the words are back in the box', () => {
    const html = page.adminCard({ ...card, send: { key: 'video:held-v', text: 'Fix it', at: Date.now(), state: 'refused', error: 'It did not work (502).' } });
    expect(html).toContain('<p class="said you refused">Fix it</p>');
    expect(html).toContain('Not sent: It did not work (502). Your words are back in the box.');
    expect(html).toContain('>Send to Claude</button>');
  });
  it('show a sent instruction with the time of the run that reads it, and Claude\'s step', () => {
    const html = page.adminCard(logic.cardWithSend(card, { key: 'video:held-v', text: 'Fix it', at: Date.now(), state: 'sent' }));
    expect(html).toMatch(/<strong>Sent\.<\/strong> Claude starts the change at its next fix run, at about \d{1,2}:[0-5]\d/);
    expect(html).toContain('<span class="ipill claude">Claude acts next</span>');
    expect(html).toContain('aria-label="Step 4 of 5');
  });
});

describe('the record on a card', () => {
  const records = [
    { at: '2026-11-21T21:00:54Z', who: 'Caleb', what: 'suggestion_accepted', result: 'refused', detail: 'decided', key: 'v/es', words: 'Light the button', pr: null },
    { at: '2026-11-21T21:00:38Z', who: 'Caleb', what: 'suggestion_accepted', result: 'ok', detail: 'screen', key: 'v/es', words: 'Light the button', pr: null },
    { at: '2026-11-21T10:03:57Z', who: 'Claude', what: 'suggested', result: 'ok', detail: 'screen', key: 'v/es', words: 'Light the button', pr: null },
    { at: '2026-11-21T10:00:00Z', who: 'Claude', what: 'fix', result: 'ok', detail: 'open', key: 'other/fr', words: 'x', pr: 640 }
  ];

  it('says each entry in words: who, what, and why a tap was refused', () => {
    expect(logic.recordSaid(records[1]!)).toEqual({ who: 'Caleb', said: 'accepted Claude\'s suggestion', words: 'Light the button', bad: false });
    expect(logic.recordSaid(records[0]!)).toMatchObject({ said: 'accepted Claude\'s suggestion. Refused: another admin answered it first', bad: true });
    expect(logic.recordSaid(records[3]!).said).toBe('made the change as a pull request that merges itself when its checks pass (pull request 640)');
    expect(logic.recordSaid({ who: 'Claude', what: 'answered', result: 'ok', detail: 'changed', words: 'I moved it.', pr: 7 })).toMatchObject({ said: 'answered and changed the draft fix (pull request 7)', words: '' });
  });

  it('says each step of a fix in the app, from Fix it to the new film', () => {
    const said = (what: string, detail: string | null = null, pr: number | null = null) => logic.recordSaid({ who: 'Claude', what, result: 'ok', detail, words: null, pr }).said;
    expect(said('suggestion_fix', 'LAN-400')).toBe('said Fix it: Claude\'s agent team changes the app');
    expect(said('suggestion_fix', 'LAN-400:ask_first')).toBe('said Fix it, and asked to see the change before it merges');
    expect(said('handed')).toBe('found that the cause is in the app, and gave the fix to its agent team');
    expect(said('taken')).toBe('started the fix in the app');
    expect(said('appfix', 'merge', 640)).toBe('wrote the fix. It keeps the rules, so it merges by itself when its checks pass (pull request 640)');
    expect(said('appfix', 'waits:instruction', 640)).toBe('wrote the fix. It waits for your yes, as you asked (pull request 640)');
    expect(said('appfix', 'waits:paths', 640)).toBe('wrote the fix. The rules say a developer must read it (pull request 640)');
    expect(said('appfix', 'none:not_a_bug')).toBe('made no change');
    expect(said('refilm', null, 640)).toBe('saw the fix merged, and sent the video to be filmed again (pull request 640)');
    expect(said('filmed')).toBe('filmed the video again: the new film is in');
  });

  it('says that another pull request fixed a change that failed', () => {
    const said = (detail: string | null, pr: number) => logic.recordSaid({ who: 'Claude', what: 'fixed_elsewhere', result: 'ok', detail, words: null, pr }).said;
    expect(said('apps/mobile/src/i18n/fr.json', 633)).toBe('saw that another pull request fixed it (it changed apps/mobile/src/i18n/fr.json, the file Claude named), and that a new film came in after it (pull request 633)');
    expect(said(null, 636)).toBe('saw that another pull request fixed it (it names this change), and that a new film came in after it (pull request 636)');
  });

  it('holds only its card\'s entries, newest first, with how it began and a message the server does not have yet', () => {
    const sends = new Map([['video:held-v', { key: 'video:held-v', text: 'Fix it', at: at('2026-11-21T21:05:00Z'), state: 'sending' as const }]]);
    const list = logic.cardRecord(records, 'v/es', sends, 'video:held-v', { at: '2026-11-20T09:00:00Z', who: 'The frame check on the new film', said: 'held it back' });
    expect(list.map((r) => r.who + ':' + r.what)).toEqual(['You:tutorial_note', 'Caleb:suggestion_accepted', 'Caleb:suggestion_accepted', 'Claude:suggested', 'The frame check on the new film:found']);
    expect(list[0]).toMatchObject({ local: 'sending', words: 'Fix it' });
    // Once the server has the message, it shows once.
    const held = [{ at: '2026-11-21T21:05:01Z', who: 'Caleb', what: 'tutorial_note', result: 'ok', detail: 'instruction:1', key: 'v/es', words: 'Fix it', pr: null }];
    expect(logic.cardRecord(held, 'v/es', new Map([['video:held-v', { ...sends.get('video:held-v')!, state: 'sent' as const }]]), 'video:held-v', null)).toHaveLength(1);
  });

  it('shows the last entry and whose turn it is at a glance, and every entry behind one tap', () => {
    const html = page.recordHtml(logic.cardRecord(records, 'v/es', new Map(), 'video:x', null), ['Claude acts next', 'claude']);
    expect(html).toMatch(/^<details class="irecord"><summary><span class="rh">Record<\/span><span class="rlast">Last: <b>Caleb<\/b> accepted Claude&#39;s suggestion\. Refused: another admin answered it first · /);
    expect(html).toContain('<span class="ipill claude">Now: Claude acts next</span>');
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('<li class="bad">');
    expect(page.recordHtml([], null)).toBe('');
  });

  it('is on a video card and on a user issue card, from their parts\' answers', () => {
    page.set({ admin: [], records }, { records: [{ at: '2026-11-21T05:10:54Z', who: 'Caleb', what: 'user_issue_note', result: 'ok', detail: null, key: 'LAN-9', words: 'Prove the cause first', pr: null }] });
    expect(page.adminCard({ kind: 'approve', tutorial: 'v', language: 'es', title: 'T', detail: 'D', at: null, who: 'you', next: 'N', instruct: 'I' })).toContain('class="irecord"');
    const issues = page.userIssuesHtml({ issues: [{ issue: 'LAN-9', title: 'A thing fails', state: 'Todo', closedAt: null, keys: ['error:x'], firstAt: '2026-11-10T00:00:00Z' }],
      notes: { 'LAN-9': [{ at: '2026-11-21T05:10:54Z', text: 'Prove the cause first', state: 'answered', answeredAt: '2026-11-21T05:15:00Z', result: 'answered', answer: 'I cannot prove it yet.', pr: null, runUrl: null }] }, open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(issues).toContain('<b>Caleb</b> sent an instruction to Claude');
    expect(issues).toContain('<q>Prove the cause first</q>');
    // The talk names the admin who sent it, so each admin sees what another admin said.
    expect(issues).toContain('<small class="you">Caleb · then</small>');
    page.set(null, null);
  });
});
