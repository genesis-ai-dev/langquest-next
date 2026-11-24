import { describe, expect, it } from 'vitest';
import { MINE_HTML, MINE_LOGIC, MINE_SCRIPT } from '../src/pageMine';

type Row = Record<string, unknown>;
type Mine = { claims: Record<string, Row>; replies: Row[]; seenAt: string | null };

/** The page's own logic, as it runs there (pageMine.ts MINE_LOGIC). */
const logic = new Function(`${MINE_LOGIC}; return { repliesNew, replyHref, replyPlain, replySaid, replyWhere };`)() as {
  repliesNew: (m: Mine | null) => number;
  replyHref: (r: Row) => string;
  replyPlain: (t: string, max?: number) => string;
  replySaid: (r: Row) => string;
  replyWhere: (r: Row) => [string, string];
};

/** The drawing with the page's helpers as plain stand-ins, the bell and the list as small fake elements, and the page's state to set. */
function page() {
  const els: Record<string, { hidden: boolean; innerHTML: string; textContent: string; attrs: Record<string, string>; setAttribute(k: string, v: string): void; addEventListener(): void; focus(): void }> = {};
  const el = () => ({ hidden: true, innerHTML: '', textContent: '', attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, addEventListener() {}, focus() {} });
  for (const id of ['mine', 'mine-count', 'mine-panel', 'board']) els[id] = el();
  const posts: unknown[] = [];
  const api = { answer: null as Mine | null, fail: false };
  const fns = new Function('els', 'posts', 'apiState', `
    const $ = (id) => els[id];
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
    const ago = () => '5 min ago';
    const document = { addEventListener() {}, visibilityState: 'hidden' };
    const setInterval = () => 0;
    let redrawn = 0;
    const redrawSends = () => { redrawn++; };
    const say = () => {};
    const perform = async () => {};
    const api = async () => { if (apiState.fail) throw new Error('down'); return apiState.answer; };
    const post = async (a) => { posts.push(a); return { ok: true }; };
    ${MINE_LOGIC}
    ${MINE_SCRIPT}
    return { loadMine, openMine, closeMine, claimTag, claimButton, set: (m) => { MINE = m; }, redrawn: () => redrawn };
  `)(els, posts, api) as {
    loadMine: () => Promise<void>; openMine: () => void; closeMine: () => void;
    claimTag: (issue: string) => string; claimButton: (issue: string, closed?: boolean) => string; set: (m: Mine | null) => void; redrawn: () => number;
  };
  return { ...fns, els, posts, api };
}

const reply = (over: Row = {}): Row => ({ at: '2026-01-02T00:30:00Z', kind: 'issue', card: 'LAN-12', page: 'userissues', title: 'Uploads time out',
  asked: 'Why does it fail?', mine: true, answer: 'The upload times out after **60 s**.', result: 'answered', pr: null, ...over });

describe('Claude\'s replies in the corner', () => {
  it('counts the replies that came after the admin last opened the list', () => {
    const replies = [reply({ at: '2026-11-24T00:30:00Z' }), reply({ at: '2026-11-23T20:00:00Z' })];
    expect(logic.repliesNew({ claims: {}, replies, seenAt: null })).toBe(2);
    expect(logic.repliesNew({ claims: {}, replies, seenAt: '2026-11-23T21:00:00Z' })).toBe(1);
    expect(logic.repliesNew({ claims: {}, replies, seenAt: '2026-11-24T01:00:00Z' })).toBe(0);
    expect(logic.repliesNew(null)).toBe(0);
  });

  it('opens each reply\'s card: an issue\'s, a line\'s on its page, a page, or the tutorial videos', () => {
    expect(logic.replyHref(reply())).toBe('#g/userissues/LAN-12');
    expect(logic.replyHref(reply({ kind: 'question', card: 'line:capacity-r2-class-a', page: 'storage' }))).toBe('#g/storage/line%3Acapacity-r2-class-a');
    expect(logic.replyHref(reply({ kind: 'question', card: 'page:storage', page: 'storage' }))).toBe('#g/storage');
    expect(logic.replyHref(reply({ kind: 'video', card: 'record-a-passage/fr', page: 'tutorials' }))).toBe('#g/tutorials');
  });

  it('says Claude\'s answer as one plain line, and where a change to a video is', () => {
    expect(logic.replySaid(reply())).toBe('The upload times out after 60 s.');
    expect(logic.replyPlain('1. Open it\n2. Run:\n```\nnpm run x\n```\n`done`')).toBe('Open it Run: done');
    expect(logic.replyPlain('x'.repeat(300), 20)).toHaveLength(20);
    expect(logic.replySaid(reply({ answer: null, result: 'none' }))).toBe('Claude ended without an answer. Ask again.');
    expect(logic.replySaid(reply({ kind: 'video', result: 'open', pr: 700, answer: null }))).toBe('Opened pull request 700 with the change to the video.');
    expect(logic.replySaid(reply({ kind: 'video', result: 'failed', answer: 'The screen is gone.' }))).toBe('Could not make the change. The screen is gone.');
    expect(logic.replyWhere(reply())).toEqual(['LAN-12', 'Uploads time out']);
    expect(logic.replyWhere(reply({ kind: 'question', card: 'page:storage', title: 'Storage and cost' }))).toEqual(['Page', 'Storage and cost']);
  });

  it('shows the count on the bell, marks the new rows while the list is open, and keeps the time it was opened', async () => {
    const p = page();
    p.api.answer = { claims: {}, replies: [reply(), reply({ at: '2026-01-01T10:00:00Z', card: 'LAN-13', mine: false, answer: 'Older' })], seenAt: '2026-01-01T12:00:00Z' };
    await p.loadMine();
    expect(p.els['mine-count']!.hidden).toBe(false);
    expect(p.els['mine-count']!.textContent).toBe('1');
    expect(p.els['mine']!.attrs['aria-label']).toBe("Claude's replies, 1 new");
    p.openMine();
    expect(p.posts).toEqual([{ kind: 'replies-seen' }]);
    expect(p.els['mine-count']!.hidden).toBe(true);
    const html = p.els['mine-panel']!.innerHTML;
    expect(html).toContain('href="#g/userissues/LAN-12"');
    expect(html.match(/class="mreply new"/g)).toHaveLength(1);
    expect(html).toContain('You: Why does it fail?');
    expect(html).toContain('Another admin: Why does it fail?');
    p.closeMine();
    expect(p.els['mine-count']!.hidden).toBe(true);
    // Opened again with nothing new: nothing is sent.
    p.openMine();
    expect(p.posts).toHaveLength(1);
    expect(p.els['mine-panel']!.innerHTML).not.toContain('mreply new');
  });

  it('says so when Claude has not replied yet, and keeps what it shows when a read fails', async () => {
    const p = page();
    p.api.answer = { claims: {}, replies: [], seenAt: null };
    await p.loadMine();
    p.openMine();
    expect(p.els['mine-panel']!.innerHTML).toContain('No replies yet.');
    expect(p.posts).toEqual([]);
    p.api.fail = true;
    await p.loadMine();
    expect(p.els['mine-panel']!.innerHTML).toContain('No replies yet.');
  });

  it('has the bell hidden until the sign-in, and named for a screen reader', () => {
    expect(MINE_HTML).toMatch(/<button id="mine" type="button" hidden[^>]*aria-label="Claude's replies"/);
    expect(MINE_HTML).toContain('role="dialog"');
  });
});

describe('a claim on an issue', () => {
  it('shows every admin who claimed it, and the claimer that it is theirs', () => {
    const p = page();
    p.set({ claims: { 'LAN-12': { who: 'Ana <b>', at: '2026-11-24T00:00:00Z', mine: false }, 'LAN-13': { who: 'Me', at: '2026-11-24T00:00:00Z', mine: true } }, replies: [], seenAt: null });
    expect(p.claimTag('LAN-12')).toContain('Claimed by Ana &#60;b&#62;');
    expect(p.claimTag('LAN-13')).toContain('Claimed by you');
    expect(p.claimTag('LAN-14')).toBe('');
  });

  it('offers Claim on a free open issue and Release on one\'s own, and nothing on another admin\'s, a closed one or before the read', () => {
    const p = page();
    expect(p.claimButton('LAN-14')).toBe('');
    p.set({ claims: { 'LAN-12': { who: 'Ana', at: '2026-11-24T00:00:00Z', mine: false }, 'LAN-13': { who: 'Me', at: '2026-11-24T00:00:00Z', mine: true } }, replies: [], seenAt: null });
    expect(p.claimButton('LAN-14')).toMatch(/data-claim="LAN-14" data-claim-on="1">Claim</);
    expect(p.claimButton('LAN-13')).toMatch(/data-claim="LAN-13" data-claim-on="0">Release</);
    expect(p.claimButton('LAN-12')).toBe('');
    expect(p.claimButton('LAN-14', true)).toBe('');
  });

  it('draws the cards again only when a claim changed', async () => {
    const p = page();
    p.api.answer = { claims: { 'LAN-12': { who: 'Ana', at: '2026-11-24T00:00:00Z', mine: false } }, replies: [], seenAt: null };
    await p.loadMine();
    expect(p.redrawn()).toBe(1);
    await p.loadMine();
    expect(p.redrawn()).toBe(1);
    p.api.answer = { claims: {}, replies: [], seenAt: null };
    await p.loadMine();
    expect(p.redrawn()).toBe(2);
  });
});
