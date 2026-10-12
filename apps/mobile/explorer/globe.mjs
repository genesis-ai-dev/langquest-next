// The language explorer's globe (public/languages.html, docs/languoids.md):
// countries shaded by how many languoids Glottolog places in them, and every
// languoid with a location as a dot. Drag to turn it, scroll or pinch to zoom,
// click a country or a dot to open it. `npm run explorer:build` bundles this
// with d3-geo and the Reports map's shapes (world-atlas) into
// public/languages-globe.js, which the page loads beside languages.js.
import { geoCentroid, geoContains, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'explorer:world';

const countries = feature(world, world.objects.countries).features;
const graticule = geoGraticule10();
const SPHERE = { type: 'Sphere' };
const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A globe in `box`. `value(a2)` is a country's count, `label(a2, name)` what
 * its tooltip says, `points` the dots ({ lon, lat, id, kind } with kind 0 family,
 * 1 language, 2 dialect), `pointLabel(id)` a dot's tooltip. `onCountry(a2)`
 * and `onPoint(id)` are called on a click.
 */
function createGlobe(box, opts) {
  const canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Globe: drag to turn, scroll to zoom, click a country or a dot to open it');
  const tip = document.createElement('div');
  tip.className = 'globe-tip';
  tip.hidden = true;
  box.append(canvas, tip);
  const ctx = canvas.getContext('2d');
  const projection = geoOrthographic().clipAngle(90).precision(0.6);
  let rotate = [-20, -10];
  let zoom = 1;
  let width = 0, height = 0, radius = 0;
  let selected = null; // a2
  let hovered = null; // { a2 } or { id }
  let lit = null; // Set of point ids to draw large (the open region's languoids)
  let focus = null; // { lon, lat }
  const max = Math.max(1, ...countries.map((f) => opts.value(f.properties.a2)));

  function size() {
    const w = box.clientWidth || 600;
    const h = Math.min(Math.round(w * 0.78), 560);
    const dpr = window.devicePixelRatio || 1;
    width = w; height = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = Math.min(w, h) / 2 - 8;
  }

  function draw() {
    if (!width) return;
    projection.translate([width / 2, height / 2]).scale(radius * zoom).rotate(rotate);
    const path = geoPath(projection, ctx);
    const c = {
      sea: css(box, '--sunk'), land: css(box, '--surface'), line: css(box, '--line'), ink: css(box, '--ink'), accent: css(box, '--accent'),
      kinds: [css(box, '--family'), css(box, '--language'), css(box, '--dialect')]
    };
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath(); path(SPHERE); ctx.fillStyle = c.sea; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = c.line; ctx.lineWidth = 0.5; ctx.stroke();
    for (const f of countries) {
      const a2 = f.properties.a2;
      const v = opts.value(a2);
      ctx.beginPath(); path(f);
      ctx.fillStyle = c.land; ctx.fill();
      if (v > 0) { ctx.globalAlpha = a2 === selected ? 0.75 : 0.12 + 0.5 * Math.sqrt(v / max); ctx.fillStyle = c.accent; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = c.line; ctx.lineWidth = 0.6; ctx.stroke();
    }
    const hov = hovered?.a2 && countries.find((f) => f.properties.a2 === hovered.a2);
    if (hov) { ctx.beginPath(); path(hov); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4; ctx.stroke(); }
    const sel = selected && countries.filter((f) => f.properties.a2 === selected);
    if (sel) for (const f of sel) { ctx.beginPath(); path(f); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.8; ctx.stroke(); }
    // Dots on the near side: the open region's large, the rest small and faint.
    const center = projection.invert([width / 2, height / 2]);
    for (const big of [false, true]) {
      for (const p of opts.points) {
        if ((lit?.has(p.id) ?? false) !== big) continue;
        if (geoDistance([p.lon, p.lat], center) > Math.PI / 2 - 0.01) continue;
        const xy = projection([p.lon, p.lat]);
        ctx.beginPath(); ctx.arc(xy[0], xy[1], big ? 3.2 : 1.5, 0, 2 * Math.PI);
        ctx.globalAlpha = big ? 0.95 : lit ? 0.25 : 0.55; ctx.fillStyle = c.kinds[p.kind] || c.ink; ctx.fill();
        if (big) { ctx.globalAlpha = 1; ctx.lineWidth = 0.8; ctx.strokeStyle = c.land; ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
    if (focus && geoDistance([focus.lon, focus.lat], center) < Math.PI / 2) {
      const xy = projection([focus.lon, focus.lat]);
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 8, 0, 2 * Math.PI); ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.stroke();
    }
    if (hovered?.id != null) {
      const p = opts.points.find((q) => q.id === hovered.id);
      if (p) { const xy = projection([p.lon, p.lat]); ctx.beginPath(); ctx.arc(xy[0], xy[1], 5, 0, 2 * Math.PI); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    ctx.beginPath(); path(SPHERE); ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.stroke();
  }
  let frame = 0;
  const redraw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };

  // What is under the pointer: a dot within a few pixels, else a country.
  // Zoomed out, the faint dots are too dense to aim at, so only the open
  // region's large ones are; a click there means the country.
  const DOTS_FROM = 2.5;
  function hit(x, y) {
    const center = projection.invert([width / 2, height / 2]);
    let best = null, bestD = 7 * 7;
    for (const p of opts.points) {
      if (zoom < DOTS_FROM && !lit?.has(p.id)) continue;
      if (geoDistance([p.lon, p.lat], center) > Math.PI / 2) continue;
      const xy = projection([p.lon, p.lat]);
      const d = (xy[0] - x) ** 2 + (xy[1] - y) ** 2;
      // The open region's dots win over the faint ones under them.
      const lift = lit?.has(p.id) ? 0.5 : 1;
      if (d * lift < bestD) { bestD = d * lift; best = p; }
    }
    if (best) return { id: best.id };
    const ll = projection.invert([x, y]);
    if (!ll || Math.hypot(x - width / 2, y - height / 2) > radius * zoom) return null;
    const f = countries.find((g) => geoContains(g, ll));
    return f ? { a2: f.properties.a2, name: f.properties.name } : null;
  }
  function showTip(x, y, h) {
    const text = !h ? '' : h.id != null ? opts.pointLabel(h.id) : opts.label(h.a2, h.name);
    tip.hidden = !text;
    if (!text) return;
    tip.textContent = text;
    tip.style.left = Math.min(x + 12, width - 180) + 'px';
    tip.style.top = Math.max(y - 30, 4) + 'px';
  }

  // Turning and zooming: one pointer drags, two pinch; a click is a press that hardly moved.
  const pointers = new Map();
  let dragFrom = null, pinchFrom = null, moved = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    pointers.set(e.pointerId, local(e));
    moved = 0;
    if (pointers.size === 1) dragFrom = { xy: local(e), rotate: [...rotate] };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchFrom = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom }; dragFrom = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const xy = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, xy);
    if (pinchFrom && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoom = clampZoom(pinchFrom.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinchFrom.d));
      moved += 10; redraw(); return;
    }
    if (dragFrom) {
      const k = 75 / (radius * zoom);
      moved = Math.max(moved, Math.hypot(xy[0] - dragFrom.xy[0], xy[1] - dragFrom.xy[1]));
      rotate = [dragFrom.rotate[0] + (xy[0] - dragFrom.xy[0]) * k, Math.max(-90, Math.min(90, dragFrom.rotate[1] - (xy[1] - dragFrom.xy[1]) * k))];
      tip.hidden = true; redraw(); return;
    }
    const h = hit(xy[0], xy[1]);
    if ((h?.a2 ?? null) !== (hovered?.a2 ?? null) || (h?.id ?? null) !== (hovered?.id ?? null)) { hovered = h; redraw(); }
    canvas.style.cursor = h ? 'pointer' : 'grab';
    showTip(xy[0], xy[1], h);
  });
  const end = (e) => {
    const wasDrag = dragFrom || pinchFrom;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchFrom = null;
    if (pointers.size === 0) dragFrom = null;
    if (e.type === 'pointerup' && wasDrag && moved < 4 && pointers.size === 0) {
      const [x, y] = local(e);
      const h = hit(x, y);
      if (h?.id != null) opts.onPoint(h.id);
      else if (h?.a2) opts.onCountry(h.a2);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { hovered = null; tip.hidden = true; redraw(); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = clampZoom(zoom * Math.exp(-e.deltaY * 0.0015)); redraw(); }, { passive: false });
  const clampZoom = (z) => Math.max(0.8, Math.min(12, z));

  // Turning to a place: along the great circle, unless motion is reduced.
  let flight = 0;
  function flyTo(lonlat, toZoom) {
    cancelAnimationFrame(flight);
    const from = [-rotate[0], -rotate[1]];
    const to = [lonlat[0], Math.max(-75, Math.min(75, lonlat[1]))];
    const z0 = zoom, z1 = toZoom ?? zoom;
    if (reduceMotion()) { rotate = [-to[0], -to[1]]; zoom = z1; redraw(); return; }
    const along = geoInterpolate(from, to);
    const t0 = performance.now(), ms = 700;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = along(e); rotate = [-p[0], -p[1]]; zoom = z0 + (z1 - z0) * e; draw();
      if (t < 1) flight = requestAnimationFrame(step);
    };
    flight = requestAnimationFrame(step);
  }
  // How far to zoom so a country fills the globe's middle.
  const zoomFor = (fs) => {
    let far = 0; const c = geoCentroid({ type: 'FeatureCollection', features: fs });
    for (const f of fs) for (const ring of rings(f)) for (const pt of ring) far = Math.max(far, geoDistance(c, pt));
    return Math.max(1, Math.min(5, 0.9 / Math.max(far, 0.05)));
  };

  const resize = new ResizeObserver(() => { size(); draw(); });
  resize.observe(box);
  size(); draw();

  return {
    /** Mark a country (a2, or null) and the dots to draw large, and turn to it. */
    select(a2, ids, fly = true) {
      selected = a2; lit = ids ? new Set(ids) : null; focus = null;
      const fs = a2 ? countries.filter((f) => f.properties.a2 === a2) : [];
      if (fly && fs.length) flyTo(geoCentroid({ type: 'FeatureCollection', features: fs }), zoomFor(fs));
      else if (fly && ids?.length) {
        const pts = opts.points.filter((p) => lit.has(p.id));
        if (pts.length) flyTo(geoCentroid({ type: 'MultiPoint', coordinates: pts.map((p) => [p.lon, p.lat]) }), 1.2);
      }
      redraw();
    },
    /** Ring a place and turn to it (a languoid's location). */
    focus(lon, lat) { focus = { lon, lat }; flyTo([lon, lat], Math.max(zoom, 3)); },
    /** The country a place is in, as its a2, or null at sea. */
    countryAt: (lon, lat) => countries.find((f) => geoContains(f, [lon, lat]))?.properties.a2 ?? null,
    zoomBy(k) { zoom = clampZoom(zoom * k); redraw(); },
    reset() { flyTo([20, 10], 1); },
    redraw
  };
}

function rings(f) {
  const g = f.geometry;
  return g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
}

window.LanguoidGlobe = { createGlobe };
