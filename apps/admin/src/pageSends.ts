/**
 * What a tap on the ops dashboard shows while it goes and after it went
 * (docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md). Each
 * button says it works ("Sending…") until the app Worker answers. A message to
 * Claude shows on its card at once, with its state: sending, sent (with the
 * time of the run that reads it), or not sent with the reason, and the words
 * back in the box. A tutorial video card that an answer takes off the list
 * leaves, in its place, a short card that says what happened and where the card
 * went. After each answer the page reads again, from the source and not from a
 * copy up to a minute old, the parts the tap changed (page.ts reread).
 * Plain JavaScript inside page.ts's script; everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const SEND_CSS = String.raw`
#out:not(:empty) { position: sticky; top: 8px; z-index: 30; }
#out .notice { display: flex; gap: 10px; align-items: start; box-shadow: 0 4px 16px rgb(0 0 0 / .12); background: var(--raised); }
#out .notice.good { color: var(--green); background: var(--greenbg); }
#out .notice > span { flex: 1; min-width: 0; }
#out .notice > button { min-height: 32px; min-width: 32px; padding: 0 8px; border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; }
button[aria-busy="true"] { cursor: progress; opacity: .75; }
button[aria-busy="true"]::before { content: ''; width: 12px; height: 12px; margin-inline-end: 8px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; display: inline-block; vertical-align: -1px; animation: busy .8s linear infinite; }
@keyframes busy { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { button[aria-busy="true"]::before { animation: none; } }
.said.you.sending { opacity: .7; }
.said.you.refused { background: var(--redbg); color: var(--red); }
.said.claude.refused { background: var(--redbg); color: var(--red); }
.talk small.sending::before { content: ''; width: 8px; height: 8px; margin-inline-end: 6px; border-radius: 50%; display: inline-block; background: var(--primary); animation: pulse 1s ease-in-out infinite alternate; }
@keyframes pulse { from { opacity: .3; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .talk small.sending::before { animation: none; } }
.icard.gone { border-style: dashed; gap: 10px; }
.icard.gone .gonesaid { display: flex; gap: 10px; align-items: start; margin: 0; font-size: 15px; font-weight: 600; }
.icard.gone .gonesaid svg { width: 22px; height: 22px; flex: none; fill: none; stroke: var(--green); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.icard.gone .gonewhere { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: 0; color: var(--muted); font-size: 13.5px; }
.icard.gone .gonewhere button { min-height: 40px; }
.icard.gone .said.you { justify-self: start; }
.irecord { border-top: 1px solid var(--line); padding-top: 10px; }
.irecord > summary { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; min-height: 40px; cursor: pointer; font-size: 13px; color: var(--ink2); }
.irecord .rh { font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.irecord .rlast { flex: 1; min-width: 200px; }
.irecord .ipill { font-size: 12px; }
.rlog { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.rlog li { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; font-size: 13px; line-height: 1.4; }
.rlog li.bad span { color: var(--red); }
.rlog time { color: var(--muted); font-variant-numeric: tabular-nums; }
.rlog q { display: block; margin-top: 2px; color: var(--muted); overflow-wrap: anywhere; }
@media (max-width: 560px) { .rlog li { grid-template-columns: minmax(0, 1fr); gap: 0; } }
`;

/** Pure: apps/admin/test/sends.test.ts runs these with new Function. */
export const SEND_LOGIC = String.raw`
/** The minutes past each hour (UTC) that a job starts: Claude's fix run for the videos, and the watch of user issues. */
const FIX_RUN_MINUTES = [20, 50], WATCH_MINUTES = [0, 15, 30, 45];
/** The next start of a job that starts at these minutes of each hour, after now (ms). */
function nextRun(now, minutes) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  const m = d.getUTCMinutes();
  const next = minutes.find((x) => x > m);
  if (next === undefined) { d.setUTCHours(d.getUTCHours() + 1); d.setUTCMinutes(minutes[0]); } else d.setUTCMinutes(next);
  return d.getTime();
}
/**
 * Whether the server's list of what was said holds a message sent from this page: the same words,
 * written down at most 10 minutes before the send (the clocks of the phone and the server differ).
 */
function sendHeld(send, said) {
  const words = String(send.text).trim();
  return (said || []).some((n) => n && String(n.text || '').trim() === words && Date.parse(n.at) >= send.at - 600000);
}
/**
 * The instructions on each Linear issue as the cards show them: the server's, and after them each
 * message sent from this page that the server does not hold yet, as a note in its state (sending,
 * waiting once sent, or refused with the reason). sends is the page's map of them.
 */
function notesWithSends(notes, sends) {
  // Before the database kept instructions there are none, and no box: a page that sent none keeps it so.
  if (!notes && ![...sends.keys()].some((k) => k.startsWith('issue:'))) return notes;
  const out = { ...(notes || {}) };
  for (const s of sends.values()) {
    if (!s.key.startsWith('issue:')) continue;
    const issue = s.key.slice(6), list = out[issue] || [];
    if (s.state === 'sent' && sendHeld(s, list)) continue;
    out[issue] = list.concat([{ id: 'send:' + s.at, text: s.text, at: new Date(s.at).toISOString(), state: s.state === 'sent' ? 'waiting' : s.state, error: s.error || '', local: true }]);
  }
  return out;
}
/**
 * A tutorial video card with the message sent from it, until the server holds it: while it goes the
 * card keeps its place and says so; once sent, Claude acts next and the card is at Claude's step.
 */
function cardWithSend(a, send) {
  if (!send) return a;
  if (send.state === 'sent') return a.instructed && sendHeld(send, [a.instructed]) ? a : { ...a, who: 'claude', instructed: { at: new Date(send.at).toISOString(), text: send.text, looked: true, fix: null }, send };
  return { ...a, send };
}
/** What Claude's change to a video did, by the state it is in now. */
const FIX_DONE = { working: 'started the change', open: 'made the change as a pull request that merges itself when its checks pass', merged: 'merged the change',
  closed: 'saw its pull request closed without a merge', failed: 'could not make the change', unneeded: 'found that no change was needed' };
/** Why the app Worker refused a tap, by the code it kept. */
const REFUSED_SAID = { decided: 'another admin answered it first', not_found: 'Claude cannot take an instruction on this issue', full: 'three instructions waited for Claude already', not_set_up: 'this is not set up here' };
/**
 * One entry of a card's record in words: who, what they did, and the words it was about (a suggestion's
 * title, an admin's instruction, the start of Claude's answer). bad: the tap was refused or failed.
 */
/** The agent team's record of a fix in the app, as its decision and reason say it ('merge', 'waits:paths', 'none:not_a_bug'). */
function appFixSaid(d) {
  if (d === 'merge') return 'wrote the fix. It keeps the rules, so it merges by itself when its checks pass';
  if (d === 'waits:instruction') return 'wrote the fix. It waits for your yes, as you asked';
  if (d === 'waits:stalled') return 'tried 3 times to get the fix into main. It waits for a developer';
  if (d.startsWith('waits')) return 'wrote the fix. The rules say a developer must read it';
  return 'made no change';
}
function recordSaid(r) {
  const ok = r.result === 'ok';
  const what = {
    suggestion_accepted: 'accepted Claude\'s suggestion', suggestion_rejected: 'rejected Claude\'s suggestion', suggestion_edited: 'changed the words of Claude\'s suggestion',
    tutorial_note: String(r.detail || '').startsWith('instruction:') || !ok ? 'sent an instruction to Claude' : 'added a note for Claude\'s next look',
    user_issue_note: 'sent an instruction to Claude',
    reply_posted: 'posted the reply on YouTube', reply_none: 'said that no reply is needed', reply_open: 'put the reply back on the list',
    suggested: 'suggested a change', answered: r.detail === 'changed' ? 'answered and changed the draft fix' : r.detail === 'none' ? 'wrote no answer' : 'answered',
    fix: FIX_DONE[r.detail] || 'changed the video',
    // A fix in the app (docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md), step by step.
    suggestion_fix: String(r.detail || '').endsWith(':ask_first') ? 'said Fix it, and asked to see the change before it merges' : 'said Fix it: Claude\'s agent team changes the app',
    handed: 'found that the cause is in the app, and gave the fix to its agent team',
    taken: 'started the fix in the app',
    appfix: appFixSaid(String(r.detail || '')),
    refilm: 'saw the fix merged, and sent the video to be filmed again',
    filmed: 'filmed the video again: the new film is in',
    // A change that failed, which a pull request of its own fixed (migration 20261121233000_tutorial_fixed_elsewhere.sql).
    fixed_elsewhere: 'saw that another pull request fixed it' + (r.detail ? ' (it changed ' + r.detail + ', the file Claude named)' : ' (it names this change)') +
      ', and that a new film came in after it'
  }[r.what] || r.what;
  const pr = r.pr ? ' (pull request ' + r.pr + ')' : '';
  const refused = ok ? '' : r.result === 'error' ? '. It did not work (' + (r.detail || 'an error') + ')' : '. Refused: ' + (REFUSED_SAID[r.detail] || r.detail || 'no reason given');
  const quote = r.words && r.what !== 'answered' ? String(r.words) : '';
  return { who: r.who, said: what + pr + refused, words: quote, bad: !ok };
}
/**
 * A card's record, newest first: the server's entries for the card (key), each message sent from this page that the
 * server does not have yet, and how the card began (found: { at, who, said }).
 */
function cardRecord(records, key, sends, sendKey, found) {
  const list = (records || []).filter((r) => r.key === key);
  const s = sends.get(sendKey);
  const local = s && !(s.state === 'sent' && list.some((r) => (r.what === 'tutorial_note' || r.what === 'user_issue_note') && sendHeld(s, [{ text: r.words, at: r.at }])))
    ? [{ at: new Date(s.at).toISOString(), who: 'You', what: s.key.startsWith('issue:') ? 'user_issue_note' : 'tutorial_note', result: s.state === 'refused' ? 'refused' : 'ok',
      detail: s.state === 'refused' ? s.error : 'instruction:', words: s.text, pr: null, key, local: s.state }] : [];
  const all = local.concat(list);
  if (found && found.at) all.push({ at: found.at, who: found.who, what: 'found', result: 'ok', detail: null, words: null, pr: null, key, said: found.said });
  return all.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}
/**
 * The tutorial video cards of a tab in order, with the short card each answered card left in its place.
 * cards are the tab's cards now; gone is the page's map of answered cards (key to { index, ... }).
 * An answered card shows as its short card where it was, also after it left the server's list.
 */
function withGone(cards, gone, keyOf) {
  const out = cards.map((a) => gone.has(keyOf(a)) ? { gone: gone.get(keyOf(a)) } : { card: a });
  const shown = new Set(cards.map(keyOf));
  const left = [...gone.values()].filter((g) => !shown.has(g.key)).sort((x, y) => x.index - y.index);
  for (const g of left) out.splice(Math.min(g.index, out.length), 0, { gone: g });
  return out;
}
`;

/** The page's state of sends and answered cards, and their drawing; uses the page's helpers (esc, when, say, $). */
export const SEND_SCRIPT = String.raw`
/** Messages to Claude sent from this page, by card: 'video:<card id>', 'issue:<Linear id>' or 'ask:<card>' (pageAsk.ts). */
const SENDS = new Map();
/** Tutorial video cards answered on this page, by card id, while their tab is open: the short card in their place. */
const GONE = new Map();
const sendClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** When Claude's next fix run for the videos, or the next run of the watch, starts, in the viewer's own time. */
const fixRunSaid = () => 'at about ' + sendClock(nextRun(Date.now(), FIX_RUN_MINUTES));
const watchSaid = () => 'at about ' + sendClock(nextRun(Date.now(), WATCH_MINUTES));
/** Drops each sent message the server's answer now holds, and each answered card when its tab is left. */
function pruneSends() {
  for (const [key, s] of SENDS) {
    if (s.state !== 'sent' || key.startsWith('ask:')) continue;
    if (key.startsWith('video:')) {
      const a = VIDEOS && VIDEOS.admin.find((x) => 'video:' + cardId(x) === key);
      if (!a || (a.instructed && sendHeld(s, [a.instructed]))) SENDS.delete(key);
    } else {
      const issue = key.slice(6);
      const lists = [userIssuesData(), results.research && results.research.state === 'ok' ? results.research.data : null].map((d) => d && d.notes ? d.notes[issue] : null).filter(Boolean);
      if (lists.some((l) => sendHeld(s, l))) SENDS.delete(key);
    }
  }
}
/** Who sent an instruction the server holds, by its words in the card's record: an admin's name, else "An admin". */
function saidBy(records, what, text) {
  const words = String(text || '').trim();
  const r = (records || []).find((x) => x.what === what && x.result === 'ok' && String(x.words || '').trim() === words);
  return r ? r.who : 'An admin';
}
/** A time in a record: the day and the clock, in the viewer's own time. */
const recordStamp = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/**
 * A card's record under it: the last entry and whose turn it is now, at a glance; every entry behind one tap.
 * Each admin sees what another admin did, and when (docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md).
 */
function recordHtml(entries, turn) {
  if (!entries.length) return '';
  // An entry in words; a message from this page that is not sent yet says so.
  const said = (r) => {
    const x = r.what === 'found' ? { who: r.who, said: r.said, words: '', bad: false } : recordSaid(r);
    return r.local === 'sending' ? { ...x, said: 'are sending an instruction to Claude…' }
      : r.local === 'refused' ? { ...x, said: 'tried to send an instruction to Claude. It was not sent: ' + (r.detail || 'no reason given'), bad: true } : x;
  };
  const line = (r) => {
    const x = said(r);
    return '<li' + (x.bad ? ' class="bad"' : '') + '><time datetime="' + esc(r.at) + '">' + esc(recordStamp(r.at)) + '</time><span><b>' + esc(x.who) + '</b> ' + esc(x.said) +
      (x.words ? '<q>' + esc(x.words.length > 160 ? x.words.slice(0, 159) + '…' : x.words) + '</q>' : '') + '</span></li>';
  };
  const last = entries[0], l = said(last);
  return '<details class="irecord"><summary><span class="rh">Record</span><span class="rlast">Last: <b>' + esc(l.who) + '</b> ' + esc(l.said) + ' · ' + esc(recordStamp(last.at)) + '</span>' +
    (turn ? '<span class="ipill ' + esc(turn[1] || '') + '">Now: ' + esc(turn[0]) + '</span>' : '') + '</summary><ol class="rlog">' + entries.map(line).join('') + '</ol></details>';
}
/** The short card an answered tutorial video card leaves in its place: what happened, your words, and where the card is now. */
function goneCard(g) {
  return '<article class="icard gone" data-card="' + esc(g.key) + '"><header class="ihead"><div class="ihl">' + (g.tags ? '<p class="itags">' + g.tags + '</p>' : '') + '<h4>' + esc(g.title) + '</h4></div>' +
    (g.pill ? '<span class="ipill ' + esc(g.pill[1]) + '">' + esc(g.pill[0]) + '</span>' : '') + '</header>' +
    '<p class="gonesaid" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg><span>' + esc(g.said) + '</span></p>' +
    (g.text ? '<div class="talk"><p class="said you">' + esc(g.text) + '</p><small>You · ' + esc(sendClock(g.at)) + '</small></div>' : '') +
    (g.where ? '<p class="gonewhere"><span>' + esc(g.where[0]) + '</span>' + (g.where[1] ? '<button type="button" data-vtab="' + esc(g.where[1]) + '">' + esc(g.where[2]) + '</button>' : '') + '</p>' : '') + '</article>';
}
`;
