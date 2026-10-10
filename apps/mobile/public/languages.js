// The language explorer (languages.html, docs/languoids.md). A file of its own,
// since the web app's security policy allows no inline scripts.
(() => {
'use strict';
const LEVELS = ['family', 'language', 'dialect'];
const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};
const fmt = (n) => n.toLocaleString('en-US');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// `text` with what was typed in bold wherever it appears, ignoring case and
// accents as the search does ("kele" bolds "Kélé"); `text` itself when it is not there.
function mark(text, q) {
  const t = norm((q || '').trim());
  if (!t || !text) return text;
  let folded = ''; const starts = []; const ends = []; let at = 0;
  for (const ch of text) {
    const f = norm(ch);
    if (!f && ends.length) ends[ends.length - 1] = at + ch.length; // a lone accent stays with its letter
    for (let k = 0; k < f.length; k++) { starts.push(at); ends.push(at + ch.length); }
    folded += f; at += ch.length;
  }
  const out = []; let from = 0;
  for (let k = folded.indexOf(t); k !== -1; k = folded.indexOf(t, k + t.length)) {
    const s = starts[k], e = ends[k + t.length - 1];
    if (s > from) out.push(text.slice(from, s));
    out.push(h('b', { class: 'hit' }, text.slice(s, e)));
    from = e;
  }
  if (!out.length) return text;
  if (from < text.length) out.push(text.slice(from));
  return out;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* not kept */ } }
};

// ---- theme ----
const themeBtn = $('#themebtn');
const applyTheme = (t) => { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); themeBtn.textContent = t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Auto'; };
applyTheme(store.get('lx-theme'));
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === null ? 'dark' : cur === 'dark' ? 'light' : null;
  store.set('lx-theme', next ?? ''); applyTheme(next);
  window.dispatchEvent(new Event('lx-theme'));
});

// ---- data ----
// The tables come either inside the page (npm run languoids -- explore,
// before a load) or from the database (/api/languoids, the web app).
async function load() {
  const b64 = $('#data').textContent.trim();
  if (b64 === '__' + 'DATA__') {
    const res = await fetch('/api/languoids');
    if (!res.ok) throw new Error('the server answered ' + res.status);
    return res.json();
  }
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

load().then(start).catch((e) => { $('#loading').textContent = 'The data could not be read: ' + e.message; });

function start(D) {
  $('#rel').textContent = 'Glottolog ' + (D.release || '?') + ' · ' + (D.live ? 'as loaded ' : 'built ') + D.built.slice(0, 10);
  const L = D.languoid, A = D.alias, S = D.source, P = D.property, R = D.region, LR = D.languoidRegion;
  const N = L.name.length;

  // indexes
  const groupBy = (keys, n) => { const start = new Int32Array(n + 1); for (const k of keys) start[k + 1]++; for (let i = 0; i < n; i++) start[i + 1] += start[i]; const pos = start.slice(0, n); const order = new Int32Array(keys.length); keys.forEach((k, i) => { order[pos[k]++] = i; }); return { start, order, of: (k) => order.subarray(start[k], start[k + 1]) }; };
  const children = groupBy(L.parent.map((p) => (p < 0 ? N : p)), N + 1);
  const aliasBy = groupBy(A.subject, N);
  const aliasByLabel = groupBy(A.label, N);
  const sourceBy = groupBy(S.languoid, N);
  const propBy = groupBy(P.languoid, N);
  const regionsOf = groupBy(LR.languoid, N);
  const languoidsIn = groupBy(LR.region, R.name.length);
  const kids = (i) => children.of(i);
  const roots = children.of(N);
  const root = new Int32Array(N); const depth = new Int32Array(N);
  const rootOf = (i) => { let r = i, d = 0; while (L.parent[r] >= 0) { r = L.parent[r]; d++; } depth[i] = d; return r; };
  for (let i = 0; i < N; i++) root[i] = rootOf(i);
  const descendants = new Int32Array(N);
  { const byDepth = [...Array(N).keys()].sort((a, b) => depth[b] - depth[a]); for (const i of byDepth) { const p = L.parent[i]; if (p >= 0) descendants[p] += descendants[i] + 1; } }
  const kindIdx = (name) => S.kindList.indexOf(name);
  const ISO = kindIdx('iso639-3');
  const iso = new Array(N).fill('');
  S.languoid.forEach((li, j) => { if (S.kind[j] === ISO) iso[li] = S.id[j]; });
  const prop = (i, key) => { const k = P.keyList.indexOf(key); for (const j of propBy.of(i)) if (P.key[j] === k) return P.value[j]; return null; };
  const category = new Array(N); const macro = new Array(N);
  for (let i = 0; i < N; i++) { category[i] = prop(i, 'category') ?? ''; macro[i] = [...regionsOf.of(i)].map((j) => LR.region[j]).filter((r) => R.level[r] === 'macroarea').map((r) => R.name[r]).sort().join(', '); }
  const hasEndonym = new Uint8Array(N); A.subject.forEach((s, j) => { if (A.type[j] === 1) hasEndonym[s] = 1; });
  const TYPE = ['exonym', 'endonym', 'language not given', 'description'];
  // Families used as a name's label (an umbrella code), with the language proposed instead.
  const umbrellaOf = new Map((D.umbrella || []).map((u) => [u.family, u]));
  const typeBadge = (j) => h('span', { class: 'badge ' + (A.type[j] === 1 ? 'endo' : 'exo') }, TYPE[A.type[j]]);
  const nameNorm = L.name.map(norm);
  const aliasNorm = A.name.map(norm);
  const regionLabel = (r) => R.name[r] + (R.iso[r] ? ' (' + R.iso[r] + ')' : '');
  const originShort = (o) => (o.startsWith('v2') ? 'v2' : o);
  const categories = [...new Set(category)].filter(Boolean).sort();
  const continents = R.level.map((lv, r) => (lv === 'macroarea' ? r : -1)).filter((r) => r >= 0);
  const nations = R.level.map((lv, r) => (lv === 'nation' ? r : -1)).filter((r) => r >= 0).sort((a, b) => R.name[a].localeCompare(R.name[b]));
  const byGlottocode = new Map(L.glottocode.map((g, i) => [g, i]));
  const byId = new Map(L.id.map((g, i) => [g, i]));

  // ---- views ----
  const main = $('#main');
  main.textContent = '';
  const views = {};
  let current = null;
  function show(name) {
    current = name;
    for (const [k, v] of Object.entries(views)) v.el.hidden = k !== name;
    document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === name)));
    views[name].shown?.();
    store.set('lx-view', name);
  }
  document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  // ---- virtual list ----
  function vlist(container, rowHeight, render) {
    const pad = h('div', { class: 'pad' });
    container.append(pad);
    let rows = []; let drawn = new Map();
    const draw = () => {
      const top = container.scrollTop, height = container.clientHeight || 600;
      const from = Math.max(0, Math.floor(top / rowHeight) - 8), to = Math.min(rows.length, Math.ceil((top + height) / rowHeight) + 8);
      const keep = new Map();
      for (let i = from; i < to; i++) {
        let el = drawn.get(i);
        if (!el) { el = render(rows[i], i); el.style.top = i * rowHeight + 'px'; pad.append(el); }
        keep.set(i, el);
      }
      for (const [i, el] of drawn) if (!keep.has(i)) el.remove();
      drawn = keep;
    };
    container.addEventListener('scroll', () => requestAnimationFrame(draw), { passive: true });
    window.addEventListener('resize', () => requestAnimationFrame(draw));
    return {
      set(r, keepScroll) { rows = r; pad.style.height = rows.length * rowHeight + 'px'; for (const el of drawn.values()) el.remove(); drawn = new Map(); if (!keepScroll) container.scrollTop = 0; draw(); },
      redraw() { for (const el of drawn.values()) el.remove(); drawn = new Map(); draw(); },
      scrollTo(i) { const y = i * rowHeight; if (y < container.scrollTop || y > container.scrollTop + container.clientHeight - rowHeight) container.scrollTop = Math.max(0, y - container.clientHeight / 3); draw(); }
    };
  }

  // ================= Languoids =================
  const lv = { el: h('section', { class: 'view', id: 'view-languoids' }) };
  views.languoids = lv;
  main.append(lv.el);
  const st = { q: '', levels: new Set([0, 1, 2]), cat: '', region: '', origin: '', iso: false, endo: false, group: 'none', sel: -1, collapsed: new Set() };
  const qInput = h('input', { id: 'q', type: 'search', placeholder: 'Name, other name, ISO code or glottocode', autocomplete: 'off', 'aria-label': 'Search languoids' });
  const levelBtns = ['Families', 'Languages', 'Dialects'].map((label, i) => h('button', { class: 'chip-toggle ' + LEVELS[i], 'aria-pressed': 'true', type: 'button', onclick: (e) => { st.levels.has(i) ? st.levels.delete(i) : st.levels.add(i); e.currentTarget.setAttribute('aria-pressed', String(st.levels.has(i))); refresh(); } }, label));
  const catSel = h('select', { id: 'cat', 'aria-label': 'Category' }, h('option', { value: '' }, 'Any category'), categories.map((c) => h('option', { value: c }, c)));
  const regionSel = h('select', { id: 'reg', 'aria-label': 'Region' }, h('option', { value: '' }, 'Anywhere'),
    h('optgroup', { label: 'Macroareas' }, continents.map((r) => h('option', { value: String(r) }, R.name[r]))),
    h('optgroup', { label: 'Nations' }, nations.map((r) => h('option', { value: String(r) }, regionLabel(r)))));
  const originSel = h('select', { id: 'origin', 'aria-label': 'Id' }, h('option', { value: '' }, 'Any id'), h('option', { value: 'v2' }, 'Id kept from v2'), h('option', { value: 'new' }, 'New id'));
  const groupSel = h('select', { id: 'group', 'aria-label': 'Group by' }, [['none', 'No grouping'], ['root', 'Group by top family'], ['level', 'Group by level'], ['category', 'Group by category'], ['macro', 'Group by macroarea']].map(([v, t]) => h('option', { value: v }, t)));
  const isoBtn = h('button', { class: 'chip-toggle plain', type: 'button', 'aria-pressed': 'false', onclick: (e) => { st.iso = !st.iso; e.currentTarget.setAttribute('aria-pressed', String(st.iso)); refresh(); } }, 'Has ISO code');
  const endoBtn = h('button', { class: 'chip-toggle plain', type: 'button', 'aria-pressed': 'false', onclick: (e) => { st.endo = !st.endo; e.currentTarget.setAttribute('aria-pressed', String(st.endo)); refresh(); } }, 'Has endonym');
  const resultLine = h('div', { class: 'resultline' });
  const listEl = h('div', { class: 'vlist', role: 'listbox', 'aria-label': 'Languoids' });
  const detail = h('div', { class: 'detail', id: 'detail' });
  lv.el.append(h('div', { class: 'listcol' },
    h('div', { class: 'controls' }, h('div', { class: 'search' }, qInput), h('div', { class: 'row2' }, levelBtns), h('div', { class: 'row2' }, catSel, regionSel, originSel), h('div', { class: 'row2' }, isoBtn, endoBtn, groupSel), resultLine),
    listEl), detail);

  let hits = null; // Map index -> {rank, via}
  const list = vlist(listEl, 50, (row) => {
    if (row.group != null) {
      const collapsed = st.collapsed.has(row.group);
      return h('div', { class: 'vrow group', onclick: () => { collapsed ? st.collapsed.delete(row.group) : st.collapsed.add(row.group); render(true); } }, (collapsed ? '▸ ' : '▾ ') + row.label, h('span', { class: 'count num' }, fmt(row.count)));
    }
    const i = row.i; const via = hits?.get(i)?.via;
    return h('div', { class: 'vrow' + (i === st.sel ? ' sel' : ''), role: 'option', 'aria-selected': String(i === st.sel), onclick: () => select(i, true) },
      h('span', { class: 'lv ' + LEVELS[L.level[i]], title: LEVELS[L.level[i]] }),
      h('div', { class: 'main' }, h('div', { class: 'nm' }, mark(L.name[i], st.q)),
        h('div', { class: 'sub' }, via ? ['matched “', mark(via, st.q), '” · '] : '', mark([L.glottocode[i], iso[i]].filter(Boolean).join(' · '), st.q), L.parent[i] >= 0 ? ' · in ' + L.name[L.parent[i]] : '')));
  });

  function search(q) {
    const t = norm(q.trim()); if (!t) return null;
    const out = new Map();
    const put = (i, rank, via) => { const cur = out.get(i); if (!cur || rank < cur.rank) out.set(i, { rank, via }); };
    for (let i = 0; i < N; i++) {
      if (L.glottocode[i] === t || iso[i] === t) put(i, 0, null);
      const n = nameNorm[i]; const k = n.indexOf(t);
      if (k >= 0) put(i, n === t ? 1 : k === 0 ? 2 : 3, null);
    }
    for (let j = 0; j < aliasNorm.length; j++) {
      const n = aliasNorm[j]; const k = n.indexOf(t);
      if (k >= 0) put(A.subject[j], n === t ? 1.5 : k === 0 ? 2.5 : 3.5, A.name[j]);
    }
    return out;
  }
  function passes(i) {
    if (!st.levels.has(L.level[i])) return false;
    if (st.cat && category[i] !== st.cat) return false;
    if (st.origin && originShort(L.origin[i]) !== st.origin) return false;
    if (st.iso && !iso[i]) return false;
    if (st.endo && !hasEndonym[i]) return false;
    if (st.region !== '') { const r = +st.region; let ok = false; for (const j of regionsOf.of(i)) if (LR.region[j] === r) { ok = true; break; } if (!ok) return false; }
    return true;
  }
  let matched = [];
  function refresh() {
    hits = search(st.q);
    const idx = [];
    if (hits) {
      for (const i of hits.keys()) if (passes(i)) idx.push(i);
      // Best match first; among equals, languages before families and dialects.
      idx.sort((a, b) => hits.get(a).rank - hits.get(b).rank || (L.level[a] === 1 ? 0 : 1) - (L.level[b] === 1 ? 0 : 1) || L.name[a].localeCompare(L.name[b]));
    } else {
      for (let i = 0; i < N; i++) if (passes(i)) idx.push(i);
      idx.sort((a, b) => L.name[a].localeCompare(L.name[b]));
    }
    matched = idx;
    resultLine.replaceChildren(h('span', { class: 'num' }, fmt(idx.length) + ' of ' + fmt(N) + ' languoids'), h('span', {}, hits ? 'Best matches first' : 'A to Z'));
    render(false);
  }
  function groupKey(i) {
    switch (st.group) {
      case 'root': return L.parent[i] < 0 && kids(i).length === 0 ? '(isolates and unclassified)' : L.name[root[i]];
      case 'level': return LEVELS[L.level[i]];
      case 'category': return category[i] || '(none)';
      case 'macro': return macro[i] || '(no macroarea)';
      default: return '';
    }
  }
  function render(keepScroll) {
    let rows;
    if (st.group === 'none') rows = matched.map((i) => ({ i }));
    else {
      const groups = new Map();
      for (const i of matched) { const k = groupKey(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
      const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b));
      rows = [];
      for (const k of keys) { rows.push({ group: k, label: k, count: groups.get(k).length }); if (!st.collapsed.has(k)) for (const i of groups.get(k)) rows.push({ i }); }
    }
    list.set(rows, keepScroll);
    lv.rows = rows;
  }
  let qTimer = 0;
  qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = qInput.value; refresh(); }, 120); });
  catSel.addEventListener('change', () => { st.cat = catSel.value; refresh(); });
  regionSel.addEventListener('change', () => { st.region = regionSel.value; refresh(); });
  originSel.addEventListener('change', () => { st.origin = originSel.value; refresh(); });
  groupSel.addEventListener('change', () => { st.group = groupSel.value; st.collapsed.clear(); render(false); });

  function select(i, fromList) {
    st.sel = i;
    list.redraw();
    if (!fromList && lv.rows) { const k = lv.rows.findIndex((r) => r.i === i); if (k >= 0) list.scrollTo(k); }
    try { history.replaceState(null, '', '#' + L.glottocode[i]); } catch { /* frame may refuse */ }
    renderDetail(i);
    lv.el.classList.add('showdetail');
    detail.scrollTop = 0;
  }
  function openLanguoid(i) { show('languoids'); select(i, false); }

  // A label that is a family: say so, and name the language proposed instead.
  function umbrellaNote(lb) {
    if (L.level[lb] !== 0) return null;
    const u = umbrellaOf.get(lb);
    return h('span', { class: 'umb' }, h('span', { class: 'badge warn' }, 'a family, not a language'),
      u && u.code ? h('span', { class: 'muted' }, ' umbrella code ' + u.code) : null,
      u && u.proposed >= 0 ? [h('span', { class: 'muted' }, ' · proposed: '), h('button', { type: 'button', class: 'ref', onclick: () => select(u.proposed, false) }, L.name[u.proposed])] : h('span', { class: 'muted' }, ' · no single main language'));
  }
  // The family tree around a languoid: each step down from the top of its
  // tree, then everything directly below it. Any branch opens in place, and
  // on the way down the other branches of each step show when asked for.
  const TREE_CAP = 150;
  const byLevelThenName = (a, b) => L.level[a] - L.level[b] || L.name[a].localeCompare(L.name[b]);
  function familyTree(i, anc, below) {
    const path = [...anc, i];
    const step = new Map(path.map((k, n) => [k, path[n + 1]]));
    const open = new Set(path), others = new Set(), whole = new Set();
    const box = h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Family tree of ' + L.name[i] });
    const item = (k) => {
      const n = kids(k).length, isOpen = n > 0 && open.has(k);
      const li = h('li', { role: 'treeitem', 'aria-expanded': n ? String(isOpen) : null, 'aria-current': k === i ? 'true' : null },
        h('div', { class: 'trow' + (k === i ? ' here' : '') },
          n ? h('button', { type: 'button', class: 'tog', 'aria-label': (isOpen ? 'Close ' : 'Open ') + L.name[k], onclick: () => { if (isOpen) open.delete(k); else open.add(k); draw(); } }, isOpen ? '▾' : '▸') : h('span', { class: 'tog' }),
          h('span', { class: 'lv ' + LEVELS[L.level[k]], title: LEVELS[L.level[k]] }),
          k === i ? h('b', { class: 'tn' }, L.name[k]) : h('button', { type: 'button', class: 'tn', onclick: () => select(k, false), title: LEVELS[L.level[k]] + ' · ' + L.glottocode[k] }, L.name[k]),
          iso[k] ? h('span', { class: 'mono muted' }, iso[k]) : null,
          descendants[k] ? h('span', { class: 'muted num' }, fmt(descendants[k]) + ' below') : null));
      if (isOpen) {
        const all = [...kids(k)].sort(byLevelThenName);
        const next = step.get(k);
        const onlyNext = next != null && !others.has(k);
        const shown = onlyNext ? [next] : whole.has(k) ? all : all.slice(0, TREE_CAP);
        const more = onlyNext ? all.length - 1 : all.length - shown.length;
        li.append(h('ul', { role: 'group' }, shown.map(item),
          more > 0 ? h('li', { class: 'tmore' }, h('button', { type: 'button', onclick: () => { if (onlyNext) others.add(k); else whole.add(k); draw(); } },
            onlyNext ? '+ ' + fmt(more) + (more === 1 ? ' other branch' : ' other branches') + ' of ' + L.name[k] : 'Show ' + fmt(more) + ' more')) : null));
      }
      return li;
    };
    const draw = () => box.replaceChildren(item(path[0]));
    draw();
    return h('section', { class: 'block' }, h('h3', {}, 'Family tree', h('span', { class: 'count num' }, anc.length ? fmt(anc.length) + (anc.length === 1 ? ' step' : ' steps') + ' down' : 'top of its tree'),
      below ? h('span', { class: 'count num' }, fmt(below) + ' directly below') : null), box);
  }

  let nameMode = 'all';
  function renderDetail(i) {
    const level = LEVELS[L.level[i]];
    const anc = []; for (let p = L.parent[i]; p >= 0; p = L.parent[p]) anc.unshift(p);
    const origin = L.origin[i];
    const lat = L.lat[i], lon = L.lon[i];
    const regs = [...regionsOf.of(i)].map((j) => LR.region[j]);
    const kidList = kids(i);
    const parts = [];
    parts.push(h('button', { class: 'back', type: 'button', onclick: () => lv.el.classList.remove('showdetail') }, '← Back to the list'));
    parts.push(h('nav', { class: 'crumbs', 'aria-label': 'Classification' }, anc.length ? anc.flatMap((p, k) => [k ? h('span', { class: 'sep' }, '›') : null, h('button', { type: 'button', onclick: () => select(p, false) }, L.name[p])]) : h('span', {}, 'Top of a tree')));
    parts.push(h('div', { class: 'title' }, h('h2', {}, L.name[i]), h('span', { class: 'badge ' + level }, level), category[i] && category[i].toLowerCase() !== level ? h('span', { class: 'badge exo' }, category[i]) : null));
    parts.push(h('div', { class: 'ids' },
      h('span', {}, h('b', {}, 'id'), h('span', { class: 'mono' }, L.id[i])),
      !origin ? null : h('span', {}, origin === 'new' ? h('span', { class: 'badge new' }, 'New id: not in v2') : h('span', { class: 'badge endo', title: 'The id v2 gave this languoid, matched ' + origin.replace(/^v2 \((.*)\)$/, 'by $1') }, 'Id kept from v2 · ' + origin.replace(/^v2 \((.*)\)$/, '$1'))),
      h('span', {}, h('b', {}, 'glottocode'), h('a', { class: 'mono', href: 'https://glottolog.org/resource/languoid/id/' + L.glottocode[i], target: '_blank', rel: 'noopener' }, L.glottocode[i])),
      iso[i] ? h('span', {}, h('b', {}, 'ISO 639-3'), h('span', { class: 'mono' }, iso[i])) : null));
    const fact = (k, v) => h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v ?? h('span', { class: 'nullv' }, 'none')));
    parts.push(h('div', { class: 'facts' },
      fact('Macroareas', macro[i] || null),
      fact('Location', lat != null && lon != null ? [h('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=6/${lat}/${lon}`, target: '_blank', rel: 'noopener', class: 'num' }, lat + ', ' + lon),
        h('button', { type: 'button', class: 'ref globe-link', onclick: () => seeOnGlobe(i) }, 'See it on the globe')] : null),
      fact('hid', prop(i, 'hid')),
      fact('Below it', descendants[i] ? fmt(descendants[i]) + ' languoids' : null),
      fact('Names', fmt(aliasBy.of(i).length)),
      fact('Names written in it', aliasByLabel.of(i).length ? fmt(aliasByLabel.of(i).length) : null)));

    // regions
    const notes = [['glottolog_note', 'Glottolog'], ['iso_retirement_reason', 'ISO retired this code'], ['iso_retirement_date', 'Retired on'], ['iso_retirement_note', 'ISO\'s note']].map(([k, t]) => [t, prop(i, k)]).filter(([, v]) => v);
    const replaced = (prop(i, 'replaced_by') || '').split(', ').filter(Boolean).map((g) => byGlottocode.get(g)).filter((x) => x != null);
    if (notes.length || replaced.length) parts.push(h('section', { class: 'block callout' }, h('h3', {}, 'Retired or questioned'),
      notes.map(([t, v]) => h('p', {}, h('b', {}, t + ': '), v)),
      replaced.length ? h('p', {}, h('b', {}, 'Replaced by: '), replaced.flatMap((k, n) => [n ? ', ' : '', h('button', { type: 'button', class: 'ref', onclick: () => select(k, false) }, L.name[k])])) : null));
    parts.push(h('section', { class: 'block' }, h('h3', {}, 'Where it is spoken', h('span', { class: 'count num' }, fmt(regs.length))),
      regs.length ? h('div', { class: 'linkchips' }, regs.sort((a, b) => (R.level[a] === R.level[b] ? R.name[a].localeCompare(R.name[b]) : R.level[a] === 'macroarea' ? -1 : 1)).map((r) => h('button', { class: 'linkchip', type: 'button', onclick: () => openRegion(r) }, R.name[r], R.iso[r] ? h('span', { class: 'mono muted' }, R.iso[r]) : h('span', { class: 'muted' }, 'macroarea')))) : h('div', { class: 'muted' }, 'No region links.')));

    // its family: the way down from the top of its tree, and what is below it
    parts.push(familyTree(i, anc, kidList.length));

    // names
    const al = [...aliasBy.of(i)];
    const namesBox = h('div', { class: 'names' });
    const drawNames = () => {
      const sel = al.filter((j) => nameMode === 'all' || (nameMode === 'endo' ? A.type[j] === 1 : nameMode === 'exo' ? A.type[j] === 0 : nameMode === 'desc' ? A.type[j] === 3 : A.type[j] === 2));
      const groups = new Map();
      for (const j of sel) { const lb = A.label[j]; if (!groups.has(lb)) groups.set(lb, []); groups.get(lb).push(j); }
      const keys = [...groups.keys()].sort((a, b) => (a === i ? -1 : b === i ? 1 : 0) || (a < 0 ? 1 : b < 0 ? -1 : 0) || groups.get(b).length - groups.get(a).length || L.name[a].localeCompare(L.name[b]));
      namesBox.replaceChildren(...(keys.length ? keys.map((lb) => h('div', { class: 'namegroup' },
        lb < 0 ? h('h4', {}, 'Language not given by the source', h('span', { class: 'muted num' }, fmt(groups.get(lb).length))) : h('h4', {}, 'Written in ', h('button', { type: 'button', onclick: () => select(lb, false) }, L.name[lb]), iso[lb] ? h('span', { class: 'mono muted' }, iso[lb]) : null, h('span', { class: 'muted num' }, fmt(groups.get(lb).length)), umbrellaNote(lb)),
        h('ul', {}, groups.get(lb).sort((a, b) => A.name[a].localeCompare(A.name[b])).map((j) => h('li', {}, h('span', {}, A.name[j]), A.type[j] === 2 ? null : typeBadge(j), h('span', { class: 'prov' }, A.sourceList[A.sources[j]].split('|').join(', '))))))) : [h('div', { class: 'muted' }, nameMode === 'endo' ? 'No endonyms.' : 'None.')]));
    };
    const seg = h('span', { class: 'seg', role: 'group', 'aria-label': 'Which names' }, [['all', 'All'], ['endo', 'Endonyms'], ['exo', 'Exonyms'], ['unknown', 'Language not given'], ['desc', 'Descriptions']].map(([m, t]) => h('button', { type: 'button', 'aria-pressed': String(nameMode === m), onclick: (e) => { nameMode = m; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); drawNames(); } }, t)));
    drawNames();
    parts.push(h('section', { class: 'block' }, h('h3', {}, 'Other names', h('span', { class: 'count num' }, fmt(al.length)), seg), al.length ? namesBox : h('div', { class: 'muted' }, category[i] === 'Artificial Language' ? 'Artificial languages get no names here, as in v2.' : 'Glottolog gives no other names.')));

    // sources
    const src = [...sourceBy.of(i)];
    parts.push(h('section', { class: 'block' }, h('h3', {}, 'Sources', h('span', { class: 'count num' }, fmt(src.length))),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'name'), h('th', {}, 'unique_identifier'), h('th', {}, 'version'), h('th', {}, 'url'))),
        h('tbody', {}, src.map((j) => { const kind = S.kindList[S.kind[j]]; const u = kind === 'glottolog' ? 'https://glottolog.org/resource/languoid/id/' + S.id[j] : S.url[j]; return h('tr', {}, h('td', {}, kind), h('td', { class: 'mono' }, S.id[j]), h('td', {}, S.version[j] || h('span', { class: 'nullv' }, 'null')), h('td', {}, u ? h('a', { href: u, target: '_blank', rel: 'noopener' }, u.replace(/^https?:\/\//, '')) : h('span', { class: 'nullv' }, 'null'))); }))))));

    // properties
    const props = [...propBy.of(i)];
    parts.push(h('section', { class: 'block' }, h('h3', {}, 'Properties', h('span', { class: 'count num' }, fmt(props.length))),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'key'), h('th', {}, 'value'))), h('tbody', {}, props.map((j) => h('tr', {}, h('td', { class: 'mono' }, P.keyList[P.key[j]]), h('td', {}, P.value[j]))))))));
    detail.replaceChildren(...parts);
  }

  lv.shown = () => {};

  // ================= Regions =================
  const rv = { el: h('section', { class: 'view', id: 'view-regions' }) };
  views.regions = rv; main.append(rv.el);
  const rq = h('input', { id: 'rq', type: 'search', placeholder: 'Country, macroarea or ISO 3166 code', autocomplete: 'off', 'aria-label': 'Search regions' });
  const rList = h('div', { class: 'vlist' });
  const rDetail = h('div', { class: 'detail' });
  const rLine = h('div', { class: 'resultline' });
  rv.el.append(h('div', { class: 'listcol' }, h('div', { class: 'controls' }, h('div', { class: 'search' }, rq), rLine), rList), rDetail);
  // The globe (languages-globe.js): nations shaded by their languoids, each
  // languoid with a location a dot. It stays put while regions change under it.
  const globeBox = h('div', { class: 'globe' });
  const rInfo = h('div', {});
  let globe = null;
  const nationByIso = new Map(nations.map((r) => [R.iso[r].toUpperCase(), r]));
  const located = []; for (let i = 0; i < N; i++) if (L.lat[i] != null && L.lon[i] != null) located.push(i);
  const placed = (ls) => ls.filter((i) => L.lat[i] != null && L.lon[i] != null);
  rDetail.append(h('button', { class: 'back', type: 'button', onclick: () => rv.el.classList.remove('showdetail') }, '← Back to the list'),
    h('section', { class: 'globewrap', 'aria-label': 'Globe' }, globeBox,
      h('div', { class: 'globe-bar' },
        h('span', { class: 'legend' }, h('span', { class: 'lv language' }), 'language', h('span', { class: 'lv dialect' }), 'dialect', h('span', { class: 'lv family' }), 'family'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => globe?.zoomBy(1 / 1.5) }, '−'),
        h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => globe?.zoomBy(1.5) }, '+'),
        h('button', { type: 'button', onclick: () => globe?.reset() }, 'Whole globe')),
      h('p', { class: 'globe-hint' }, 'Drag to turn it and scroll or pinch to zoom. Darker countries have more languoids. Click a country to open it; zoom in to click a single languoid.')),
    rInfo);
  function makeGlobe() {
    if (globe || !window.LanguoidGlobe) { if (!window.LanguoidGlobe) globeBox.replaceChildren(h('div', { class: 'empty' }, 'The globe could not load.')); return; }
    globe = window.LanguoidGlobe.createGlobe(globeBox, {
      value: (a2) => { const r = nationByIso.get(a2); return r == null ? 0 : languoidsIn.of(r).length; },
      label: (a2, name) => { const r = nationByIso.get(a2); return r == null ? name + ' · no languoids' : R.name[r] + ' · ' + fmt(languoidsIn.of(r).length) + ' languoids'; },
      points: located.map((i) => ({ lon: L.lon[i], lat: L.lat[i], id: i, kind: L.level[i] })),
      pointLabel: (i) => L.name[i] + ' · ' + LEVELS[L.level[i]] + (iso[i] ? ' · ' + iso[i] : ''),
      onCountry: (a2) => { const r = nationByIso.get(a2); if (r != null) openRegion(r, false); },
      onPoint: (i) => openLanguoid(i)
    });
    window.addEventListener('lx-theme', () => globe.redraw());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => globe.redraw());
  }
  // A languoid's own place: its nation open (the one its dot is in, when it
  // names that one), the globe turned to the dot and ringed.
  function seeOnGlobe(i) {
    show('regions');
    const ns = [...regionsOf.of(i)].map((j) => LR.region[j]).filter((r) => R.level[r] === 'nation');
    const here = globe?.countryAt(L.lon[i], L.lat[i]);
    const nation = ns.find((r) => R.iso[r].toUpperCase() === here) ?? ns[0];
    if (nation != null) openRegion(nation, false, false);
    globe?.focus(L.lon[i], L.lat[i]);
  }
  let rSel = -1;
  let rRows = [];
  const rvl = vlist(rList, 50, (r) => h('div', { class: 'vrow' + (r === rSel ? ' sel' : ''), onclick: () => openRegion(r, true) },
    h('span', { class: 'lv ' + (R.level[r] === 'macroarea' ? 'family' : 'language') }),
    h('div', { class: 'main' }, h('div', { class: 'nm' }, mark(R.name[r], rq.value)), h('div', { class: 'sub' }, R.level[r] === 'macroarea' ? 'macroarea' : ['nation · ', mark(R.iso[r], rq.value)], ' · ' + fmt(languoidsIn.of(r).length) + ' languoids'))));
  const regionOrder = [...continents.sort((a, b) => R.name[a].localeCompare(R.name[b])), ...nations];
  function refreshRegions() {
    const t = norm(rq.value.trim());
    rRows = regionOrder.filter((r) => !t || norm(R.name[r]).includes(t) || R.iso[r].toLowerCase() === t);
    rLine.replaceChildren(h('span', { class: 'num' }, fmt(rRows.length) + ' regions'), h('span', {}, 'Macroareas, then nations'));
    rvl.set(rRows);
  }
  rq.addEventListener('input', refreshRegions);
  let regionLevel = 1;
  function openRegion(r, fromList, fly = true) {
    if (current !== 'regions') show('regions');
    rSel = r; rvl.redraw();
    if (!fromList) { const k = rRows.indexOf(r); if (k >= 0) rvl.scrollTo(k); }
    const ls = [...languoidsIn.of(r)].map((j) => LR.languoid[j]);
    globe?.select(R.level[r] === 'nation' ? R.iso[r].toUpperCase() : null, placed(ls), fly);
    const counts = [0, 0, 0]; for (const i of ls) counts[L.level[i]]++;
    const box = h('div', {});
    const draw = () => {
      const sel = ls.filter((i) => regionLevel === -1 || L.level[i] === regionLevel);
      const groups = new Map();
      for (const i of sel) { const k = L.parent[i] < 0 ? '(no family)' : L.name[root[i]]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
      const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b));
      let shown = 0;
      box.replaceChildren(...keys.map((k) => { const g = groups.get(k).sort((a, b) => L.name[a].localeCompare(L.name[b])); shown += g.length; return h('section', { class: 'block' }, h('h3', {}, k, h('span', { class: 'count num' }, fmt(g.length))), h('div', { class: 'kids' }, g.slice(0, 400).map((i) => h('button', { type: 'button', onclick: () => openLanguoid(i) }, h('span', { class: 'lv ' + LEVELS[L.level[i]] }), h('span', { class: 'n' }, L.name[i]), iso[i] ? h('span', { class: 'mono muted' }, iso[i]) : null))), g.length > 400 ? h('div', { class: 'muted' }, fmt(g.length - 400) + ' more; filter the Languoids view by this region to see them all.') : null); }));
      if (!keys.length) box.replaceChildren(h('div', { class: 'muted' }, 'None at this level.'));
    };
    const seg = h('span', { class: 'seg', role: 'group', 'aria-label': 'Level' }, [[-1, 'All'], [0, 'Families'], [1, 'Languages'], [2, 'Dialects']].map(([m, t]) => h('button', { type: 'button', 'aria-pressed': String(regionLevel === m), onclick: (e) => { regionLevel = m; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); draw(); } }, t + (m >= 0 ? ' ' + fmt(counts[m]) : ''))));
    draw();
    rInfo.replaceChildren(
      h('div', { class: 'crumbs' }, R.level[r] === 'macroarea' ? 'Macroarea' : 'Nation'),
      h('div', { class: 'title' }, h('h2', {}, R.name[r]), h('span', { class: 'badge ' + (R.level[r] === 'macroarea' ? 'family' : 'language') }, R.level[r])),
      h('div', { class: 'ids' }, h('span', {}, h('b', {}, 'id'), h('span', { class: 'mono' }, R.id[r])), R.iso[r] ? h('span', {}, h('b', {}, 'region_source iso3166-1'), h('span', { class: 'mono' }, R.iso[r])) : null),
      h('div', { class: 'facts' }, h('div', {}, h('div', { class: 'k' }, 'Families'), h('div', { class: 'v num' }, fmt(counts[0]))), h('div', {}, h('div', { class: 'k' }, 'Languages'), h('div', { class: 'v num' }, fmt(counts[1]))), h('div', {}, h('div', { class: 'k' }, 'Dialects'), h('div', { class: 'v num' }, fmt(counts[2])))),
      h('section', { class: 'block' }, h('h3', {}, 'Languoids spoken here, by top family', seg), box));
    rv.el.classList.add('showdetail');
    rDetail.scrollTop = 0;
  }
  rv.shown = () => { if (!rv.ready) { rv.ready = true; refreshRegions(); makeGlobe(); const mm = nations.find((r) => R.iso[r] === 'MW'); if (mm != null) openRegion(mm, true); } };

  // ================= Tables =================
  const tv = { el: h('section', { class: 'view', id: 'view-tables' }) };
  views.tables = tv; main.append(tv.el);
  const tablesBox = h('div', { class: 'tables' });
  tv.el.append(tablesBox);
  const ref = (i) => (i == null || i < 0 ? h('span', { class: 'nullv' }, 'null') : h('button', { class: 'ref', type: 'button', onclick: () => openLanguoid(i), title: L.id[i] }, h('span', { class: 'mono' }, L.id[i].slice(0, 8) + '…'), h('span', { class: 'rn' }, L.name[i])));
  const rref = (r) => h('button', { class: 'ref', type: 'button', onclick: () => openRegion(r), title: R.id[r] }, h('span', { class: 'mono' }, R.id[r].slice(0, 8) + '…'), h('span', { class: 'rn' }, R.name[r]));
  const nul = () => h('span', { class: 'nullv' }, 'null');
  const onLoad = () => h('span', { class: 'nullv' }, 'new on load');
  const yes = () => 'true';
  const TABLES = [
    { name: 'languoid', n: N, note: 'One row per Glottolog languoid. location is a map point (PostGIS geography) from Glottolog\'s coordinates. active is true; created_at and last_updated are set when the rows are loaded; creator_id is null for everything imported. ui_ready is gone.',
      cols: ['id', 'parent_id', 'name', 'level', 'location', 'active'], text: (k) => L.name[k] + ' ' + L.glottocode[k] + ' ' + L.id[k],
      cells: (k) => [h('span', { class: 'mono' }, L.id[k]), L.parent[k] >= 0 ? ref(L.parent[k]) : nul(), h('button', { class: 'ref', type: 'button', onclick: () => openLanguoid(k) }, L.name[k]), LEVELS[L.level[k]], L.lat[k] != null ? h('span', { class: 'mono' }, 'POINT(' + L.lon[k] + ' ' + L.lat[k] + ')') : nul(), yes()] },
    { name: 'languoid_alias', n: A.name.length, note: 'Every other name from Glottolog\'s altnames. Only lexvo says what language a name is written in; those get label_languoid_id, and alias_type endonym when the label is the languoid itself, else exonym. Other providers\' names have both null. Names that differ only in capital letters are one row. source_names are the providers that give the name.',
      cols: ['id', 'subject_languoid_id', 'label_languoid_id', 'name', 'alias_type', 'source_names', 'active'], text: (k) => A.name[k] + ' ' + L.name[A.subject[k]] + ' ' + (A.label[k] >= 0 ? L.name[A.label[k]] : '') + ' ' + A.sourceList[A.sources[k]],
      cells: (k) => [onLoad(), ref(A.subject[k]), ref(A.label[k]), A.name[k], A.type[k] === 2 ? nul() : typeBadge(k), '{' + A.sourceList[A.sources[k]].split('|').join(',') + '}', yes()] },
    { name: 'languoid_source', n: S.id.length, note: 'The glottocode (with the release as version), the ISO 639-3 code, and every link in Glottolog\'s file, named by site as v2 named them.',
      cols: ['id', 'name', 'version', 'languoid_id', 'unique_identifier', 'url', 'active'], text: (k) => S.kindList[S.kind[k]] + ' ' + S.id[k] + ' ' + L.name[S.languoid[k]] + ' ' + S.url[k],
      cells: (k) => { const kind = S.kindList[S.kind[k]]; const u = kind === 'glottolog' ? 'https://glottolog.org/resource/languoid/id/' + S.id[k] : S.url[k]; return [onLoad(), kind, S.version[k] || nul(), ref(S.languoid[k]), h('span', { class: 'mono' }, S.id[k]), u ? h('a', { href: u, target: '_blank', rel: 'noopener' }, u.replace(/^https?:\/\//, '')) : nul(), yes()]; } },
    { name: 'languoid_property', n: P.value.length, note: 'Glottolog\'s keys: hid and category. Macroareas are region links and coordinates are languoid.location, so neither is repeated here.',
      cols: ['id', 'languoid_id', 'key', 'value', 'active'], text: (k) => P.keyList[P.key[k]] + ' ' + P.value[k] + ' ' + L.name[P.languoid[k]],
      cells: (k) => [onLoad(), ref(P.languoid[k]), h('span', { class: 'mono' }, P.keyList[P.key[k]]), P.value[k], yes()] },
    { name: 'region', n: R.name.length, note: 'The six Glottolog macroareas (level macroarea), and every country a languoid names as a nation, with its plain English name. parent_id is null and geometry false, as in v2.',
      cols: ['id', 'parent_id', 'name', 'level', 'geometry', 'active'], text: (k) => R.name[k] + ' ' + R.iso[k],
      cells: (k) => [h('span', { class: 'mono' }, R.id[k]), nul(), h('button', { class: 'ref', type: 'button', onclick: () => openRegion(k) }, R.name[k]), R.level[k], 'false', yes()] },
    { name: 'region_alias', n: 0, note: 'Glottolog gives no other names for regions, so this stays empty, as it nearly was in v2 (one row).', cols: ['id', 'subject_region_id', 'label_languoid_id', 'name', 'active'], text: () => '', cells: () => [] },
    { name: 'region_source', n: R.iso.filter(Boolean).length, note: 'Each nation\'s ISO 3166-1 code.', rows: R.iso.map((c, r) => (c ? r : -1)).filter((r) => r >= 0),
      cols: ['id', 'name', 'version', 'region_id', 'unique_identifier', 'url', 'active'], text: (k) => R.name[k] + ' ' + R.iso[k],
      cells: (k) => [onLoad(), 'iso3166-1', nul(), rref(k), h('span', { class: 'mono' }, R.iso[k]), nul(), yes()] },
    { name: 'region_property', n: 0, note: 'Nothing from Glottolog, as in v2.', cols: ['id', 'region_id', 'key', 'value', 'active'], text: () => '', cells: () => [] },
    { name: 'languoid_region', n: LR.languoid.length, note: 'A link from each languoid to its macroareas and its countries. majority, official and native are null: Glottolog does not say.',
      cols: ['id', 'languoid_id', 'region_id', 'majority', 'official', 'native', 'active'], text: (k) => L.name[LR.languoid[k]] + ' ' + R.name[LR.region[k]] + ' ' + R.iso[LR.region[k]],
      cells: (k) => [onLoad(), ref(LR.languoid[k]), rref(LR.region[k]), nul(), nul(), nul(), yes()] }
  ];
  let tSel = 0, tPage = 0, tFilter = '', tRows = null;
  const PAGE = 100;
  function drawTable() {
    const t = TABLES[tSel];
    const all = t.rows ?? [...Array(t.n).keys()];
    const f = norm(tFilter.trim());
    tRows = f ? all.filter((k) => norm(t.text(k)).includes(f)) : all;
    const pages = Math.max(1, Math.ceil(tRows.length / PAGE)); tPage = Math.min(tPage, pages - 1);
    const filterInput = h('input', { id: 'tfilter', type: 'search', placeholder: 'Filter these rows', value: tFilter, 'aria-label': 'Filter rows' });
    let ft = 0; filterInput.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => { tFilter = filterInput.value; tPage = 0; drawTable(); const el = $('#tfilter'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); });
    const pager = h('div', { class: 'pager' }, filterInput,
      h('button', { type: 'button', disabled: tPage === 0, onclick: () => { tPage--; drawTable(); } }, '← Previous'),
      h('span', { class: 'num' }, 'Page ' + fmt(tPage + 1) + ' of ' + fmt(pages) + ' · ' + fmt(tRows.length) + ' rows'),
      h('button', { type: 'button', disabled: tPage >= pages - 1, onclick: () => { tPage++; drawTable(); } }, 'Next →'));
    tablesBox.replaceChildren(
      h('div', { class: 'tablepick', role: 'group', 'aria-label': 'Table' }, TABLES.map((x, k) => h('button', { type: 'button', 'aria-pressed': String(k === tSel), onclick: () => { tSel = k; tPage = 0; tFilter = ''; drawTable(); } }, h('span', { class: 't' }, x.name), h('span', { class: 'c num' }, fmt(x.n) + ' rows')))),
      h('p', { class: 'note' }, t.note),
      pager,
      t.n ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, t.cols.map((c) => h('th', {}, c)))), h('tbody', {}, tRows.slice(tPage * PAGE, tPage * PAGE + PAGE).map((k) => h('tr', {}, t.cells(k).map((c) => h('td', {}, c))))))) : h('div', { class: 'empty' }, 'No rows.'));
  }
  tv.shown = () => { if (!tv.ready) { tv.ready = true; drawTable(); } };

  // ================= Summary =================
  const sv = { el: h('section', { class: 'view', id: 'view-summary' }) };
  views.summary = sv; main.append(sv.el);
  const sBox = h('div', { class: 'summary' }); sv.el.append(sBox);
  const tally = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const bars = (title, rows, onPick) => { const max = Math.max(1, ...rows.map((r) => r[1])); return h('div', { class: 'bars' }, h('h3', {}, title), rows.map(([k, v]) => h('div', { class: 'bar' }, onPick ? h('button', { type: 'button', class: 'lab ref', onclick: () => onPick(k), title: String(k) }, String(k)) : h('span', { class: 'lab', title: String(k) }, String(k)), h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + (100 * v / max).toFixed(1) + '%' })), h('span', { class: 'val' }, fmt(v))))); };
  function drawSummary() {
    const unl = Object.entries(D.unlabelled).sort((a, b) => b[1] - a[1]);
    const origin = tally(L.origin.map((o) => (o === 'new' ? 'New id' : 'Kept from v2, by ' + o.replace(/^v2 \((.*)\)$/, '$1'))));
    const labels = tally(A.label.filter((x) => x >= 0)).slice(0, 12).map(([k, v]) => [L.name[k], v, k]);
    sBox.replaceChildren(h('div', { class: 'inner' },
      h('div', { class: 'tiles' }, TABLES.map((t, k) => h('button', { class: 'tile', type: 'button', onclick: () => { show('tables'); tSel = k; tPage = 0; tFilter = ''; drawTable(); } }, h('div', { class: 't' }, t.name), h('div', { class: 'n' }, fmt(t.n))))),
      h('div', { class: 'cols' },
        bars('Languoids by level', tally(L.level.map((l) => LEVELS[l]))),
        L.origin.some(Boolean) ? bars('Where the ids come from', origin) : null,
        bars('Categories', tally(category).map(([k, v]) => [k || '(none)', v])),
        bars('Names by type', tally(A.type.map((e) => TYPE[e]))),
        h('div', { class: 'bars' }, h('h3', {}, 'Languages names are written in (top 12)'), (() => { const max = labels[0]?.[1] ?? 1; return labels.map(([n, v, k]) => h('div', { class: 'bar' }, h('button', { type: 'button', class: 'lab ref', onclick: () => openLanguoid(k) }, n), h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + (100 * v / max).toFixed(1) + '%' })), h('span', { class: 'val' }, fmt(v)))); })()),
        h('div', { class: 'bars' }, h('h3', {}, 'Names written in a family (umbrella codes)'), h('p', { class: 'note' }, 'lexvo tags these names with an umbrella code that Glottolog files on a family. Codes with a main language point at it; these have none, so they stay on the family.'),
          (D.umbrella || []).map((u) => h('div', { class: 'bar' }, h('button', { type: 'button', class: 'lab ref', onclick: () => openLanguoid(u.family) }, L.name[u.family] + ' (' + u.code + ')'), u.proposed >= 0 ? h('button', { type: 'button', class: 'lab ref', onclick: () => openLanguoid(u.proposed) }, '→ ' + L.name[u.proposed]) : h('span', { class: 'muted' }, 'stays'), h('span', { class: 'val' }, fmt(aliasByLabel.of(u.family).length))))),
        bars('Name providers', tally(A.sources.flatMap((s) => A.sourceList[s].split('|')))),
        bars('Sources by name', tally(S.kind.map((k) => S.kindList[k]))),
        bars('Properties by key', tally(P.key.map((k) => P.keyList[k]))),
        bars('Region links by macroarea', continents.map((r) => [R.name[r], languoidsIn.of(r).length]).sort((a, b) => b[1] - a[1])),
        bars('Nations with the most languoids', nations.map((r) => [R.name[r], languoidsIn.of(r).length]).sort((a, b) => b[1] - a[1]).slice(0, 12)),
        h('div', { class: 'bars' }, h('h3', {}, 'Names left out'), h('p', { class: 'note' }, 'Names tagged with a language that has no single languoid here (Quechua, Kongo and Sardinian are groups of languages in Glottolog), so they have no label.'), unl.length ? unl.map(([k, v]) => h('div', { class: 'bar' }, h('span', { class: 'lab mono' }, k), h('span', {}), h('span', { class: 'val' }, fmt(v)))) : h('div', { class: 'muted' }, 'None.')))));
  }
  sv.shown = () => { if (!sv.ready) { sv.ready = true; drawSummary(); } };

  // ---- start ----
  refresh();
  const fromHash = byGlottocode.get(location.hash.slice(1));
  select(fromHash ?? byGlottocode.get('stan1293') ?? 0, false);
  lv.el.classList.remove('showdetail');
  if (fromHash != null) lv.el.classList.add('showdetail');
  window.addEventListener('hashchange', () => { const i = byGlottocode.get(location.hash.slice(1)); if (i != null && i !== st.sel) openLanguoid(i); });
  const saved = store.get('lx-view');
  show(saved && views[saved] ? saved : 'languoids');
  void byId;
}
})();
