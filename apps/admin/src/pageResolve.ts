/**
 * Resolved: an admin hides a line of the ops dashboard, and the line comes
 * back when its problem comes back
 * (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md).
 * Each Overview row and each line's card has a Resolved button. The page keeps
 * each part's answer as it came (RAW) and draws it without the resolved lines
 * (page.ts show), so the Overview, the menu's counts and every section agree.
 * A resolved line shows again with the tag "Came back" when it is worse, or
 * when Claude reads the line and finds that its problem came back (the
 * workflow card-questions.yml, at most every 3 hours for each resolve), with
 * Claude's reason. A resolve Claude has not checked for 27 hours shows too.
 * When the line goes from the page, the watch for user issues ends the resolve
 * (ops_line_resolves_seen, every 15 minutes), so the next time the problem
 * comes it shows at once. The lines the admin resolved are in the Overview's
 * Resolved list, with who resolved each, Claude's last reason and Show again. The watch for user
 * issues and the API's attention still see every line: a resolve changes only
 * what this page shows. Plain JavaScript inside page.ts's script, after
 * pageFixes.ts; everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const RESOLVE_CSS = String.raw`
.alert .gos button.go.resolve { display: inline-flex; gap: 4px; align-items: center; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink2); text-decoration: none; min-height: 32px; }
.alert .gos button.go.resolve:hover, .alert .gos button.go.resolve:focus-visible { color: var(--green); }
.alert .gos button.go.resolve svg.ic .f { fill: var(--grey); } .alert .gos button.go.resolve:hover svg.ic .f { fill: var(--green); }
.icard .ibar button.resolve, button.resolve.button { display: inline-flex; gap: 6px; align-items: center; }
.backtag { display: inline-block; font-size: 11px; font-weight: 700; line-height: 18px; padding: 0 7px; border-radius: 6px; color: var(--amber); background: var(--amberbg); margin-inline-start: 8px; vertical-align: 2px; }
.icard .itags .tag.back { color: var(--amber); background: var(--amberbg); }
.rsline .fx button.link { min-height: 32px; font-weight: 600; margin-inline-start: 8px; }
.backwhy { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0 0; font-size: 13px; color: var(--ink2); }
.backwhy .who { flex: none; display: inline-flex; width: 20px; min-width: 0; padding-top: 3px; margin: 0; } .backwhy svg.ic { flex: none; } .backwhy svg.ic .f { fill: var(--amber); } .rsline .backwhy svg.ic .f { fill: var(--grey); }
`;

/** Pure: apps/admin/test/resolve.test.ts runs these with new Function, after pageFixes.ts FIX_LOGIC. */
export const RESOLVE_LOGIC = String.raw`
/** Claude checks each resolve every 3 hours (ops._line_resolve_every); a resolve with no check for this long shows its line again. */
const RESOLVE_UNCHECKED_MS = 27 * 3600000;
/** At most this many lines in one tap (apps/web/worker/opsActions.ts RESOLVE_MAX). */
const RESOLVE_LINES_MAX = 20;
/** The line's words a resolve keeps for Claude (ops.line_resolves.text). */
const RESOLVE_TEXT_MAX = 1000;
const RESOLVE_RANK = { urgent: 0, problem: 1, watch: 2 };
/** As alertKinds.ts alertId. */
function resolveLineId(a) { return a.subject ? a.key + ':' + a.subject : a.key; }

/**
 * Why a resolved line shows again now, or '' while it stays resolved. a: the line as its part answers
 * now; r: its open resolve ({ level, at, checkedAt, verdict }).
 * worse: its level is higher than when it was resolved. claude: Claude read the line and found that its
 * problem came back (card-questions.yml). unchecked: Claude has not checked it for 27 hours, so the page
 * cannot say it is the same problem.
 */
function resolveBack(a, r, now) {
  const at = Date.parse(r && r.at);
  if (!Number.isFinite(at)) return 'unchecked';
  if ((RESOLVE_RANK[a.level] ?? 2) < (RESOLVE_RANK[r.level] ?? 2)) return 'worse';
  if (r.verdict === 'back') return 'claude';
  const checked = Date.parse(r.checkedAt);
  if (now >= Math.max(at, Number.isFinite(checked) ? checked : at) + RESOLVE_UNCHECKED_MS) return 'unchecked';
  return '';
}

/**
 * A part's lines with the resolves: shown (each line that is not resolved, and each that came back,
 * a copy with back: why, and backWhy: Claude's words) and hidden ([{ a, r }]). resolves: the open
 * resolves by line id.
 */
function splitResolved(alerts, resolves, now) {
  const shown = [], hidden = [];
  for (const a of alerts || []) {
    const r = a && a.key !== 'unreadable' ? resolves[resolveLineId(a)] : null;
    if (!r) { shown.push(a); continue; }
    const back = resolveBack(a, r, now);
    if (back) shown.push(Object.assign({}, a, back === 'claude' && r.why ? { back, backWhy: r.why } : { back })); else hidden.push({ a, r });
  }
  return { shown, hidden };
}

/** What a tap on Resolved sends for these lines of one part, as the page shows them now. */
function resolvePayload(lines, part, titleOf, textOf) {
  return lines.filter((a) => a && a.key && a.key !== 'unreadable').slice(0, RESOLVE_LINES_MAX).map((a) => ({
    line: resolveLineId(a), part, level: a.level in RESOLVE_RANK ? a.level : 'watch',
    measure: typeof a.measure === 'number' && Number.isFinite(a.measure) && a.measure >= 0 ? a.measure : null,
    title: String(titleOf(a) || resolveLineId(a)).slice(0, 300),
    text: String((textOf && textOf(a)) || a.text || '').slice(0, RESOLVE_TEXT_MAX)
  }));
}
`;

/** Drawing and tapping; uses the page's helpers (esc, ago, $, api, perform, icon, splitAlert, tidy, SECTIONS, results, show). */
export const RESOLVE_SCRIPT = String.raw`
/** Each part's answer as it came, before the resolved lines are taken out (results holds what the page draws). */
const RAW = {};
/** The open resolves (diag.ops_line_resolves), or null before the first read. */
let RESOLVES = null;
function resolvesByLine() {
  const out = {};
  for (const r of RESOLVES || []) if (r && r.line) out[r.line] = r;
  return out;
}
/** A part's answer as the page draws it: without its resolved lines, with back on those that came back. */
function withoutResolved(s) {
  if (!s || !s.alerts || !s.alerts.length || !RESOLVES || !RESOLVES.length) return s;
  const split = splitResolved(s.alerts, resolvesByLine(), Date.now());
  if (!split.hidden.length && split.shown.every((a, i) => a === s.alerts[i])) return s;
  return Object.assign({}, s, { alerts: split.shown });
}
/** Reads the resolves again and draws every section and the Overview. A failed read keeps what the page shows. */
async function loadResolves() {
  try { RESOLVES = (await api('/ops/api/resolves')) || []; } catch { if (!RESOLVES) RESOLVES = []; }
  for (const id of Object.keys(RAW)) results[id] = withoutResolved(RAW[id]);
  for (const g of SECTIONS) { const p = g.parts.find((x) => RAW[x]); if (p) show(p, RAW[p]); }
  renderStart();
}
/** The lines the admin resolved that stay hidden now, newest first, each with its resolve. */
function handResolved() {
  if (!RESOLVES || !RESOLVES.length) return [];
  const byLine = resolvesByLine(), now = Date.now(), present = new Map();
  for (const [part, s] of Object.entries(RAW)) for (const a of (s && s.alerts) || []) present.set(resolveLineId(a), { a, part });
  return RESOLVES.filter((r) => { const p = present.get(r.line); return !p || !resolveBack(p.a, byLine[r.line], now); });
}
const lineTitle = (a) => splitAlert(tidy(a.text)).title.replace(/\.$/, '');
/** The Resolved button for lines of one part: an Overview row's lines, or one card's line. */
function resolveButton(lines, part, cls) {
  const payload = resolvePayload(lines, part, lineTitle, (a) => tidy(a.text));
  if (!payload.length) return '';
  return '<button type="button" class="' + esc(cls) + ' resolve" data-resolve="' + esc(JSON.stringify(payload)) + '" data-help-key="Resolved button">' + icon('done') + 'Resolved</button>';
}
/** The tag on a line that came back after a resolve. */
const backTag = (a, cls) => a && a.back ? '<span class="' + cls + '" data-help-key="Came back: ' + esc(a.back) + '">Came back</span>' : '';
/** Claude's reason when it found the problem came back. */
const backWhy = (a) => a && a.backWhy ? '<p class="backwhy"><span class="who" data-help-key="Claude says">' + icon('claude') + '</span><span>' + esc(a.backWhy) + '</span></p>' : '';
/** The lines the admin resolved, for the Overview's Resolved list: who resolved each, when, and Show again. */
function handResolvedHtml(list) {
  return list.map((r) => '<div class="rsline">' + icon('done') + '<div><b>' + esc(r.title) + '</b><span class="fx"><span class="muted">Resolved by ' + esc(r.who || 'an admin') + ' · ' + esc(ago(r.at)) + '</span>' +
    '<button type="button" class="link" data-unresolve="' + esc(r.line) + '">Show again</button></span>' +
    (r.verdict === 'same' && r.why ? '<p class="backwhy"><span class="who" data-help-key="Claude checked">' + icon('claude') + '</span><span><span class="muted">' + esc(ago(r.checkedAt)) + ':</span> ' + esc(r.why) + '</span></p>' : '') + '</div></div>').join('');
}
/** A card the address names that is hidden as resolved. */
function resolvedCard(card) {
  const m = /^line:(.+)$/.exec(String(card || ''));
  return Boolean(m) && handResolved().some((r) => r.line === m[1]);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-resolve], [data-unresolve]');
  if (!b) return;
  if (b.dataset.resolve) {
    let lines = [];
    try { lines = JSON.parse(b.dataset.resolve); } catch { return; }
    perform({ kind: 'line-resolve', lines }, b);
  } else perform({ kind: 'line-show', lines: [b.dataset.unresolve] }, b);
});
`;
