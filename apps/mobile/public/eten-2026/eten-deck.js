/* ETEN 2026 deck · behaviour.
   Keys: ← → / space move · G whole path · N presenter notes on screen · P speaker console
         B blank screen · Home / End */
(function () {
  const root = document.getElementById('impress');
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: fine */ } },
  };

  // Waveforms: <div class="wave" data-wave="70">
  $$('[data-wave]').forEach((el, k) => {
    let html = '', seed = 11 + k * 17;
    for (let i = 0; i < Number(el.dataset.wave); i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const env = 0.3 + 0.7 * Math.abs(Math.sin(i / 6 + k));
      html += `<b style="height:${Math.round(10 + 90 * env * (seed / 233280))}%"></b>`;
    }
    el.innerHTML = html;
  });
  // Audio cards: <div class="cards-row" data-cards="7">
  $$('[data-cards]').forEach((el, k) => {
    let html = '', seed = 5 + k * 31;
    for (let i = 0; i < Number(el.dataset.cards); i++) {
      let bars = '';
      for (let j = 0; j < 9; j++) { seed = (seed * 9301 + 49297) % 233280; bars += `<b style="height:${20 + Math.round(70 * seed / 233280)}%"></b>`; }
      html += `<i>${bars}</i>`;
    }
    el.innerHTML = html;
  });

  const steps = $$('.step');
  const main = steps.filter(s => !s.classList.contains('overview'));
  const progress = document.getElementById('progress');
  const label = step => {
    const i = main.indexOf(step);
    progress.textContent = i >= 0 ? `${String(i + 1).padStart(2, '0')} / ${main.length}` : 'Map';
  };

  const fmt = n => n.toLocaleString('en-US');
  function countUp(el) {
    const end = Number(el.dataset.count), t0 = performance.now(), dur = 1500;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.firstChild.nodeValue = (el.dataset.prefix || '') + fmt(Math.round(end * e)) + (el.dataset.suffix || '');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Presenter notes pane
  const pane = document.createElement('aside');
  pane.className = 'notes-pane';
  pane.hidden = true;
  document.body.appendChild(pane);
  let notesOn = store.get('eten-deck:notes') === true;
  function showNotes(step) {
    const n = step && step.querySelector('.notes');
    pane.innerHTML = '<div class="nh">Speaker notes</div>' + (n ? n.innerHTML : '<p>No notes for this step.</p>');
    pane.hidden = !notesOn;
  }
  document.addEventListener('impress:stepenter', e => {
    $$('[data-count]', e.target).forEach(countUp);
    label(e.target); showNotes(e.target);
  });

  // Safari crashes when a 3D layer reaches behind the camera. Before each move, hide any
  // pane that comes near the eye at either end, and bring it back after.
  const rad = d => d * Math.PI / 180;
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const turn = ([x, y, z], rx, ry, rz) => {
    let c = Math.cos(rad(rz)), s = Math.sin(rad(rz));
    [x, y] = [x * c - y * s, x * s + y * c];
    c = Math.cos(rad(ry)); s = Math.sin(rad(ry));
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rad(rx)); s = Math.sin(rad(rx));
    [y, z] = [y * c - z * s, y * s + z * c];
    return [x, y, z];
  };
  const pose = el => {
    const d = el.dataset;
    if (el.classList.contains('step')) {
      return { p: [num(d.x, 0), num(d.y, 0), num(d.z, 0)], r: [num(d.rotateX, 0), num(d.rotateY, 0), num(d.rotateZ, num(d.rotate, 0))], s: num(d.scale, 1) };
    }
    const t = (el.style.transform.match(/translate3d\(([^)]*)\)/) || [, '0,0,0'])[1].split(',').map(parseFloat);
    return { p: t, r: [0, 0, 0], s: 1 };
  };
  const bodies = $$('.step, .decor', root).map(el => {
    const { p, r, s } = pose(el);
    const w = el.offsetWidth * s / 2, h = el.offsetHeight * s / 2;
    const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => {
      const v = turn([x, y, 0], ...r);
      return [v[0] + p[0], v[1] + p[1], v[2] + p[2]];
    });
    return { el, corners };
  });
  const perspective = num(root.dataset.perspective, 1000);
  const windowScale = () => {
    const s = Math.min(innerWidth / num(root.dataset.width, 1024), innerHeight / num(root.dataset.height, 768));
    return Math.min(num(root.dataset.maxScale, 1), Math.max(num(root.dataset.minScale, 0), s));
  };
  function nearEye(step) {
    const { p, r, s } = pose(step);
    const n = turn([0, 0, 1], ...r);
    const limit = 0.6 * perspective * s / windowScale();
    return bodies.filter(b => b.el !== step && b.corners.some(c =>
      (c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] + (c[2] - p[2]) * n[2] > limit)).map(b => b.el);
  }
  function cull(inView, moving) {
    const out = new Set(inView.flatMap(nearEye));
    inView.forEach(s => out.delete(s));
    bodies.forEach(({ el }) => {
      if (el.classList.contains('overview') && (moving || !inView.includes(el))) out.add(el);
      el.classList.toggle('culled', out.has(el));
    });
  }
  document.addEventListener('impress:stepleave', e => cull([e.target, (e.detail && e.detail.next) || e.target], true));
  document.addEventListener('impress:stepenter', e => cull([e.target], false));
  addEventListener('resize', () => { const s = root.querySelector('.step.active'); if (s) cull([s], false); });

  const api = impress();
  api.init();
  const first = root.querySelector('.step.active');
  if (first) { cull([first], false); showNotes(first); label(first); }

  document.getElementById('prev').addEventListener('click', () => api.prev());
  document.getElementById('next').addEventListener('click', () => api.next());
  document.getElementById('overview').addEventListener('click', () => api.goto(root.dataset.overview));
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') api.goto(root.dataset.overview);
    if (k === 'n') { notesOn = !notesOn; store.set('eten-deck:notes', notesOn); pane.hidden = !notesOn; }
    if (k === 'b') document.body.classList.toggle('blank');
    if (e.key === 'Home') api.goto(0);
    if (e.key === 'End') api.goto(main[main.length - 1]);
  });
})();
