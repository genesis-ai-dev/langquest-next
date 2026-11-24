/**
 * "Ask Claude" on every card and every page of the ops dashboard
 * (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md). A
 * line's card with no Linear issue (pageCards.ts lineCard), each section's
 * page (pageSummary.ts) and the Overview (pageOverview.ts) have a box. The
 * question goes with the card's words and numbers as the page shows them, so
 * Claude knows what the admin looks at. The workflow card-questions.yml takes
 * it every 5 minutes; Claude reads the code, production, the logs and, when
 * the question needs it, public web pages, and answers. The answer shows
 * under the question. A card with a Linear issue keeps its own box, "Tell
 * Claude what to do" (pageIssues.ts issueTalk), which also answers.
 * Plain JavaScript inside page.ts's script; everything shown is escaped.
 */

/** The look, inside page.ts's style element; the talk and the box use pageIssues.ts's .talk, .said and .tell. */
export const ASK_CSS = String.raw`
.sblock.ask .tell textarea { min-height: 64px; }
.sblock.ask .talk { margin-bottom: 10px; }
.askhint { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
`;

/** Pure: apps/admin/test/ask.test.ts runs these with new Function. */
export const ASK_LOGIC = String.raw`
/** The minutes past each hour (UTC) that card-questions.yml starts. */
const ASK_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
/** The longest card words and question the database keeps (server/cardQuestions.ts QUESTION_MAX). */
const ASK_MAX = { title: 300, context: 6000, text: 2000 };
/** A card's key as an element id: letters and digits only, the same for the same key. */
function askId(card) {
  let h = 5381;
  for (const c of String(card)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return 'ask-' + h.toString(36) + '-' + String(card).replace(/[^a-z0-9]/gi, '').slice(-24);
}
/** The card's words as the admin sees them: one line each, no blank lines, at most ASK_MAX.context characters. */
function askContext(text) {
  const lines = String(text || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = lines.join('\n');
  return out.length > ASK_MAX.context ? out.slice(0, ASK_MAX.context - 1) + '…' : out;
}
/**
 * The questions on each card as the boxes show them: the server's, and after them each question sent
 * from this page that the server does not hold yet (sending, waiting once sent, or refused with the
 * reason). sends is the page's map of them (pageSends.ts SENDS), keyed 'ask:<card>'.
 */
function questionsWithSends(questions, sends) {
  const out = { ...(questions || {}) };
  for (const s of sends.values()) {
    if (!s.key.startsWith('ask:')) continue;
    const card = s.key.slice(4), list = out[card] || [];
    if (s.state === 'sent' && sendHeld(s, list)) continue;
    out[card] = list.concat([{ id: 'send:' + s.at, text: s.text, at: new Date(s.at).toISOString(), state: s.state === 'sent' ? 'waiting' : s.state, error: s.error || '', local: true }]);
  }
  return out;
}
/** Whether Claude still owes an answer on the page: then the page reads the answers again each minute. */
function askWaits(questions) {
  return Object.values(questions || {}).some((list) => (list || []).some((q) => q.state === 'waiting' || q.state === 'working' || q.state === 'sending'));
}
/** Claude's side of the talk for a question with no answer yet, in words; next is the clock time of the next run. */
function askSaid(q, next) {
  if (q.state === 'waiting') return (q.local ? 'Sent. ' : '') + 'Claude starts on it at its next run, at about ' + next + '. The answer shows here.';
  if (q.state === 'working') return 'Claude works on it now. The answer shows here in a few minutes.';
  if (q.state === 'stopped') return 'Claude did not answer. Two runs tried. Ask again.';
  if (q.state === 'answered' && !q.answer) return 'Claude ended without an answer. Ask again.';
  return q.answer || '';
}
`;

/** Drawing and sending; uses the page's helpers (esc, when, say, sayAt, $, api, perform, SENDS, saidHtml, outLink, safeLink, nextRun, sendClock). */
export const ASK_SCRIPT = String.raw`
/** Each card's questions and answers (diag.ops_card_questions), or null before the first read. */
let QUESTIONS = null;
const askNext = () => sendClock(nextRun(Date.now(), ASK_MINUTES));
/** Reads the questions again and draws every box. A failed read keeps what the page shows. */
async function loadQuestions() {
  try { QUESTIONS = (await api('/ops/api/questions')) || {}; } catch { if (!QUESTIONS) QUESTIONS = {}; }
  pruneAsks();
  redrawAsks();
}
/** Drops each sent question the server's answer now holds. */
function pruneAsks() {
  for (const [key, s] of SENDS) if (key.startsWith('ask:') && s.state === 'sent' && QUESTIONS && sendHeld(s, QUESTIONS[key.slice(4)] || [])) SENDS.delete(key);
}
/** Every place a box is: the lines' cards, the page's summary and the Overview. */
function redrawAsks() {
  redrawLineCards();
  drawSummary();
  renderStart();
}
// While Claude owes an answer and the page is in view, the answers are read again each minute.
setInterval(() => {
  if (document.visibilityState === 'visible' && $('board') && !$('board').hidden && askWaits(questionsWithSends(QUESTIONS, SENDS))) loadQuestions();
}, 60000);

/**
 * The talk on one card and its box. card: 'line:<key>[:<subject>]' or 'page:<section>'; page: the section
 * the card is on; title: the card's title, sent with the question.
 */
function askTalk(card, page, title) {
  const list = questionsWithSends(QUESTIONS, SENDS)[card] || [];
  const talk = list.map((q) => {
    if (q.local && q.state === 'sending') return '<p class="said you sending">' + esc(q.text) + '</p><small class="you sending">Sending…</small>';
    if (q.local && q.state === 'refused') return '<p class="said you refused">' + esc(q.text) + '</p><small class="you">Not sent</small>' +
      '<div class="said claude refused" role="alert"><p>' + esc('Not sent: ' + q.error + ' Your words are back in the box. Send them again.') + '</p></div><small></small>';
    const said = askSaid(q, askNext());
    const run = q.state === 'working' || q.state === 'stopped' ? safeLink(q.runUrl) : '';
    return '<p class="said you">' + esc(q.text) + '</p><small class="you">' + esc(q.local ? 'You' : q.who || 'An admin') + ' · ' + when(q.at) + '</small>' +
      '<div class="said claude">' + saidHtml(said) + '</div><small>Claude' + (q.answeredAt ? ' · ' + when(q.answeredAt) : '') + (run ? ' · ' + outLink(run, 'The run') : '') + '</small>';
  }).join('');
  const id = askId(card), busy = list.some((q) => q.local && q.state === 'sending');
  return (talk ? '<div class="talk">' + talk + '</div>' : '') +
    '<div class="tell"><textarea id="' + esc(id) + '" maxlength="' + ASK_MAX.text + '" rows="3" aria-label="Your question to Claude"' + (busy ? ' readonly' : '') +
    ' placeholder="' + (list.length ? 'Ask another question…' : 'Ask Claude about this…') + '"></textarea>' +
    '<small>Claude reads this ' + (card.startsWith('page:') ? 'page' : 'card') + ', the code, production and the logs, at about ' + esc(askNext()) + '.</small>' +
    '<button type="button" class="primary" data-ask="' + esc(card) + '" data-ask-page="' + esc(page) + '" data-ask-title="' + esc(String(title || '').slice(0, ASK_MAX.title)) + '"' +
    (busy ? ' disabled aria-busy="true">Sending…' : '>Ask Claude') + '</button></div>';
}
/** A page's own box, at the end of its summary: questions about the whole page. */
function askBlock(card, page, title) {
  return '<section class="sblock ask" data-ask-card="' + esc(card) + '"><div class="sh"><h2>Ask Claude about this page</h2><span class="sp"></span></div>' +
    askTalk(card, page, title) + '</section>';
}
/** The words a question goes with: the card as the admin sees it, without its talk, box and record; a page's box takes the page. */
function askWordsOf(button) {
  const card = button.closest('[data-card]');
  // What the admin sees in a box, without the talks and records of the cards in it.
  const visible = (el) => {
    if (!el || el.offsetParent === null) return '';
    let t = el.innerText;
    for (const x of el.querySelectorAll('.italk, .irecord, .sblock.ask')) { const w = x.innerText; if (w) t = t.replace(w, ''); }
    return t;
  };
  if (card) return askContext([...card.children].filter((c) => !c.matches('.italk, .irecord, .tell, .talk')).map((c) => c.innerText).join('\n'));
  const parts = [$('view-title') ? $('view-title').innerText : '', visible($('view-say'))];
  for (const id of ['start', 'sum']) {
    const el = $(id);
    if (!el || el.hidden) continue;
    parts.push([...el.children].filter((c) => !c.matches('.sblock.ask, #start-ask')).map(visible).join('\n'));
  }
  return askContext(parts.join('\n'));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-ask]');
  if (!b) return;
  const card = b.dataset.ask, id = askId(card);
  const text = (($(id) || {}).value || '').trim();
  if (!text) { say('Write your question first.', 'red'); sayAt(b, 'Write your question first.', 'red'); return; }
  perform({ kind: 'card-question', card, page: b.dataset.askPage, title: b.dataset.askTitle || card, context: askWordsOf(b), text: text.slice(0, ASK_MAX.text) }, b,
    { talk: { key: 'ask:' + card, text: text.slice(0, ASK_MAX.text), box: id } });
});
`;
