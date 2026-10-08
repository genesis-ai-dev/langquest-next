/**
 * `/r/<code>`: the page someone opens from a shared review link
 * (decisions.md 70, links.ts). No account and no app: it plays the version,
 * takes a name (remembered by this browser), looks good or needs changes,
 * and an optional comment and voice note. Built for a phone on a weak
 * connection: one small page, audio streamed card by card, and a voice note
 * recorded as MP4 where the browser can, otherwise as 16 kHz WAV, which is
 * what every phone plays (decision 58).
 */
export function reviewPage(code: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Review · LangQuest</title>
<style>
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --red:#B42318; --green:#1F7A4D; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --red:#FF8A80; --green:#7FD6A4; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { font-size: 24px; margin: 4px 0; } .muted { color: var(--muted); } p { margin: 6px 0; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px; margin: 14px 0; }
label { display:block; font-weight:600; margin: 12px 0 6px; }
input[type=text], textarea { width:100%; min-height:48px; padding: 10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--ink); font:inherit; }
textarea { min-height: 96px; resize: vertical; }
button { min-height:48px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
button.primary { min-height:56px; width:100%; background: var(--primary); border-color: var(--primary); color: #fff; }
button:disabled { opacity: .5; }
.choices { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.choice { min-height: 64px; }
.choice[aria-pressed=true].good { background: var(--green); border-color: var(--green); color: #fff; }
.choice[aria-pressed=true].changes { background: var(--red); border-color: var(--red); color: #fff; }
.play { display:flex; align-items:center; gap: 14px; }
.play button { width: 64px; height: 64px; border-radius: 50%; background: var(--primary); color: #fff; border: 0; font-size: 22px; flex: none; }
progress { width: 100%; height: 8px; accent-color: var(--primary); }
.notice { padding: 12px 14px; border-radius: 10px; background: var(--bg); margin: 10px 0; }
.notice.red { color: var(--red); } .notice.green { color: var(--green); }
.rec { display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
.rec .on { background: var(--red); border-color: var(--red); color: #fff; }
[hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <p class="muted" id="lang"></p>
  <h1 id="title">Loading…</h1>
  <p class="muted" id="ask"></p>
  <div id="out" role="status" aria-live="polite"></div>

  <section id="listen" hidden>
    <div class="play"><button type="button" id="play" aria-label="Play">▶</button><div style="flex:1"><progress id="progress" value="0" max="1"></progress><p class="muted" id="time"></p></div></div>
  </section>

  <form id="form" hidden>
    <section>
      <label for="name">Your name</label>
      <input id="name" type="text" maxlength="80" autocomplete="name" required placeholder="Shown to the translation team">
      <label>How does it sound?</label>
      <div class="choices">
        <button type="button" class="choice good" data-outcome="looks_good" aria-pressed="false">👍 Looks good</button>
        <button type="button" class="choice changes" data-outcome="needs_changes" aria-pressed="false">✋ Needs changes</button>
      </div>
      <label for="comment">Comment <span class="muted">(optional)</span></label>
      <textarea id="comment" maxlength="4000" placeholder="What did you notice?"></textarea>
      <label>Voice note <span class="muted">(optional)</span></label>
      <div class="rec">
        <button type="button" id="rec">🎙 Record</button>
        <audio id="note" controls hidden></audio>
        <button type="button" id="drop" hidden>Remove</button>
      </div>
      <p class="muted" id="rec-status"></p>
    </section>
    <button class="primary" type="submit" id="send">Send</button>
  </form>

  <section id="done" hidden>
    <p class="notice green" id="done-text">Thank you. The team will see your answer.</p>
    <button type="button" id="again">Change my answer</button>
  </section>
</main>
<script>
const CODE = ${JSON.stringify(code)};
const API = '/api/v1/links/' + CODE;
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
let browserId = store.get('lq-review-browser'); if (!browserId) { browserId = rid(); store.set('lq-review-browser', browserId); }
let outcome = null, note = null, submissionId = rid();

function say(text, tone) { const o = $('out'); o.textContent = ''; if (!text) return; const p = document.createElement('p'); p.className = 'notice ' + (tone || ''); p.textContent = text; o.append(p); }
const fmt = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

async function load() {
  let res, data;
  try { res = await fetch(API); data = await res.json(); } catch { $('title').textContent = 'No connection'; say('Check your connection and reload this page.', 'red'); return; }
  if (!res.ok) { $('title').textContent = 'This link does not work'; say(data.error || 'Ask whoever sent it for a new one.', 'red'); return; }
  $('lang').textContent = data.language + (data.passage.path.length ? ' · ' + data.passage.path.join(' · ') : '');
  $('title').textContent = data.passage.label;
  $('ask').textContent = (data.label ? data.label + ' · ' : '') + data.kind.name + (data.kind.description ? ': ' + data.kind.description : '');
  setupPlayer(data.audio);
  if (!data.open) { say('This review link has closed. Ask whoever sent it for a new one.', 'red'); return; }
  $('form').hidden = false;
  $('name').value = store.get('lq-review-name') || '';
}

function setupPlayer(cards) {
  if (!cards.length) return;
  $('listen').hidden = false;
  const total = cards.reduce((t, c) => t + (c.durationMs || 0), 0);
  const audio = new Audio(); audio.preload = 'none';
  let i = 0, before = 0, playing = false;
  const show = () => { const at = before + (audio.currentTime || 0) * 1000; $('progress').value = total ? at / total : 0; $('time').textContent = fmt(at) + (total ? ' / ' + fmt(total) : ''); };
  const start = (n) => { i = n; before = cards.slice(0, n).reduce((t, c) => t + (c.durationMs || 0), 0); audio.src = cards[n].url; audio.play().catch(() => say('Could not play. Tap play again.', 'red')); };
  audio.addEventListener('timeupdate', show);
  audio.addEventListener('ended', () => { if (i + 1 < cards.length) start(i + 1); else { playing = false; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play'); i = 0; before = 0; show(); } });
  audio.addEventListener('error', () => say('The audio link expired or did not load. Reload the page.', 'red'));
  $('play').addEventListener('click', () => {
    if (playing) { audio.pause(); playing = false; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play'); return; }
    playing = true; $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause');
    if (audio.src && audio.currentTime > 0 && !audio.ended) audio.play(); else start(i);
  });
  show();
}

document.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
  outcome = b.dataset.outcome;
  document.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));

// ---- voice note: MP4 where the browser records it, else WAV the phones can play.
let recorder = null, chunks = [], stream = null;
const MP4 = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
$('rec').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { $('rec-status').textContent = 'This browser cannot record. Write a comment instead.'; return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { $('rec-status').textContent = 'The microphone was not allowed. Write a comment instead.'; return; }
  chunks = []; recorder = MP4 ? new MediaRecorder(stream, { mimeType: MP4 }) : new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    recorder = null; $('rec').textContent = '🎙 Record again'; $('rec').classList.remove('on');
    $('rec-status').textContent = 'Preparing…';
    try { note = MP4 ? blob : await toWav(blob); } catch { note = null; $('rec-status').textContent = 'Could not keep that recording. Write a comment instead.'; return; }
    $('note').src = URL.createObjectURL(note); $('note').hidden = false; $('drop').hidden = false;
    $('rec-status').textContent = 'Recorded. It is sent with your answer.';
  };
  recorder.start(); $('rec').textContent = '■ Stop'; $('rec').classList.add('on'); $('rec-status').textContent = 'Recording…';
});
$('drop').addEventListener('click', () => { note = null; $('note').hidden = true; $('drop').hidden = true; $('note').removeAttribute('src'); $('rec').textContent = '🎙 Record'; $('rec-status').textContent = ''; });

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

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) { say('Type your name first.', 'red'); return; }
  if (!outcome) { say('Choose looks good or needs changes.', 'red'); return; }
  $('send').disabled = true; say('Sending…');
  try {
    let voiceNote;
    if (note) {
      const up = await fetch(API + '/voice-note', { method: 'PUT', body: note, headers: { 'content-type': note.type } });
      const body = await up.json();
      if (!up.ok) throw new Error(body.error || 'The voice note did not send.');
      voiceNote = body.voiceNote;
    }
    const comment = $('comment').value.trim();
    const res = await fetch(API + '/reviews', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome, name, browserId, submissionId, ...(comment ? { comment } : {}), ...(voiceNote ? { voiceNote } : {}) }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Your answer did not send.');
    store.set('lq-review-name', name);
    say(''); $('form').hidden = true; $('done').hidden = false;
  } catch (err) {
    say((err && err.message) || 'No connection. Your answer is still here; try Send again.', 'red');
  } finally { $('send').disabled = false; }
});

$('again').addEventListener('click', () => { submissionId = rid(); $('done').hidden = true; $('form').hidden = false; });
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
