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

  const api = impress();
  api.init();

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
