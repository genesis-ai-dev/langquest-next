/**
 * What a chart says under the pointer: a line at the bucket the pointer is
 * over, and a box above the chart with that bucket's day and each value
 * drawn there. Every chart of the page carries its values on its svg
 * (data-hv), and a mark of a list (a dot, a square, a part of a bar) its
 * words on itself (data-tip), so one script serves them all and no chart
 * has code of its own for this.
 *
 * A mouse shows it while it is over a chart. A finger has no hover: a press
 * shows it, a slide along the chart moves it, and a lift takes it away; a
 * tap still does what it did (a section's chart opens its records). The
 * arrow keys that move over a chart's buckets show it too.
 *
 * Plain JavaScript run inside page.ts's script, after its helpers ($, esc).
 */

/** The box, the line, and a finger's slide, inside page.ts's style element. */
export const HOVER_CSS = String.raw`
#hv { position: fixed; z-index: 10; left: 0; top: 0; max-width: calc(100vw - 16px); padding: 6px 10px; border-radius: 8px; background: var(--ink); color: var(--bg); font-size: 12.5px; font-weight: 400; line-height: 1.45; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.25); white-space: nowrap; overflow: hidden; }
#hv .w { font-size: 11.5px; opacity: .78; }
#hv .r { display: flex; gap: 14px; justify-content: space-between; align-items: baseline; }
#hv .r span { overflow: hidden; text-overflow: ellipsis; } #hv .r b { font-variant-numeric: tabular-nums; }
#hv i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-inline-end: 6px; }
#hv i.a { background: var(--blue); } #hv i.b { background: var(--orange); }
/* The line, with a pale edge so it shows on a bar as on the page. */
svg .hvl line { fill: none; vector-effect: non-scaling-stroke; pointer-events: none; }
svg .hvl .o { stroke: var(--card); stroke-width: 3; opacity: .55; } svg .hvl .n { stroke: var(--ink); stroke-width: 1; opacity: .8; }
.chart svg .pt.hov:not(.sel) { fill: var(--ink); }
svg.sq .q.hov:not(.sel) { stroke: var(--ink); stroke-width: 1.5; }
/* A slide along a chart moves the line; a slide up or down still scrolls the page. */
svg[data-hv] { touch-action: pan-y pinch-zoom; -webkit-user-select: none; user-select: none; }
`;

/** Pure: apps/admin/test/hover.test.ts runs these with new Function, so where the line and the box go is tested without a browser. */
export const HOVER_LOGIC = String.raw`
/**
 * A chart's values for the pointer, as its svg carries them. x is where its
 * first bucket starts and step how wide a bucket is, in the svg's own units
 * (kept as the width of them all, so the last bucket of many is as exact as
 * the first); heads has a bucket's day, and each of lines is [mark, name, a
 * value for each bucket]. from and to are where the line starts and ends
 * down the chart; a chart with none (a row of squares) gets the box only.
 */
function hvPack(x, step, heads, lines, from, to) {
  const hv = { x: Number(x.toFixed(2)), w: Number((step * heads.length).toFixed(2)), h: heads, l: lines };
  if (to !== undefined) { hv.a = from; hv.b = to; }
  return JSON.stringify(hv);
}

/** Which bucket a place across the chart is over: the nearest one when the place is past either end. */
function hvIndex(hv, x) {
  const n = hv.h.length;
  return Math.max(0, Math.min(n - 1, Math.floor(((x - hv.x) / hv.w) * n)));
}

/** What one bucket says: the middle of it across the chart, its day, and each value drawn there. */
function hvAt(hv, i) {
  return { x: hv.x + ((i + 0.5) * hv.w) / hv.h.length, head: hv.h[i], lines: hv.l.map((l) => ({ mark: l[0], name: l[1], value: l[2][i] })) };
}

/**
 * Where the box goes in the window: above the chart with its middle on the
 * line, under the chart when there is no room above, and never past a side.
 */
function hvPlace(x, top, bottom, w, h, winW) {
  const left = Math.max(8, Math.min(winW - w - 8, x - w / 2));
  return { left, top: top - h - 6 >= 4 ? top - h - 6 : bottom + 6 };
}
`;

/** The pointer, the finger and the keys, and the one box they all fill. */
export const HOVER_SCRIPT = String.raw`
/** The attribute a chart's svg carries its values in (hvPack). */
function hvAttr(x, step, heads, lines, from, to) {
  return ' data-hv="' + esc(hvPack(x, step, heads, lines, from, to)) + '"';
}

let hvNow = null;
let hvLine = null;
const hvRead = new WeakMap();
function hvOf(svg) {
  if (!hvRead.has(svg)) { let hv = null; try { hv = JSON.parse(svg.dataset.hv); } catch {} hvRead.set(svg, hv && Array.isArray(hv.h) && hv.h.length && hv.w > 0 ? hv : null); }
  return hvRead.get(svg);
}
function hvBox() {
  let box = $('hv');
  if (!box) { box = document.createElement('div'); box.id = 'hv'; box.hidden = true; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
  return box;
}
// A chart drawn again while the box shows takes the box with it, so the box never says an old value.
const hvGone = new MutationObserver(() => { if (hvNow && !hvNow.node.isConnected) hvHide(); });

function hvClear() {
  if (hvLine) { hvLine.remove(); hvLine = null; }
  for (const el of document.querySelectorAll('svg .hov')) el.classList.remove('hov');
}
function hvHide() {
  if (!hvNow) return;
  hvGone.disconnect();
  hvClear();
  hvNow = null;
  hvBox().hidden = true;
}
function hvPut(html, x, top, bottom) {
  const box = hvBox();
  box.innerHTML = html; box.hidden = false;
  const r = box.getBoundingClientRect();
  const p = hvPlace(x, top, bottom, r.width, r.height, document.documentElement.clientWidth);
  box.style.left = p.left + 'px'; box.style.top = p.top + 'px';
}
function hvKeep(now) {
  if (!hvNow) hvGone.observe(document.body, { childList: true, subtree: true });
  hvNow = now;
}

/** A chart's bucket: the line on it, and its day and values above the chart. */
function hvShow(svg, i) {
  const hv = hvOf(svg);
  if (!hv) return;
  if (hvNow && hvNow.node === svg && hvNow.i === i) return;
  hvClear();
  const at = hvAt(hv, i), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
  if (hv.b !== undefined) {
    const SVG = 'http://www.w3.org/2000/svg';
    hvLine = document.createElementNS(SVG, 'g');
    hvLine.setAttribute('class', 'hvl');
    for (const c of ['o', 'n']) {
      const l = document.createElementNS(SVG, 'line');
      l.setAttribute('class', c);
      l.setAttribute('x1', at.x.toFixed(2)); l.setAttribute('x2', at.x.toFixed(2));
      l.setAttribute('y1', hv.a); l.setAttribute('y2', hv.b);
      hvLine.appendChild(l);
    }
    svg.appendChild(hvLine);
  }
  const mark = svg.querySelector('[data-i="' + i + '"]');
  if (mark) mark.classList.add('hov');
  hvKeep({ node: svg, i });
  hvPut('<div class="w">' + esc(at.head) + '</div>' + at.lines.map((l) =>
    '<div class="r"><span>' + (l.mark ? '<i class="' + esc(l.mark) + '"></i>' : '') + esc(l.name) + '</span><b>' + esc(l.value) + '</b></div>').join(''),
    r.left + ((at.x - vb.x) / vb.width) * r.width, r.top, r.bottom);
}

/** A list's mark: its words above it. */
function hvTip(el) {
  if (hvNow && hvNow.node === el) return;
  hvClear();
  const r = el.getBoundingClientRect();
  hvKeep({ node: el, i: -1 });
  hvPut('<div class="r"><span>' + esc(el.dataset.tip) + '</span></div>', r.left + r.width / 2, r.top, r.bottom);
}

function hvPoint(e) {
  const t = e.target && e.target.closest ? e.target : null;
  const svg = t && t.closest('svg[data-hv]');
  const hv = svg && hvOf(svg);
  if (hv) {
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    if (r.width) { hvShow(svg, hvIndex(hv, vb.x + ((e.clientX - r.left) / r.width) * vb.width)); return; }
  }
  const el = t && t.closest('svg [data-tip]');
  if (el) hvTip(el); else hvHide();
}
document.addEventListener('pointermove', hvPoint);
document.addEventListener('pointerdown', hvPoint);
// A finger that lifts, or that the page takes to scroll, ends it; a mouse ends it when it leaves the chart.
document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') hvHide(); });
document.addEventListener('pointercancel', hvHide);
document.documentElement.addEventListener('pointerleave', hvHide);
window.addEventListener('scroll', hvHide, { passive: true, capture: true });
document.addEventListener('focusout', hvHide);
// The arrow keys move over a chart's buckets (pageStart.ts, pageLists.ts); this runs after them, and shows the bucket they chose.
document.addEventListener('keydown', (e) => {
  const svg = e.target.closest && e.target.closest('svg[data-sel]');
  if (!svg || !/^Arrow/.test(e.key)) return;
  if (svg.dataset.hv) { hvShow(svg, Number(svg.dataset.sel)); return; }
  const el = svg.querySelector('[data-i="' + svg.dataset.sel + '"][data-tip]');
  if (el) hvTip(el);
});
`;
