/**
 * `/r/<code>`: the page someone opens from a shared review link
 * (decisions.md 71, links.ts). No account, no app, nothing else on screen:
 * listen, say something at the moment it matters (as many voice clips as
 * needed, each pinned to where the audio was), choose looks good or needs
 * changes, and send under any name, which this browser remembers. Built for
 * a phone on a weak connection: one small page, audio streamed card by
 * card, clips recorded as MP4 where the browser can and otherwise as 16 kHz
 * WAV, which is what every phone plays (decision 58). It links the privacy
 * policy, since it collects a name and a voice from someone without an
 * account.
 */
export function reviewPage(code: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#6B48C8">
<title>Review · LangQuest</title>
<style>
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --red:#B42318; --green:#1F7A4D; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --red:#FF8A80; --green:#7FD6A4; color-scheme: dark; } }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin:0; background:var(--bg); color:var(--ink); font:18px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 520px; margin: 0 auto; padding: 20px 16px calc(32px + env(safe-area-inset-bottom)); }
h1 { font-size: 26px; margin: 2px 0 2px; line-height: 1.2; }
.muted { color: var(--muted); } p { margin: 4px 0; } small { font-size: 14px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 18px; margin: 14px 0; }
button { font: inherit; font-weight: 600; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 14px; min-height: 48px; padding: 0 16px; cursor: pointer; }
button:disabled { opacity: .45; }
.player { display: grid; grid-template-columns: 72px 1fr; gap: 14px; align-items: center; }
.play { width: 72px; height: 72px; border-radius: 50%; border: 0; background: var(--primary); color: #fff; font-size: 26px; padding: 0; }
.track { position: relative; height: 48px; display: flex; align-items: center; }
.track input { width: 100%; accent-color: var(--primary); margin: 0; height: 48px; }
.marks { position: absolute; left: 0; right: 0; top: 4px; height: 8px; pointer-events: none; }
.marks span { position: absolute; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: var(--red); }
.time { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 15px; }
.say { width: 100%; min-height: 64px; margin-top: 14px; border-radius: 16px; font-size: 19px; }
.say.on { background: var(--red); border-color: var(--red); color: #fff; }
.clips { list-style: none; margin: 10px 0 0; padding: 0; }
.clips li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
.clips li:first-child { border-top: 0; }
.clips .at { flex: 1; text-align: left; border: 0; background: none; padding: 0 4px; min-height: 48px; }
.clips .x { width: 48px; padding: 0; color: var(--muted); }
.choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.choice { min-height: 72px; border-radius: 16px; font-size: 18px; }
.choice[aria-pressed=true].good { background: var(--green); border-color: var(--green); color: #fff; }
.choice[aria-pressed=true].changes { background: var(--red); border-color: var(--red); color: #fff; }
details summary { min-height: 48px; display: flex; align-items: center; color: var(--primary); font-weight: 600; cursor: pointer; list-style: none; }
details summary::-webkit-details-marker { display: none; }
textarea, input[type=text] { width: 100%; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 12px; min-height: 52px; }
textarea { min-height: 110px; resize: vertical; }
.name { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 48px; }
.send { width: 100%; min-height: 60px; border: 0; background: var(--primary); color: #fff; border-radius: 16px; font-size: 19px; margin-top: 6px; }
.notice { padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); margin: 12px 0; }
.notice.red { color: var(--red); } .notice.green { color: var(--green); }
.foot { text-align: center; margin-top: 18px; }
.foot a { color: var(--muted); }
.label { font-weight: 600; margin: 0 0 8px; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <p class="muted" id="lang"></p>
  <h1 id="title">Loading…</h1>
  <p class="muted" id="ask"></p>
  <div id="out" role="status" aria-live="polite"></div>

  <section class="card" id="listen" hidden>
    <div class="player">
      <button type="button" class="play" id="play" aria-label="Play">▶</button>
      <div>
        <div class="track"><div class="marks" id="marks"></div><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Where in the recording"></div>
        <div class="time" id="time">0:00</div>
      </div>
    </div>
    <button type="button" class="say" id="say" hidden>🎙 Comment here</button>
    <ul class="clips" id="clips"></ul>
  </section>

  <form id="form" hidden>
    <section class="card">
      <p class="label">How does it sound?</p>
      <div class="choices">
        <button type="button" class="choice good" data-outcome="looks_good" aria-pressed="false">👍 Good</button>
        <button type="button" class="choice changes" data-outcome="needs_changes" aria-pressed="false">✋ Needs changes</button>
      </div>
      <details id="write">
        <summary>✎ Write a comment</summary>
        <textarea id="comment" maxlength="4000" placeholder="What did you notice?" aria-label="Comment"></textarea>
      </details>
    </section>
    <section class="card">
      <div class="name" id="known" hidden><span>Answering as <b id="known-name"></b></span><button type="button" id="rename">Change</button></div>
      <div id="ask-name"><p class="label"><label for="name">Your name</label></p><input id="name" type="text" maxlength="80" autocomplete="name" placeholder="Shown to the translation team"></div>
      <button class="send" type="submit" id="send">Send</button>
    </section>
  </form>

  <section class="card" id="done" hidden>
    <p class="notice green">Thank you. The translation team will see your answer.</p>
    <button type="button" id="again">Change my answer</button>
  </section>

  <p class="foot"><small class="muted">Your name, answer and voice clips go to the translation team that sent this link. <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a></small></p>
</main>
<script>
const CODE = ${JSON.stringify(code)};
const API = '/api/v1/links/' + CODE;
const MAX_CLIPS = 10;
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
let browserId = store.get('lq-review-browser'); if (!browserId) { browserId = rid(); store.set('lq-review-browser', browserId); }
let outcome = null, submissionId = rid(), player = null;
/** { blob, atMs, durationMs, url } — kept in the page until Send. */
let clips = [];

function say(text, tone) { const o = $('out'); o.textContent = ''; if (!text) return; const p = document.createElement('p'); p.className = 'notice ' + (tone || ''); p.textContent = text; o.append(p); }
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

async function load() {
  let res, data;
  try { res = await fetch(API); data = await res.json(); } catch { $('title').textContent = 'No connection'; say('Check your connection and reload this page.', 'red'); return; }
  if (!res.ok) { $('title').textContent = 'This link does not work'; say(data.error || 'Ask whoever sent it for a new one.', 'red'); return; }
  $('lang').textContent = data.language + (data.passage.path.length ? ' · ' + data.passage.path.join(' · ') : '');
  $('title').textContent = data.passage.label;
  $('ask').textContent = data.kind.name + (data.label ? ' · ' + data.label : '');
  if (!data.open) { say('This review link has closed. Ask whoever sent it for a new one.', 'red'); return; }
  player = makePlayer(data.audio);
  $('form').hidden = false;
  showName(store.get('lq-review-name') || '');
}

// ---- listening: the version's cards as one recording, with seeking across them.
function makePlayer(cards) {
  if (!cards.length) return null;
  $('listen').hidden = false;
  const starts = []; let total = 0;
  for (const c of cards) { starts.push(total); total += c.durationMs || 0; }
  const audio = new Audio(); audio.preload = 'auto';
  let i = 0, playing = false, pendingSeek = null;
  const now = () => starts[i] + (audio.currentTime || 0) * 1000;
  const show = () => { const at = now(); if (total) $('seek').value = String(Math.round((at / total) * 1000)); $('time').textContent = fmt(at) + (total ? ' / ' + fmt(total) : ''); };
  const setIcon = () => { $('play').textContent = playing ? '❚❚' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play'); };
  const load = (n, offsetMs) => {
    i = n;
    if (audio.dataset.n !== String(n)) { audio.src = cards[n].url; audio.dataset.n = String(n); pendingSeek = offsetMs; }
    else audio.currentTime = offsetMs / 1000;
  };
  audio.addEventListener('loadedmetadata', () => { if (pendingSeek !== null) { audio.currentTime = pendingSeek / 1000; pendingSeek = null; } });
  audio.addEventListener('timeupdate', show);
  audio.addEventListener('ended', () => {
    if (i + 1 < cards.length) { load(i + 1, 0); if (playing) audio.play().catch(() => {}); }
    else { playing = false; setIcon(); load(0, 0); show(); }
  });
  audio.addEventListener('error', () => say('The audio did not load. Reload the page to try again.', 'red'));
  const api = {
    get playing() { return playing; },
    now,
    play() { playing = true; setIcon(); audio.play().catch(() => { playing = false; setIcon(); say('Tap play again to listen.', 'red'); }); },
    pause() { playing = false; setIcon(); audio.pause(); },
    seek(ms) {
      ms = Math.max(0, Math.min(ms, total));
      let n = 0; while (n + 1 < cards.length && starts[n + 1] <= ms) n++;
      load(n, ms - starts[n]); show();
    },
    total
  };
  $('play').addEventListener('click', () => (playing ? api.pause() : api.play()));
  $('seek').addEventListener('input', () => { if (total) api.seek((Number($('seek').value) / 1000) * total); });
  if (!total) $('seek').disabled = true;
  load(0, 0); show();
  if (window.MediaRecorder && navigator.mediaDevices) $('say').hidden = false;
  return api;
}

// ---- comments at a moment: as many short clips as needed, each pinned to where the audio was.
let recorder = null, stream = null, chunks = [], startedAt = 0, atMs = 0, tick = null;
const MP4 = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));

$('say').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  if (clips.length >= MAX_CLIPS) { say('That is as many clips as one answer takes. Remove one to add another.', 'red'); return; }
  atMs = player ? Math.round(player.now()) : 0;
  if (player && player.playing) player.pause();
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { say('The microphone was not allowed. You can still write a comment.', 'red'); return; }
  say('');
  chunks = []; recorder = MP4 ? new MediaRecorder(stream, { mimeType: MP4 }) : new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    const durationMs = Date.now() - startedAt;
    const raw = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    recorder = null; $('say').classList.remove('on'); $('say').textContent = '🎙 Comment here';
    if (durationMs < 600) return; // a slip of the thumb
    try {
      const blob = MP4 ? raw : await toWav(raw);
      clips.push({ blob, atMs: clipAt, durationMs, url: URL.createObjectURL(blob) });
      clips.sort((a, b) => a.atMs - b.atMs);
      drawClips();
    } catch { say('That clip could not be kept. Try again, or write a comment.', 'red'); }
  };
  const clipAt = atMs;
  recorder.start(); startedAt = Date.now();
  $('say').classList.add('on');
  const label = () => { $('say').textContent = '■ Stop · at ' + fmt(clipAt) + ' · ' + fmt(Date.now() - startedAt); };
  label(); tick = setInterval(label, 500);
});

function drawClips() {
  const list = $('clips'); list.textContent = '';
  const marks = $('marks'); marks.textContent = '';
  clips.forEach((c, n) => {
    const li = document.createElement('li');
    const at = document.createElement('button'); at.type = 'button'; at.className = 'at';
    at.textContent = '🎙 At ' + fmt(c.atMs) + ' · ' + Math.max(1, Math.round(c.durationMs / 1000)) + ' s';
    at.addEventListener('click', () => { if (player) player.seek(c.atMs); new Audio(c.url).play().catch(() => {}); });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove the clip at ' + fmt(c.atMs));
    x.addEventListener('click', () => { URL.revokeObjectURL(c.url); clips.splice(n, 1); drawClips(); });
    li.append(at, x); list.append(li);
    if (player && player.total) { const m = document.createElement('span'); m.style.left = (100 * c.atMs / player.total) + '%'; marks.append(m); }
  });
}

async function toWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const rate = 16000, length = Math.ceil(decoded.duration * rate);
  const off = new OfflineAudioContext(1, length, rate);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}

// ---- the answer
document.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
  outcome = b.dataset.outcome;
  document.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));

function showName(name) {
  $('name').value = name;
  $('known').hidden = !name; $('ask-name').hidden = !!name;
  $('known-name').textContent = name;
}
$('rename').addEventListener('click', () => { $('known').hidden = true; $('ask-name').hidden = false; $('name').focus(); });

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (recorder) recorder.stop();
  const name = $('name').value.trim();
  if (!outcome) { say('Choose Good or Needs changes first.', 'red'); return; }
  if (!name) { say('Type your name first. Any name will do.', 'red'); $('ask-name').hidden = false; $('name').focus(); return; }
  $('send').disabled = true;
  try {
    const voiceNotes = [];
    for (let n = 0; n < clips.length; n++) {
      say('Sending voice clip ' + (n + 1) + ' of ' + clips.length + '…');
      const c = clips[n];
      if (!c.uploaded) {
        const up = await fetch(API + '/voice-note', { method: 'PUT', body: c.blob, headers: { 'content-type': c.blob.type } });
        const body = await up.json();
        if (!up.ok) throw new Error(body.error || 'A voice clip did not send.');
        c.uploaded = body.voiceNote;
      }
      voiceNotes.push({ ...c.uploaded, durationMs: c.durationMs, atMs: c.atMs });
    }
    say('Sending…');
    const comment = $('comment').value.trim();
    const res = await fetch(API + '/reviews', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome, name, browserId, submissionId, ...(comment ? { comment } : {}), ...(voiceNotes.length ? { voiceNotes } : {}) }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Your answer did not send.');
    store.set('lq-review-name', name);
    say(''); $('form').hidden = true; $('done').hidden = false; window.scrollTo(0, 0);
  } catch (err) {
    say(((err && err.message) || 'No connection.') + ' Your answer is still here; tap Send again.', 'red');
  } finally { $('send').disabled = false; }
});

$('again').addEventListener('click', () => {
  submissionId = rid(); clips.forEach((c) => URL.revokeObjectURL(c.url)); clips = []; drawClips();
  $('done').hidden = true; $('form').hidden = false; showName(store.get('lq-review-name') || '');
});
load();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'microphone=(self)',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}
