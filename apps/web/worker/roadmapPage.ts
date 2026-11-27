import type { UiLanguage } from '@langquest-next/core';
import { languageChoices, pageWords } from './i18n/pages';

/**
 * `/roadmap`: what the LangQuest team works on now, plans and considers, and what it finished
 * (docs/roadmap.md, docs/decisions/2026-11-27-a-public-roadmap-that-anyone-can-answer.md). The items are
 * written on the ops dashboard's Roadmap page. A card opens: the reader picks how important it is, and may
 * write what they need and leave an email; Suggest sends a new item the same way. Nothing a reader sends is
 * shown here, and the page names nobody. Built like `/videos`: one small page in the reader's language, no
 * cookies; a picture loads only for a card that has one. What this reader picked stays in their browser, to
 * mark the card.
 */

export type RoadmapState = 'progress' | 'planned' | 'considering' | 'done';

/** One item on the page, as `ops_roadmap_list` gives it. */
export interface RoadmapItem {
  id: string;
  state: RoadmapState;
  title: string;
  body: string;
  /** The picture's version (for its address), or null when the item has none. */
  picture: number | null;
  doneAt: string | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set<RoadmapState>(['progress', 'planned', 'considering', 'done']);
/** The roadmap's three parts, in page order. */
const PARTS = ['progress', 'planned', 'considering'] as const;

/** What the database answered, as items the page can show; anything else is left out. */
export function roadmapItems(data: unknown): RoadmapItem[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((v: Partial<RoadmapItem>) => (
    v && typeof v.id === 'string' && UUID.test(v.id) && STATES.has(v.state as RoadmapState) && typeof v.title === 'string' && v.title
      && typeof v.body === 'string' && (v.picture === null || Number.isSafeInteger(v.picture)) && (v.doneAt === null || typeof v.doneAt === 'string')
      ? [{ id: v.id, state: v.state!, title: v.title, body: v.body, picture: v.picture ?? null, doneAt: v.doneAt ?? null }]
      : []));
}

/** Where an item's picture is: versioned, so it can be kept for a year. */
export const pictureUrl = (item: Pick<RoadmapItem, 'id' | 'picture'>) => `/roadmap/p/${item.id}?v=${item.picture}`;

const ICONS: Record<(typeof PARTS)[number], string> = {
  progress: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  planned: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  considering: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'
};

/** The page; `items` is null when the database could not be asked. */
export function roadmapPage(language: UiLanguage, items: RoadmapItem[] | null): Response {
  const w = pageWords(language, 'roadmap');
  const info = languageChoices().find((l) => l.code === language)!;
  const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const choices = languageChoices().map((l) => `<option value="${l.code}"${l.code === language ? ' selected' : ''}>${h(l.name)}</option>`).join('');
  const date = new Intl.DateTimeFormat(info.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const card = (i: RoadmapItem) => `<button type="button" class="card" data-id="${i.id}" data-state="${i.state}">
      ${i.picture === null ? '' : `<img class="pic" src="${pictureUrl(i)}" alt="" loading="lazy" decoding="async">`}
      <h3>${h(i.title)}</h3>${i.body ? `<p>${h(i.body)}</p>` : ''}<span class="mine" hidden></span>
    </button>`;
  const list = items ?? [];
  const parts = PARTS.map((p) => {
    const mine = list.filter((i) => i.state === p);
    return `<h2 class="part"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[p]}</svg>${h(w[p])}</h2>
    ${mine.length ? `<div class="grid">${mine.map(card).join('')}</div>` : `<p class="muted">${h(w.none)}</p>`}`;
  }).join('\n');
  const done = list.filter((i) => i.state === 'done');
  const doneList = done.length
    ? `<ol class="done">${done.map((i) => `<li><time>${i.doneAt ? h(date.format(new Date(i.doneAt))) : ''}</time><span><b>${h(i.title)}</b>${i.body ? `<br><span class="muted">${h(i.body)}</span>` : ''}</span></li>`).join('')}</ol>`
    : `<p class="muted">${h(w.none)}</p>`;
  const importance = (id: string) => `<div class="imp" role="radiogroup" aria-labelledby="${id}">${[0, 1, 2, 3].map((k) =>
    `<button type="button" role="radio" aria-checked="false" data-k="${k}">${h(w[`imp${k}` as 'imp0'])}</button>`).join('')}</div>`;
  // The words the script shows ride in as one line of JSON (pages.test.ts reads the script without it).
  const words = JSON.stringify({ imp: [w.imp0, w.imp1, w.imp2, w.imp3], sent: w.sent, failed: w.sendFailed, language }).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="${info.locale}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#6B48C8">
<title>${h(w.pageTitle)}</title>
<style>
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --pick:#EDE7FB; --red:#B42318; --green:#1A7F4B; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --pick:#2C2347; --red:#FF8A80; --green:#5CC28C; color-scheme: dark; } }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 16px max(16px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
h1 { font-size: 26px; margin: 0; margin-inline-end: auto; line-height: 1.2; }
.pick select { font: inherit; font-size: 15px; color: var(--muted); background: none; border: 0; min-height: 48px; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 4px 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
.button.primary { min-height: 56px; background: var(--primary); border-color: var(--primary); color: #fff; padding: 4px 22px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 12px 0 4px; }
.tabs button { min-height: 48px; padding: 0 16px; background: none; border: 0; border-bottom: 3px solid transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; }
.tabs button[aria-selected="true"] { color: var(--primary); border-bottom-color: var(--primary); }
.part { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 26px 0 12px; color: var(--muted); font-size: 18px; }
.part::before, .part::after { content: ""; height: 1px; background: var(--line); flex: 1; }
.part svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 16px; }
.card { display: flex; flex-direction: column; text-align: start; padding: 0; overflow: hidden; background: var(--card); color: inherit; font: inherit; border: 1px solid var(--line); border-radius: 20px; cursor: pointer; }
.card:hover, .card:focus-visible { border-color: var(--primary); outline: none; }
.card .pic, dialog .pic { display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover; background: var(--pick); }
.card h3 { font-size: 18px; margin: 16px 18px 6px; line-height: 1.3; }
.card p { margin: 0 18px 16px; color: var(--muted); font-size: 15.5px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.mine { margin: -6px 18px 14px; align-self: flex-start; font-size: 13px; font-weight: 700; color: var(--primary); background: var(--pick); padding: 3px 10px; border-radius: 999px; }
.muted { color: var(--muted); }
.done { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 10px; }
.done li { display: flex; gap: 14px; align-items: baseline; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px 18px; }
.done time { color: var(--muted); font-size: 14px; min-width: 96px; font-variant-numeric: tabular-nums; }
.done .muted { font-size: 15px; white-space: pre-line; }
.notice { padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); margin: 16px 0; color: var(--red); }
dialog { width: min(640px, 100%); max-height: calc(100% - 32px); padding: 0; border: 0; border-radius: 22px; background: var(--card); color: var(--ink); overflow: auto; }
dialog::backdrop { background: rgb(15 10 30 / .45); }
dialog .body { padding: 22px 24px 16px; }
dialog h2 { margin: 0 52px 8px 0; font-size: 23px; line-height: 1.25; }
dialog .text { margin: 0; white-space: pre-line; }
dialog .ask { background: var(--bg); border-top: 1px solid var(--line); padding: 18px 24px 22px; display: grid; gap: 12px; }
dialog .ask h3 { margin: 0; font-size: 16px; }
.x { position: absolute; top: 10px; inset-inline-end: 10px; width: 48px; height: 48px; border-radius: 24px; border: 0; background: var(--bg); color: var(--ink); font-size: 24px; cursor: pointer; }
.imp { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.imp button { min-height: 48px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; padding: 4px 6px; }
.imp button[aria-checked="true"] { background: var(--primary); border-color: var(--primary); color: #fff; }
textarea, input[type=email] { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; font: inherit; font-size: 16px; background: var(--card); color: var(--ink); }
textarea { min-height: 104px; resize: vertical; }
.send { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.send input { flex: 1 1 220px; min-width: 0; min-height: 48px; }
.state { font-weight: 700; } .state.ok { color: var(--green); } .state.bad { color: var(--red); }
.trap { position: absolute; inset-inline-start: -9999px; width: 1px; height: 1px; overflow: hidden; }
.foot { text-align: center; margin: 28px 0 0; } .foot a { display: inline-flex; align-items: center; min-height: 48px; padding: 0 12px; color: var(--muted); }
@media (max-width: 520px) {
  .imp { grid-template-columns: 1fr 1fr; }
  dialog { margin: auto 0 0; width: 100%; max-width: 100%; border-radius: 22px 22px 0 0; }
  dialog .body, dialog .ask { padding-inline: 18px; }
}
</style>
</head>
<body>
<main>
  <div class="top">
    <h1>${h(w.title)}</h1>
    <label class="pick">🌐 <select id="ui-lang" aria-label="${h(w.language)}">${choices}</select></label>
    <button type="button" class="button primary" id="suggest">＋ ${h(w.suggest)}</button>
  </div>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" id="tab-road" aria-selected="true" aria-controls="road">${h(w.title)}</button>
    <button type="button" role="tab" id="tab-done" aria-selected="false" aria-controls="done">${h(w.done)}</button>
  </div>
  ${items === null ? `<p class="notice">${h(w.failed)}</p>` : ''}
  <section id="road" role="tabpanel" aria-labelledby="tab-road">
  ${parts}
  </section>
  <section id="done" role="tabpanel" aria-labelledby="tab-done" hidden>
  ${doneList}
  </section>
  <p class="foot"><a href="/privacy#roadmap">${h(w.privacy)}</a></p>
</main>
<dialog id="item" aria-labelledby="item-title">
  <button type="button" class="x" data-close aria-label="${h(w.close)}">×</button>
  <img class="pic" id="item-pic" alt="" hidden>
  <div class="body"><h2 id="item-title"></h2><p class="text" id="item-text"></p></div>
  <form class="ask" id="item-form">
    <h3 id="item-q">${h(w.question)}</h3>
    ${importance('item-q')}
    <div class="more" hidden>
      <textarea name="words" maxlength="2000" aria-label="${h(w.needs)}" placeholder="${h(w.needs)}"></textarea>
    </div>
    <div class="send more" hidden>
      <input type="email" name="email" maxlength="254" autocomplete="email" aria-label="${h(w.email)}" placeholder="✉ ${h(w.email)}">
      <span class="state" role="status"></span>
      <button type="submit" class="button primary">${h(w.send)}</button>
    </div>
    <input class="trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  </form>
</dialog>
<dialog id="idea" aria-labelledby="idea-title">
  <button type="button" class="x" data-close aria-label="${h(w.close)}">×</button>
  <div class="body"><h2 id="idea-title">${h(w.suggest)}</h2></div>
  <form class="ask" id="idea-form">
    <textarea name="words" maxlength="2000" required aria-label="${h(w.idea)}" placeholder="${h(w.idea)}"></textarea>
    <h3 id="idea-q">${h(w.question)}</h3>
    ${importance('idea-q')}
    <div class="send">
      <input type="email" name="email" maxlength="254" autocomplete="email" aria-label="${h(w.email)}" placeholder="✉ ${h(w.email)}">
      <span class="state" role="status"></span>
      <button type="submit" class="button primary">${h(w.send)}</button>
    </div>
    <input class="trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  </form>
</dialog>
<script>
const W = ${words};
const $ = (id) => document.getElementById(id);
const KEY = 'roadmap-picks';
let picks = {};
try { picks = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
function markCards() {
  for (const c of document.querySelectorAll('.card')) {
    const k = picks[c.dataset.id];
    const m = c.querySelector('.mine');
    m.hidden = typeof k !== 'number';
    if (!m.hidden) m.textContent = '✓ ' + W.imp[k];
  }
}
function setTab(road) {
  $('tab-road').setAttribute('aria-selected', String(road)); $('tab-done').setAttribute('aria-selected', String(!road));
  $('road').hidden = !road; $('done').hidden = road;
}
$('tab-road').addEventListener('click', () => setTab(true));
$('tab-done').addEventListener('click', () => setTab(false));
$('ui-lang').addEventListener('change', (e) => { const u = new URL(location.href); u.searchParams.set('lang', e.target.value); location.replace(u); });
function reset(form, k) {
  form.reset();
  for (const b of form.querySelectorAll('[data-k]')) b.setAttribute('aria-checked', String(Number(b.dataset.k) === k));
  for (const m of form.querySelectorAll('.more')) m.hidden = typeof k !== 'number';
  const s = form.querySelector('.state'); s.textContent = ''; s.classList.remove('ok', 'bad');
  form.querySelector('[type=submit]').disabled = false;
}
let open = null;
function openItem(card) {
  open = card.dataset.id;
  const pic = card.querySelector('.pic');
  $('item-pic').hidden = !pic;
  if (pic) $('item-pic').src = pic.src;
  $('item-title').textContent = card.querySelector('h3').textContent;
  const p = card.querySelector('p');
  $('item-text').textContent = p ? p.textContent : '';
  reset($('item-form'), picks[open]);
  $('item').showModal();
}
document.addEventListener('click', (e) => {
  const card = e.target.closest && e.target.closest('.card');
  if (card) return openItem(card);
  const k = e.target.closest && e.target.closest('[data-k]');
  if (k) {
    const form = k.closest('form');
    for (const b of form.querySelectorAll('[data-k]')) b.setAttribute('aria-checked', String(b === k));
    for (const m of form.querySelectorAll('.more')) m.hidden = false;
    return;
  }
  const close = e.target.closest && e.target.closest('[data-close]');
  if (close) return close.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') e.target.close();
});
$('suggest').addEventListener('click', () => { reset($('idea-form'), undefined); $('idea').showModal(); });
async function send(form, item) {
  const chosen = form.querySelector('[aria-checked="true"]');
  const words = form.elements.words.value.trim();
  if (!chosen || (!item && !words)) return;
  const s = form.querySelector('.state');
  const button = form.querySelector('[type=submit]');
  button.disabled = true; s.textContent = ''; s.classList.remove('ok', 'bad');
  const k = Number(chosen.dataset.k);
  try {
    const r = await fetch('/roadmap/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      item, importance: k, words, email: form.elements.email.value.trim(), website: form.elements.website.value, language: W.language }) });
    if (!r.ok) throw new Error(String(r.status));
    s.textContent = '✓ ' + W.sent; s.classList.add('ok');
    if (item) { picks[item] = k; try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch {} markCards(); }
  } catch {
    s.textContent = W.failed; s.classList.add('bad'); button.disabled = false;
  }
}
$('item-form').addEventListener('submit', (e) => { e.preventDefault(); send(e.target, open); });
$('idea-form').addEventListener('submit', (e) => { e.preventDefault(); send(e.target, null); });
markCards();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A change on the dashboard shows within five minutes; the page is in the language the browser asks for.
      'cache-control': 'public, max-age=300',
      vary: 'accept-language',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}
