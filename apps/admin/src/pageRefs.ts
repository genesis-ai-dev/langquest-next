/**
 * What "PR 596" and "LAN-316" are about, wherever the page names one: a
 * mouse over the number, a tap on it, or the keyboard's focus on it shows a
 * box with its title, a few plain lines and its state. A person does not
 * remember hundreds of pull requests and issues, so the number alone tells
 * them nothing.
 *
 * Every number is found in the page's text after each drawing (one pass of
 * its text, so no part has code of its own for this), and marked with a
 * dotted line. A pull request's words come from /ops/api/prs (sources/prs.ts:
 * GitHub's title and text, read by the Worker, so the browser holds no
 * token); a Linear issue's from the watch for user issues (its title and
 * the issue in its own words) and from the pull requests that name it.
 *
 * A mouse shows the box while it is over the number, and a click still
 * opens the link. A finger's first tap shows the box with an Open button,
 * and a tap anywhere else takes it away.
 *
 * Plain JavaScript run inside page.ts's script, after pageFixes.ts.
 */

/** The marks and the box, inside page.ts's style element. */
export const REF_CSS = String.raw`
.ref { text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: help; }
a.ref, a .ref { cursor: pointer; }
.ref:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }
#rf { position: fixed; z-index: 11; left: 0; top: 0; width: max-content; max-width: min(380px, calc(100vw - 16px)); padding: 10px 12px; border-radius: 10px;
  background: var(--card); color: var(--ink); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.18); font-size: 13px; font-weight: 400; line-height: 1.45; text-align: start; }
#rf .k { font-size: 11.5px; font-weight: 600; color: var(--muted); letter-spacing: .02em; }
#rf b { display: block; font-size: 14px; font-weight: 600; margin-top: 2px; }
#rf .s { margin-top: 6px; white-space: pre-line; }
#rf .m { margin-top: 6px; font-size: 12px; color: var(--muted); }
#rf .m i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; background: var(--muted); }
#rf .m i.merged, #rf .m i.done { background: var(--green); } #rf .m i.open { background: var(--amber); } #rf .m i.closed { background: var(--red); }
#rf a.go { display: inline-flex; align-items: center; min-height: 48px; margin-top: 4px; color: var(--primary); font-weight: 600; text-decoration: none; }
#rf:not(.touch) a.go { display: none; }
`;

/** Pure: apps/admin/test/refs.test.ts runs these with new Function, so what the box says is tested without a browser. */
export const REF_LOGIC = String.raw`
/** "PR 596", "PR #596", "pull request 596" and "LAN-316" in a text, in order. */
const REF_RE = /\b(?:PR #?|pull request #?)(\d{1,6})\b|\b(LAN-\d{1,7})\b/g;
function refsIn(text) {
  return [...String(text || '').matchAll(REF_RE)].map((m) => ({ ref: m[1] ? 'pr:' + m[1] : 'lan:' + m[2], start: m.index, end: m.index + m[0].length }));
}

/** "3 h ago", "2 days ago". */
function refAgo(iso, now) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 60) return min <= 1 ? 'just now' : min + ' min ago';
  const h = Math.round(min / 60);
  if (h < 48) return h + ' h ago';
  return Math.round(h / 24) + ' days ago';
}

/** A Linear or pull request title without its LAN numbers: "iPhone flows wait for the passage (LAN-284, LAN-287)" to "iPhone flows wait for the passage". */
const refTitle = (t) => String(t || '').replace(/^LAN-\d+:?\s*/, '').replace(/\s*\((?:LAN-\d+(?:,\s*)?)+\)/g, '').trim();

const STORE = { ios: ['App Store', 'iPhone'], android: ['Google Play', 'Android'] };

/**
 * What the box says about a ref, as plain parts (the script escapes them):
 * kind (the number), title, summary, state (words and a dot), and the link.
 * prs holds /ops/api/prs's answers (undefined: not read yet; null: GitHub
 * does not know it); ud is the watch for user issues' answer; fixes the pull
 * requests that name an issue (/ops/api/fixes).
 */
function refSays(ref, prs, ud, fixes, now) {
  const [kind, id] = String(ref).split(':');
  if (kind === 'pr') {
    const n = Number(id), p = prs[n], url = 'https://github.com/genesis-ai-dev/langquest-next/pull/' + n;
    if (p === undefined) return { kind: 'Pull request ' + n, title: 'Loading…', url };
    if (p === null) return { kind: 'Pull request ' + n, title: 'GitHub does not know this pull request.', url };
    const state = p.state === 'merged' ? { dot: 'merged', text: 'Merged ' + refAgo(p.at, now) }
      : p.state === 'open' ? { dot: 'open', text: 'Open: not merged yet' } : { dot: 'closed', text: 'Closed without a merge' };
    if (p.copyFor) {
      const [store, phone] = STORE[p.copyFor];
      const of = p.copyOf ? prs[p.copyOf] : null;
      return {
        kind: 'Copy PR ' + n, url, state,
        title: p.title,
        summary: 'The same change' + (p.copyOf ? ' as PR ' + p.copyOf : '') + ', sent as an update to the ' + phone + ' app people have from the ' + store + '.' + (of && of.summary ? '\n' + of.summary : '')
      };
    }
    return { kind: 'Pull request ' + n, title: p.title, summary: p.summary || '', state, url };
  }
  const issue = id;
  const url = 'https://linear.app/frontierrandd/issue/' + encodeURIComponent(issue);
  const row = ((ud && ud.issues) || []).find((x) => x.issue === issue) || ((ud && ud.lines) || []).find((x) => x.issue === issue) || null;
  const naming = (fixes || []).filter((p) => (p.issues || []).includes(issue)).sort((a, b) => (a.state === b.state ? 0 : a.state === 'merged' ? -1 : 1));
  const fix = naming[0] || null;
  const words = row && (row.problem || row.context) ? [row.problem || row.context, row.solution ? 'Fix: ' + row.solution : ''].filter(Boolean).join('\n') : '';
  const title = row && row.title ? refTitle(row.title) : fix ? refTitle(fix.title) : 'Open it in Linear for its title.';
  const fixTitle = fix ? refTitle(fix.title) : '';
  const fixLine = fix ? (fix.state === 'merged' ? 'Fixed in PR ' : 'Fix waits on merge: PR ') + fix.number + (fixTitle && fixTitle !== title ? ' "' + fixTitle + '"' : '') : '';
  const closed = row && row.closedAt;
  const state = row && row.state ? { dot: closed ? 'done' : 'open', text: 'Linear: ' + row.state + (closed ? ', closed ' + refAgo(row.closedAt, now) : '') } : null;
  return { kind: 'Linear issue ' + issue, title, summary: [words, fixLine].filter(Boolean).join('\n'), state, url };
}
`;

/** Finding the numbers in the page's text, reading the pull requests, and the box. */
export const REF_SCRIPT = String.raw`
const refPrs = {};
const refAsked = new Set();
let refQueue = new Set(), refTimer = 0;

/** Asks the Worker about the pull requests the page names that it has not asked about yet, 40 at a time. */
function refFetch(n) {
  if (refAsked.has(n)) return;
  refAsked.add(n); refQueue.add(n);
  clearTimeout(refTimer);
  refTimer = setTimeout(async () => {
    const all = [...refQueue]; refQueue = new Set();
    // Signed out, the page has nothing to ask with: it asks again once a drawing names them.
    if ($('board').hidden) { for (const k of all) refAsked.delete(k); return; }
    for (let i = 0; i < all.length; i += 40) {
      const part = all.slice(i, i + 40);
      try {
        const d = await api('/ops/api/prs?n=' + part.join(','));
        for (const k of part) { if (k in d.prs) { refPrs[k] = d.prs[k]; const c = d.prs[k] && d.prs[k].copyOf; if (c) refFetch(c); } else refAsked.delete(k); }
      } catch { for (const k of part) refAsked.delete(k); }
    }
    if (refNow) refShow(refNow.el, refNow.touch);
  }, 120);
}

const REF_SKIP = 'script,style,textarea,input,select,option,button,svg,#rf,.ref,[contenteditable]';
/** Marks every number in the text under root: a link that is only the number becomes the mark; elsewhere a span does. */
function refWrap(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => !t.data || !/PR|LAN-|pull request/.test(t.data) || (t.parentElement && t.parentElement.closest(REF_SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const found = [];
  for (let t = walk.nextNode(); t; t = walk.nextNode()) found.push(t);
  for (const t of found) {
    const refs = refsIn(t.data);
    if (!refs.length) continue;
    const a = t.parentElement && t.parentElement.closest('a');
    for (const r of refs) if (r.ref.startsWith('pr:')) refFetch(Number(r.ref.slice(3)));
    if (a && refs.length === 1 && a.textContent.trim() === t.data.slice(refs[0].start, refs[0].end).trim()) {
      a.classList.add('ref'); a.dataset.ref = refs[0].ref; continue;
    }
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const r of refs) {
      frag.append(t.data.slice(at, r.start));
      const s = document.createElement('span');
      s.className = 'ref'; s.dataset.ref = r.ref; s.textContent = t.data.slice(r.start, r.end);
      if (!a) s.tabIndex = 0;
      frag.append(s);
      at = r.end;
    }
    frag.append(t.data.slice(at));
    t.replaceWith(frag);
  }
}
let refPass = 0;
new MutationObserver(() => { if (!refPass) refPass = requestAnimationFrame(() => { refPass = 0; refWrap(document.body); }); })
  .observe(document.body, { childList: true, subtree: true, characterData: true });

let refNow = null, refHideTimer = 0;
function refBox() {
  let box = $('rf');
  if (!box) { box = document.createElement('div'); box.id = 'rf'; box.hidden = true; box.setAttribute('role', 'tooltip'); document.body.appendChild(box); }
  return box;
}
function refShow(el, touch) {
  clearTimeout(refHideTimer);
  const s = refSays(el.dataset.ref, refPrs, userIssuesData(), fixPrList(), Date.now());
  const box = refBox();
  box.classList.toggle('touch', Boolean(touch));
  box.innerHTML = '<div class="k">' + esc(s.kind) + '</div><b>' + esc(s.title) + '</b>' +
    (s.summary ? '<div class="s">' + esc(s.summary) + '</div>' : '') +
    (s.state ? '<div class="m"><i class="' + esc(s.state.dot) + '"></i>' + esc(s.state.text) + '</div>' : '') +
    '<a class="go" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open ' + (s.kind.startsWith('Linear') ? 'in Linear' : 'on GitHub') + ' ↗</a>';
  box.hidden = false;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), w = document.documentElement.clientWidth;
  box.style.left = Math.max(8, Math.min(w - b.width - 8, r.left)) + 'px';
  box.style.top = (r.bottom + 6 + b.height <= window.innerHeight || r.top - b.height - 6 < 4 ? r.bottom + 6 : r.top - b.height - 6) + 'px';
  refNow = { el, touch };
  el.setAttribute('aria-describedby', 'rf');
}
function refHide() {
  clearTimeout(refHideTimer);
  if (refNow) refNow.el.removeAttribute('aria-describedby');
  refNow = null;
  refBox().hidden = true;
}
const refOf = (t) => (t && t.closest ? t.closest('[data-ref]') : null);
let refFinger = false;
document.addEventListener('pointerdown', (e) => { refFinger = e.pointerType !== 'mouse'; if (refNow && refNow.touch && !e.target.closest('#rf') && refOf(e.target) !== refNow.el) refHide(); }, true);
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = refOf(e.target);
  if (el) { if (!refNow || refNow.el !== el) refShow(el, false); else clearTimeout(refHideTimer); }
  else if (e.target.closest && e.target.closest('#rf')) clearTimeout(refHideTimer);
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse' || !refNow || refNow.touch) return;
  const to = e.relatedTarget;
  if (to && (refOf(to) === refNow.el || (to.closest && to.closest('#rf')))) return;
  refHideTimer = setTimeout(refHide, 200);
});
// A finger's first tap on a number shows the box; the box's Open button follows the link.
document.addEventListener('click', (e) => {
  const el = refOf(e.target);
  if (!el || !refFinger || e.target.closest('#rf')) return;
  if (refNow && refNow.el === el) { refHide(); return; }
  e.preventDefault(); e.stopPropagation();
  refShow(el, true);
}, true);
document.addEventListener('focusin', (e) => { const el = refOf(e.target); if (el && el.matches(':focus-visible')) refShow(el, false); });
document.addEventListener('focusout', (e) => { if (refNow && refOf(e.target) === refNow.el && !refNow.touch) refHide(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && refNow) refHide(); });
window.addEventListener('scroll', () => { if (refNow) refHide(); }, { passive: true, capture: true });
`;
