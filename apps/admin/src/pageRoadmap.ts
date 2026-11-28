/**
 * The Roadmap page (docs/roadmap.md, docs/decisions/2026-11-27-a-public-roadmap-that-anyone-can-answer.md):
 * the public roadmap's items in their parts, how important people said each one is and what they wrote,
 * and the suggestions that wait for an answer. A tap on an item opens it to change its part, words,
 * picture and Linear issue; a suggestion becomes a new item, is added to an item, or is hidden. Plain
 * JavaScript inside page.ts's script, like pageResearch.ts; everything shown is escaped. Names start with
 * rm so they never meet another page's.
 */

/** The page's look, inside page.ts's style element. */
export const ROADMAP_CSS = String.raw`
.rmtop { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; margin: 0 0 12px; }
.rmtop a.button { display: inline-flex; align-items: center; text-decoration: none; }
.rmbox { background: var(--raised); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; margin: 0 0 14px; }
.rmbox > h4 { margin: 2px 0 6px; font-size: 15px; }
.rmsug { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
.rmsug:first-of-type { border-top: 0; }
.rmsug p { margin: 0; white-space: pre-line; }
.rmsug small, .rmnote small { color: var(--muted); }
.rmacts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.rmacts select { width: auto; max-width: 220px; min-height: 40px; }
.rmchip { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 1px 8px; border-radius: 999px; margin-inline-end: 6px; }
.rmk3 { background: var(--red); color: #fff; } .rmk2 { background: var(--orange); color: #fff; } .rmk1 { background: var(--yellow); color: #16181D; } .rmk0 { background: var(--soft); color: var(--ink2); }
.rmboard { display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 12px; overflow-x: auto; }
.rmcol { background: var(--soft); border-radius: 12px; padding: 10px; display: grid; align-content: start; gap: 8px; min-width: 0; }
.rmcol > h4 { display: flex; justify-content: space-between; margin: 2px 4px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.rmitem { display: grid; gap: 7px; text-align: start; padding: 10px 11px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; font: inherit; color: inherit; cursor: pointer; min-height: 48px; height: auto; white-space: normal; }
.rmitem[aria-pressed="true"] { outline: 2px solid var(--primary); }
.rmitem b { font-size: 13.5px; line-height: 1.3; }
.rmitem .rmmeta { display: flex; gap: 10px; font-size: 12px; color: var(--muted); font-weight: 400; }
.rmbar { display: block; width: 100%; height: 8px; border-radius: 4px; }
.rmbar .rmb3 { fill: var(--red); } .rmbar .rmb2 { fill: var(--orange); } .rmbar .rmb1 { fill: var(--yellow); } .rmbar .rmb0 { fill: var(--grey); } .rmbar .rmbn { fill: var(--line); }
.rmedit { position: fixed; top: 0; bottom: 0; inset-inline-end: 0; width: min(460px, 100%); overflow-y: auto; z-index: 60; background: var(--card); border-inline-start: 1px solid var(--line); box-shadow: -8px 0 30px rgb(0 0 0 / .14); padding: 18px 20px 28px; }
.rmedit h4 { margin: 0 0 2px; font-size: 18px; }
.rmedit label { display: block; margin: 12px 0 4px; font-size: 12px; font-weight: 600; color: var(--muted); }
.rmedit .rmhead { display: flex; gap: 10px; align-items: start; justify-content: space-between; }
.rmseg { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.rmseg button { min-height: 40px; padding: 2px 4px; font-size: 12px; white-space: normal; }
.rmseg button[aria-pressed="true"] { background: var(--ink); color: var(--card); border-color: var(--ink); }
.rmcounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; text-align: center; }
.rmcounts div { border-radius: 10px; padding: 6px 2px; background: var(--soft); font-size: 11.5px; color: var(--muted); }
.rmcounts strong { display: block; font-size: 20px; color: var(--ink); }
.rmpic { display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover; border-radius: 10px; background: var(--soft); margin: 0 0 6px; }
.rmrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
.rmnote { border-top: 1px solid var(--line); padding: 9px 0; font-size: 14px; display: grid; gap: 3px; }
.rmnote p { margin: 0; white-space: pre-line; }
@media (max-width: 900px) { .rmboard { grid-template-columns: repeat(4, 220px); } .rmsug { grid-template-columns: minmax(0, 1fr); } .rmacts { justify-content: flex-start; } }
`;

/** Pure: apps/admin/test/roadmap.test.ts runs these with new Function. */
export const ROADMAP_LOGIC = String.raw`
/** The parts of the public page, then the two the page does not show as a part, in board order. */
const RM_STATES = [['progress', 'In progress'], ['planned', 'Planned'], ['considering', 'Under consideration'], ['done', 'Done'], ['hidden', 'Hidden']];
const RM_IMPORTANCE = ['Not important', 'Nice to have', 'Important', 'Critical'];
/** How many people answered an item, and how many of them wrote something. */
const rmTotal = (i) => (i.counts || []).reduce((a, b) => a + Number(b || 0), 0);
const rmWrote = (i) => (i.notes || []).filter((n) => n.words).length;
/** An item's place on the board: the most critical first, then the most answered, then the newest. */
function rmOrder(items) {
  return (items || []).slice().sort((a, b) => (b.counts?.[3] || 0) - (a.counts?.[3] || 0) || rmTotal(b) - rmTotal(a) || Date.parse(b.at) - Date.parse(a.at));
}
/** The four lengths of an item's bar, out of 100, critical first; none when nobody answered. */
function rmBarParts(counts) {
  const c = counts || [0, 0, 0, 0];
  const total = c.reduce((a, b) => a + Number(b || 0), 0);
  if (!total) return [];
  let x = 0;
  return [3, 2, 1, 0].filter((k) => c[k] > 0).map((k) => { const w = (c[k] / total) * 100; const p = { k, x, w }; x += w; return p; });
}
/** What Save sends: the item as the editor holds it. picture undefined keeps the picture. */
function rmItemAction(id, state, title, body, issue, picture) {
  const a = { kind: 'roadmap-item', id: id === 'new' ? null : id, state, title: String(title || '').trim(), body: String(body || '').trim(), issue: String(issue || '').trim().toUpperCase() || null };
  if (picture !== undefined) a.picture = picture;
  return a;
}
`;

/** Drawing the page; uses the page's helpers (esc, num, when, post, say, reread, results, show). */
export const ROADMAP_SCRIPT = String.raw`
/** The item open in the editor ('new' for a new one), the part chosen there, and its picture: undefined keeps it, null removes it. */
let rmOpen = null, rmState = null, rmPicture, rmPreview = null;
const rmChip = (k) => '<span class="rmchip rmk' + Number(k) + '">' + esc(RM_IMPORTANCE[k] || '') + '</span>';
function rmBar(counts) {
  const parts = rmBarParts(counts);
  return '<svg class="rmbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">' +
    (parts.length ? parts.map((p) => '<rect class="rmb' + p.k + '" x="' + p.x.toFixed(2) + '" width="' + p.w.toFixed(2) + '" height="8"/>').join('') : '<rect class="rmbn" width="100" height="8"/>') + '</svg>';
}
const rmPictureUrl = (i) => '/roadmap/p/' + encodeURIComponent(i.id) + '?v=' + encodeURIComponent(i.picture);
function rmItem(i) {
  const wrote = rmWrote(i);
  return '<button type="button" class="rmitem" data-rm-open="' + esc(i.id) + '" aria-pressed="' + (rmOpen === i.id) + '"><b>' + esc(i.title) + '</b>' + rmBar(i.counts) +
    '<span class="rmmeta"><span title="People who answered">▲ ' + num(rmTotal(i)) + '</span><span title="People who wrote something">✎ ' + num(wrote) + '</span>' +
    (i.picture ? '<span>Picture</span>' : '') + (i.issue ? '<span>' + esc(i.issue) + '</span>' : '') + (i.state === 'done' && i.doneAt ? '<span>' + esc(day(i.doneAt)) + '</span>' : '') + '</span></button>';
}
function rmSuggestion(s, items) {
  const open = items.filter((i) => i.state !== 'hidden');
  return '<div class="rmsug"><div>' + rmChip(s.importance) + '<p>' + esc(s.words) + '</p><small>' + [when(s.at), esc(s.language), s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : ''].filter(Boolean).join(' · ') + '</small></div>' +
    '<div class="rmacts"><button type="button" class="primary" data-rm-sug="' + esc(s.id) + '" data-rm-do="new">New item</button>' +
    (open.length ? '<select id="rm-pick-' + esc(s.id) + '" aria-label="The item to add it to">' + open.map((i) => '<option value="' + esc(i.id) + '">' + esc(i.title) + '</option>').join('') + '</select>' +
      '<button type="button" data-rm-sug="' + esc(s.id) + '" data-rm-do="add">Add to item</button>' : '') +
    '<button type="button" data-rm-sug="' + esc(s.id) + '" data-rm-do="hide">Hide</button></div></div>';
}
function rmEditor(d) {
  if (!rmOpen) return '';
  const i = rmOpen === 'new' ? { id: 'new', state: 'considering', title: '', body: '', issue: null, picture: null, counts: [0, 0, 0, 0], notes: [] } : (d.items || []).find((x) => x.id === rmOpen);
  if (!i) return '';
  const key = esc(i.id);
  const state = rmState || i.state;
  const pic = rmPicture === null ? '' : rmPicture ? (rmPreview ? '<img class="rmpic" src="' + esc(rmPreview) + '" alt="">' : '') : i.picture && i.state !== 'hidden' ? '<img class="rmpic" src="' + esc(rmPictureUrl(i)) + '" alt="">' : '';
  const notes = (i.notes || []);
  return '<aside class="rmedit" aria-label="Roadmap item"><div class="rmhead"><h4>' + (i.id === 'new' ? 'New item' : esc(i.title)) + '</h4><button type="button" data-rm-close>Close</button></div>' +
    '<label>Part</label><div class="rmseg" role="group" aria-label="Part">' + RM_STATES.map(([s, t]) => '<button type="button" data-rm-state="' + s + '" aria-pressed="' + (s === state) + '">' + esc(t) + '</button>').join('') + '</div>' +
    (i.id === 'new' ? '' : '<label>How important</label><div class="rmcounts">' + [3, 2, 1, 0].map((k) => '<div><strong>' + num(i.counts[k] || 0) + '</strong>' + esc(RM_IMPORTANCE[k]) + '</div>').join('') + '</div>') +
    '<label for="rm-title-' + key + '">Title</label><input type="text" id="rm-title-' + key + '" maxlength="120" value="' + esc(i.title) + '">' +
    '<label for="rm-body-' + key + '">Text</label><textarea id="rm-body-' + key + '" maxlength="2000" rows="4">' + esc(i.body) + '</textarea>' +
    '<label for="rm-file-' + key + '">Picture</label>' + pic + '<input type="file" id="rm-file-' + key + '" accept="image/*" data-rm-pic>' +
    (pic ? '<div class="rmrow"><button type="button" data-rm-nopic>Remove picture</button></div>' : '') +
    '<label for="rm-issue-' + key + '">Linear issue</label><input type="text" id="rm-issue-' + key + '" maxlength="20" placeholder="LAN-123" value="' + esc(i.issue || '') + '">' +
    '<div class="rmrow"><button type="button" class="primary" data-rm-save="' + key + '">Save</button></div>' +
    (i.id === 'new' ? '' : '<label>What people wrote (' + num(notes.length) + ')</label>' + (notes.length ? notes.map((n) => '<div class="rmnote"><small>' + rmChip(n.importance) +
      [when(n.at), esc(n.language), n.suggestion ? 'suggested it' : '', n.email ? '<a href="mailto:' + esc(n.email) + '">' + esc(n.email) + '</a>' : ''].filter(Boolean).join(' · ') + '</small>' +
      (n.words ? '<p>' + esc(n.words) + '</p>' : '') + '</div>').join('') : '<p class="muted">Nobody wrote anything yet.</p>')) + '</aside>';
}
function roadmapHtml(d) {
  const items = rmOrder(d.items);
  const sugs = d.suggestions || [];
  const col = (s, t) => { const l = items.filter((i) => i.state === s); return '<div class="rmcol"><h4><span>' + esc(t) + '</span><span>' + num(l.length) + '</span></h4>' + l.map(rmItem).join('') + '</div>'; };
  const hidden = items.filter((i) => i.state === 'hidden');
  return '<div class="rmtop"><a class="button" href="/roadmap" target="_blank" rel="noopener">Open page ↗</a><button type="button" class="primary" data-rm-new>＋ New item</button></div>' +
    '<div class="stats">' + stat(num(sugs.length), 'suggestions wait', sugs.length ? 'warn' : '', NOW) +
    stat(num(items.filter((i) => ['progress', 'planned', 'considering'].includes(i.state)).length), 'items on the page', '', NOW) +
    stat(num(d.day) + ' / ' + num(d.dayMax), 'sends', d.day >= d.dayMax ? 'bad' : '', LAST_DAY) + '</div>' +
    '<div class="rmbox"><h4>Suggestions</h4>' + (sugs.length ? sugs.map((s) => rmSuggestion(s, items)).join('') : '<p class="muted">No suggestion waits.</p>') + '</div>' +
    '<div class="rmbox"><h4>Items</h4><div class="rmboard">' + RM_STATES.slice(0, 4).map(([s, t]) => col(s, t)).join('') + '</div>' +
    (hidden.length ? '<details><summary>Hidden (' + num(hidden.length) + ')</summary><div class="rmboard">' + hidden.map(rmItem).join('') + '</div></details>' : '') + '</div>' +
    rmEditor(d);
}
RENDER.roadmap = (d) => roadmapHtml(d);
const rmRedraw = () => { if (results.roadmap) show('roadmap', results.roadmap); };
/** A picture made small for the page: at most 960 by 420, cut to fit, as a data URL under 200 KB, or null. */
async function rmMakePicture(file) {
  const bmp = await createImageBitmap(file);
  const W = 960, H = 420, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const s = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * s, h = bmp.height * s;
  c.getContext('2d').drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  for (const [type, q] of [['image/webp', 0.82], ['image/webp', 0.6], ['image/jpeg', 0.75], ['image/jpeg', 0.5]]) {
    const url = c.toDataURL(type, q);
    if (url.startsWith('data:' + type + ';') && url.length <= 200000) return url;
  }
  return null;
}
/** The data URL as a blob address for the preview: the page's policy shows blob pictures, not data ones. */
function rmBlobUrl(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
  return URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) }));
}
async function rmDo(action, button, said) {
  const label = button.innerHTML;
  button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Saving…';
  try {
    const body = await post(action);
    say(said(body.result), 'good');
    if (action.kind === 'roadmap-item') { rmOpen = body.result; rmState = null; rmPicture = undefined; }
    if (action.kind === 'roadmap-suggestion' && action.decision === 'new') { rmOpen = body.result; rmState = null; rmPicture = undefined; }
    await reread(['roadmap']);
  } catch (err) {
    say(err.message === 'Signed out' ? 'You are signed out. Sign in, then save again.' : err.message, 'red');
    if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = label; }
  }
}
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-rm-open],[data-rm-new],[data-rm-close],[data-rm-state],[data-rm-save],[data-rm-nopic],[data-rm-sug]');
  if (!t) return;
  if (t.dataset.rmOpen) { rmOpen = t.dataset.rmOpen; rmState = null; rmPicture = undefined; return rmRedraw(); }
  if (t.hasAttribute('data-rm-new')) { rmOpen = 'new'; rmState = null; rmPicture = undefined; return rmRedraw(); }
  if (t.hasAttribute('data-rm-close')) { rmOpen = null; return rmRedraw(); }
  if (t.dataset.rmState) { rmState = t.dataset.rmState; for (const b of t.parentElement.children) b.setAttribute('aria-pressed', String(b === t)); return; }
  if (t.hasAttribute('data-rm-nopic')) { rmPicture = null; return rmRedraw(); }
  if (t.dataset.rmSave) {
    const id = t.dataset.rmSave;
    const field = (n) => { const el = $('rm-' + n + '-' + id); return el ? el.value : ''; };
    const item = id === 'new' ? null : ((results.roadmap && results.roadmap.data && results.roadmap.data.items) || []).find((x) => x.id === id);
    const action = rmItemAction(id, rmState || (item ? item.state : 'considering'), field('title'), field('body'), field('issue'), rmPicture);
    if (!action.title) return say('Give the item a title.', 'red');
    return rmDo(action, t, () => 'Saved. The public page shows it within 5 minutes.');
  }
  if (t.dataset.rmSug) {
    const decision = t.dataset.rmDo;
    const pick = $('rm-pick-' + t.dataset.rmSug);
    const action = { kind: 'roadmap-suggestion', id: t.dataset.rmSug, decision, item: decision === 'add' && pick ? pick.value : null };
    return rmDo(action, t, () => decision === 'new' ? 'It is a new item under consideration. Change its words, then save.' : decision === 'add' ? 'Added to the item.' : 'Hidden.');
  }
});
document.addEventListener('change', async (e) => {
  const input = e.target.closest && e.target.closest('[data-rm-pic]');
  if (!input || !input.files || !input.files[0]) return;
  try {
    const url = await rmMakePicture(input.files[0]);
    if (!url) return say('That picture stays over 200 KB, even made small. Choose another.', 'red');
    if (rmPreview) URL.revokeObjectURL(rmPreview);
    rmPicture = url; rmPreview = rmBlobUrl(url);
    rmRedraw();
  } catch { say('That file is not a picture this browser can open.', 'red'); }
});
`;
