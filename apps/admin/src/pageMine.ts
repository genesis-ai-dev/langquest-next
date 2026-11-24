/**
 * Claude's replies in the corner of the ops dashboard, and a claim on each
 * Linear issue (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md).
 * The bell at the top right counts Claude's replies the admin has not seen,
 * and opens the list of the latest ones: on each card the admin talked on
 * with Claude, and on each issue the admin claimed. A row opens its card.
 * A developer claims an issue on its card (a user issue's card, or a line's
 * card with one Linear issue), so no other developer works on it; every
 * admin sees "Claimed by <display name>" on the card. Both come from one
 * read, /ops/api/mine (diag.ops_mine), for the admin the Worker checked.
 * Plain JavaScript inside page.ts's script; everything shown is escaped.
 */
import { ICONS } from './pageShell';

/** The bell, the list and the claim, inside page.ts's style element. */
export const MINE_CSS = String.raw`
.top #mine { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 40px; padding: 0 10px; }
.top #mine svg.i { width: 20px; height: 20px; }
#mine-count { position: absolute; top: 2px; right: 2px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--red); color: #fff;
  font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums; }
#mine-panel { position: absolute; top: calc(100% + 6px); right: clamp(16px, 3vw, 40px); z-index: 40; width: min(420px, calc(100vw - 32px)); max-height: min(72vh, 640px);
  overflow-y: auto; background: var(--raised); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 32px rgb(0 0 0 / .18); }
#mine-panel > h2 { position: sticky; top: 0; margin: 0; padding: 14px 16px 10px; font-size: 15px; background: var(--raised); border-bottom: 1px solid var(--line); }
#mine-panel ol { list-style: none; margin: 0; padding: 4px 0; }
#mine-panel li + li { border-top: 1px solid var(--line); }
.mreply { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 4px 10px; padding: 12px 16px; color: var(--ink); text-decoration: none; }
.mreply:hover, .mreply:focus-visible { background: var(--soft); }
.mreply .mdot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; }
.mreply.new .mdot { background: var(--primary); }
.mreply .mwhere { display: flex; gap: 8px; align-items: baseline; min-width: 0; font-size: 12.5px; color: var(--muted); }
.mreply .mwhere b { color: var(--ink2); font-weight: 600; flex: none; }
.mreply .mwhere span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mreply .mwhere time { flex: none; font-variant-numeric: tabular-nums; }
.mreply .msaid { grid-column: 2; margin: 0; font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.mreply.new .msaid { font-weight: 600; }
.mreply q { grid-column: 2; display: block; font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; quotes: none; }
#mine-panel .mnone { margin: 0; padding: 18px 16px; color: var(--muted); font-size: 14px; }
.tag.claimed { display: inline-flex; gap: 5px; align-items: center; color: var(--ink); background: var(--amberbg); font-weight: 600; }
.tag.claimed.me { color: var(--primary); background: var(--bg); border: 1px solid var(--primary); }
.tag.claimed svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
button.claim { min-height: 44px; }
`;

/** The bell and its list, in page.ts's top line before Refresh. */
export const MINE_HTML = String.raw`<button id="mine" type="button" hidden aria-haspopup="dialog" aria-expanded="false" aria-controls="mine-panel" aria-label="Claude's replies" title="Claude's replies"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS.bell}</svg><span id="mine-count" hidden></span></button>
  <div id="mine-panel" role="dialog" aria-label="Claude's replies" hidden></div>`;

/** Pure: apps/admin/test/mine.test.ts runs these with new Function. */
export const MINE_LOGIC = String.raw`
/** How many of Claude's replies came after the admin last opened the list. */
function repliesNew(mine) {
  if (!mine || !Array.isArray(mine.replies)) return 0;
  const seen = mine.seenAt ? Date.parse(mine.seenAt) : 0;
  return mine.replies.filter((r) => Date.parse(r.at) > seen).length;
}
/** Where a reply's card is: an issue's card, a line's card on its page, a page, or the tutorial videos. */
function replyHref(r) {
  const card = (group, id) => '#g/' + group + '/' + encodeURIComponent(id);
  if (r.kind === 'issue') return card('userissues', r.card);
  if (r.kind === 'video') return '#g/tutorials';
  if (String(r.card).startsWith('page:')) return '#g/' + (r.page || String(r.card).slice(5));
  return card(r.page, r.card);
}
/** Claude's words as one plain line: no code blocks, marks or list numbers, at most max characters. */
function replyPlain(text, max) {
  const t = String(text || '').replace(/\x60\x60\x60[\s\S]*?(\x60\x60\x60|$)/g, ' ').replace(/\x60/g, '').replace(/\*\*|__/g, '')
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/gm, '').replace(/\s+/g, ' ').trim();
  const m = max || 240;
  return t.length > m ? t.slice(0, m - 1).trimEnd() + '…' : t;
}
/** What Claude replied, in words: its answer, or where its change to a video is. */
function replySaid(r) {
  if (r.kind === 'video') {
    if (r.result === 'open') return 'Opened pull request ' + r.pr + ' with the change to the video.';
    if (r.result === 'merged') return 'Pull request ' + r.pr + ' merged. The video is filmed again.';
    if (r.result === 'closed') return 'Pull request ' + r.pr + ' was closed without a merge.';
    return 'Could not make the change.' + (r.answer ? ' ' + replyPlain(r.answer) : '');
  }
  return r.answer ? replyPlain(r.answer) : 'Claude ended without an answer. Ask again.';
}
/** What a reply is on: the issue's id, or the kind of card, and its title. */
function replyWhere(r) {
  if (r.kind === 'issue') return [r.card, r.title && r.title !== r.card ? r.title : ''];
  if (r.kind === 'video') return ['Tutorial video', r.title || ''];
  return [String(r.card).startsWith('page:') ? 'Page' : 'Card', r.title || ''];
}
`;

/** Drawing, reading and the taps; uses the page's helpers (esc, ago, $, api, post, perform, say, redrawSends). */
export const MINE_SCRIPT = String.raw`
/** Claims on each issue and Claude's replies to this admin (diag.ops_mine), or null before the first read. */
let MINE = null;
/** The time the admin last opened the list before this opening: the rows after it are marked new while it stays open. */
let mineSeenBefore = null;
/** Reads the claims and the replies again; cards are drawn again only when a claim changed. A failed read keeps what the page shows. */
async function loadMine() {
  const claims = JSON.stringify(MINE && MINE.claims);
  try { MINE = (await api('/ops/api/mine')) || { claims: {}, replies: [], seenAt: null }; } catch { return; }
  drawMine();
  if (JSON.stringify(MINE.claims) !== claims) redrawSends();
}
const panelOpen = () => !$('mine-panel').hidden;
function drawMine() {
  const n = panelOpen() ? 0 : repliesNew(MINE);
  const count = $('mine-count');
  count.hidden = !n;
  count.textContent = n > 99 ? '99+' : String(n);
  $('mine').setAttribute('aria-label', "Claude's replies" + (n ? ', ' + n + ' new' : ''));
  if (panelOpen()) drawMinePanel();
}
function drawMinePanel() {
  const list = (MINE && MINE.replies) || [];
  const seen = mineSeenBefore ? Date.parse(mineSeenBefore) : 0;
  $('mine-panel').innerHTML = '<h2>Claude\'s replies</h2>' + (!MINE ? '<p class="mnone">Loading…</p>' : !list.length ? '<p class="mnone">No replies yet.</p>' :
    '<ol>' + list.map((r) => {
      const [what, title] = replyWhere(r);
      return '<li><a class="mreply' + (Date.parse(r.at) > seen ? ' new' : '') + '" href="' + esc(replyHref(r)) + '"><span class="mdot" aria-hidden="true"></span>' +
        '<span class="mwhere"><b>' + esc(what) + '</b><span>' + esc(title) + '</span><time datetime="' + esc(r.at) + '" title="' + esc(new Date(r.at).toLocaleString()) + '">' + esc(ago(r.at)) + '</time></span>' +
        '<p class="msaid">' + esc(replySaid(r)) + '</p>' + (r.asked ? '<q>' + esc((r.mine ? 'You: ' : 'Another admin: ') + replyPlain(r.asked, 120)) + '</q>' : '') + '</a></li>';
    }).join('') + '</ol>');
}
function openMine() {
  mineSeenBefore = MINE ? MINE.seenAt : null;
  $('mine-panel').hidden = false;
  $('mine').setAttribute('aria-expanded', 'true');
  drawMine();
  // The replies until now are seen: the bell's count goes, on this page and the next one.
  if (MINE && repliesNew(MINE)) {
    const before = MINE.seenAt;
    MINE.seenAt = new Date().toISOString();
    post({ kind: 'replies-seen' }).catch((err) => { if (MINE) MINE.seenAt = before; drawMine(); if (err.message !== 'Signed out') say('The replies are not marked seen: ' + err.message, 'red'); });
  }
}
function closeMine() {
  if (!panelOpen()) return;
  $('mine-panel').hidden = true;
  $('mine').setAttribute('aria-expanded', 'false');
  drawMine();
}
$('mine').addEventListener('click', () => { if (panelOpen()) closeMine(); else openMine(); });
document.addEventListener('click', (e) => {
  if (!panelOpen() || e.target.closest('#mine')) return;
  // A row opens its card; a tap anywhere else closes the list.
  if (e.target.closest('#mine-panel a') || !e.target.closest('#mine-panel')) closeMine();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen()) { closeMine(); $('mine').focus(); } });
// New replies come each few minutes (the watch, card-questions.yml): the bell reads them again every 2 minutes in view.
setInterval(() => { if (document.visibilityState === 'visible' && !$('board').hidden) loadMine(); }, 120000);

/** "Claimed by" on an issue's card, for every admin; nothing when no one claimed it. */
function claimTag(issue) {
  const c = issue && MINE && MINE.claims ? MINE.claims[issue] : null;
  if (!c) return '';
  return '<span class="tag claimed' + (c.mine ? ' me' : '') + '" title="' + esc(new Date(c.at).toLocaleString()) + '"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.person}</svg>' +
    esc(c.mine ? 'Claimed by you' : 'Claimed by ' + c.who) + '</span>';
}
/** Claim on an open issue no one claimed, Release on the admin's own claim; nothing on another admin's claim or before the read. */
function claimButton(issue, closed) {
  if (!issue || closed || !MINE || !MINE.claims) return '';
  const c = MINE.claims[issue];
  if (c && !c.mine) return '';
  return '<button type="button" class="claim' + (c ? '' : ' primary') + '" data-claim="' + esc(issue) + '" data-claim-on="' + (c ? '0' : '1') + '">' + (c ? 'Release' : 'Claim') + '</button>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-claim]');
  if (!b) return;
  // After the answer, and after a refusal (another developer was first), the claims are read again.
  perform({ kind: 'issue-claim', issue: b.dataset.claim, claim: b.dataset.claimOn === '1' }, b).then(() => loadMine());
});
`;
