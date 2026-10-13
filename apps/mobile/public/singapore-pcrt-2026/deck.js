/* LangQuest · Singapore 2026 — shared behaviour for both sessions.
   Keys: ← → / space to move · G overview · Q questions (session 2) · P speaker notes · B blank screen */
(function () {
  const root = document.getElementById('impress');

  // Screenshots: <img data-shot="20-getting-started">. Change data-shots (folder) or
  // data-shot-ext (file type) on <body> to swap them.
  const shots = document.body.dataset.shots || '../../partner-pitch/screens/';
  const ext = document.body.dataset.shotExt || '.png';
  document.querySelectorAll('img[data-shot]').forEach(img => {
    img.src = shots + img.dataset.shot + ext;
    img.decoding = 'async';
  });

  // Dot fields: <div class="dots" data-dots="120">
  document.querySelectorAll('[data-dots]').forEach(el => {
    let html = '';
    for (let i = 0; i < Number(el.dataset.dots); i++) html += `<i style="--i:${i}"></i>`;
    el.innerHTML = html;
  });

  // Sound bars: <div class="soundline" data-bars="15">
  document.querySelectorAll('[data-bars]').forEach(el => {
    const heights = [48, 93, 150, 73, 190, 120, 60, 168, 92, 46, 132, 210, 84, 140, 66, 180, 100, 54, 150, 88];
    let html = '';
    for (let i = 0; i < Number(el.dataset.bars); i++) html += `<i style="--i:${i};height:${heights[i % heights.length] * (el.dataset.barScale || 1)}px"></i>`;
    el.innerHTML = html;
  });

  // Phase strips (session 2): <div class="phase-strip" data-phase="3">
  const phases = (root.dataset.phases || '').split('|').filter(Boolean);
  document.querySelectorAll('.phase-strip[data-phase]').forEach(el => {
    const on = Number(el.dataset.phase);
    el.innerHTML = phases.map((p, i) => `<span class="${i + 1 === on ? 'on' : i + 1 < on ? 'done' : ''}">${i + 1} ${p}</span>`).join('');
  });

  const steps = [...document.querySelectorAll('.step')];
  const main = steps.filter(s => !s.classList.contains('skip'));
  const progress = document.getElementById('progress');

  const fmt = n => n.toLocaleString('en-US');
  function countUp(el) {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const t0 = performance.now();
    const dur = 1700;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.firstChild.nodeValue = fmt(Math.round(end * e)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function reveal(step, on) {
    if (!step.dataset.reveal) return;
    document.querySelectorAll(step.dataset.reveal).forEach(el => el.classList.toggle('revealed', on));
  }

  function label(step) {
    const i = main.indexOf(step);
    progress.textContent = i >= 0 ? `${String(i + 1).padStart(2, '0')} / ${main.length}` : 'Q&A';
  }
  document.addEventListener('impress:stepenter', e => {
    const step = e.target;
    label(step);
    step.querySelectorAll('[data-count]').forEach(countUp);
    reveal(step, true);
  });
  // Start roll-ups as the camera begins to move, not when it arrives.
  document.addEventListener('impress:stepleave', e => {
    const next = e.detail && e.detail.next;
    reveal(e.target, false);
    if (next) { reveal(next, true); label(next); }
  });

  // An objection counts as answered once its answer is on screen.
  document.addEventListener('impress:substep:enter', e => {
    if (e.target.classList.contains('objection')) e.target.classList.add('answered');
  });
  document.addEventListener('impress:substep:leave', e => {
    const s = e.target;
    if (s.classList.contains('objection') && !s.querySelector('.substep-visible')) s.classList.remove('answered');
  });

  // Safari crashes ("A problem repeatedly occurred") when a 3D layer reaches
  // behind the camera. On curved rows (rotate-y) far slides do: from setup-5,
  // the cover is 6,600px behind the eye. So before each move, take out every
  // card that comes near the eye at either end, and put it back after.
  const rad = d => d * Math.PI / 180;
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  // CSS rotateX(rx) rotateY(ry) rotateZ(rz) applied to v, impress's default order.
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
      return {
        p: [num(d.x, 0), num(d.y, 0), num(d.z, 0)],
        r: [num(d.rotateX, 0), num(d.rotateY, 0), num(d.rotateZ, num(d.rotate, 0))],
        s: num(d.scale, 1),
      };
    }
    const t = (el.style.transform.match(/translate3d\(([^)]*)\)/) || [, '0,0,0'])[1].split(',').map(parseFloat);
    return { p: t, r: [0, 0, 0], s: 1 };
  };
  const bodies = [...root.querySelectorAll('.step, .decor')].map(el => {
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
  // Cards whose nearest corner is closer than 0.6 of the camera distance.
  function nearEye(step) {
    const { p, r, s } = pose(step);
    const n = turn([0, 0, 1], ...r);
    const limit = 0.6 * perspective * s / windowScale();
    return bodies.filter(b => b.el !== step && b.corners.some(c =>
      (c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] + (c[2] - p[2]) * n[2] > limit)).map(b => b.el);
  }
  function cull(...stepsInView) {
    const out = new Set(stepsInView.flatMap(nearEye));
    stepsInView.forEach(s => out.delete(s));
    bodies.forEach(b => { b.el.style.display = out.has(b.el) ? 'none' : ''; });
  }
  document.addEventListener('impress:stepleave', e => cull(e.target, (e.detail && e.detail.next) || e.target));
  document.addEventListener('impress:stepenter', e => cull(e.target));
  addEventListener('resize', () => { const s = root.querySelector('.step.active'); if (s) cull(s); });

  const api = impress();
  api.init();
  // The first goto (from the URL) moves the camera without a stepleave.
  const first = root.querySelector('.step.active');
  if (first) cull(first);

  document.getElementById('prev').addEventListener('click', () => api.prev());
  document.getElementById('next').addEventListener('click', () => api.next());
  document.getElementById('overview').addEventListener('click', () => api.goto(root.dataset.overview));
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'g') api.goto(root.dataset.overview);
    if (k === 'q' && root.dataset.faq) api.goto(root.dataset.faq);
    if (e.key === 'Home') api.goto(0);
    if (e.key === 'End') api.goto(main[main.length - 1]);
  });
})();
