import type { UiLanguage } from '@langquest-next/core';
import { fill, languageChoices, pageWords } from './i18n/pages';
import { tutorialFile } from './tutorialVideos';

/**
 * `/videos`: the tutorial videos in the reader's language (decisions.md 187),
 * to play, download, or watch on YouTube. Each is its newest version a
 * person chose to publish on the ops dashboard, the same one its lasting
 * download link gives (`/v/<language>/<tutorial>.mp4`, tutorialVideos.ts), so
 * the page follows the videos by itself. Grouped by who they are for, in the
 * plan's order. Built for a phone on a weak connection: one small page, no
 * video loads until it is played, and a download is the file itself, named
 * for its video and language. Play needs no YouTube, which some countries
 * block. Each channel's description on YouTube links it.
 */

/** One video on the page, as `ops_tutorial_list` gives it. */
export interface PageVideo {
  tutorial: string;
  sha256: string;
  title: string;
  playlist: string;
  seconds: number;
  bytes: number;
  /** Whether a version of it is up on YouTube. */
  youtube: boolean;
}

const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{64}$/;

/** What the database answered, as videos the page can show; anything else is left out. */
export function pageVideos(data: unknown): PageVideo[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((v: Partial<PageVideo>) => (
    v && typeof v.tutorial === 'string' && TUTORIAL.test(v.tutorial) && typeof v.sha256 === 'string' && SHA.test(v.sha256)
      && typeof v.title === 'string' && typeof v.playlist === 'string' && Number.isFinite(v.seconds) && Number.isFinite(v.bytes)
      ? [{ tutorial: v.tutorial, sha256: v.sha256, title: v.title, playlist: v.playlist, seconds: v.seconds!, bytes: v.bytes!, youtube: v.youtube === true }]
      : []));
}

/** The page; `videos` is null when the database could not be asked. */
export function videosPage(language: UiLanguage, videos: PageVideo[] | null): Response {
  const w = pageWords(language, 'videos');
  const info = languageChoices().find((l) => l.code === language)!;
  const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const choices = languageChoices().map((l) => `<option value="${l.code}"${l.code === language ? ' selected' : ''}>${h(l.name)}</option>`).join('');
  const mb = new Intl.NumberFormat(info.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const length = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
  // Play opens the file in the phone's own player, the right way up whether it was filmed on a phone or a window.
  const card = (v: PageVideo) => `<section class="card">
    <h3>${h(v.title)} <span class="muted">${length(v.seconds)}</span></h3>
    <p class="row">
      <a class="button primary" href="${tutorialFile(language, v.tutorial, v.sha256, true)}" download>⬇ ${h(w.download)} · ${h(fill(w.size, { mb: mb.format(v.bytes / 1024 / 1024) }))}</a>
      <a class="button${v.youtube ? '' : ' wide'}" href="${tutorialFile(language, v.tutorial, v.sha256)}">▶ ${h(w.play)}</a>
      ${v.youtube ? `<a class="button" href="/v/${language}/${v.tutorial}">${h(w.youtube)}</a>` : ''}
    </p>
  </section>`;
  const groups = new Map<string, PageVideo[]>();
  for (const v of videos ?? []) groups.set(v.playlist, [...(groups.get(v.playlist) ?? []), v]);
  const list = videos === null
    ? `<p class="notice red">${h(w.failed)}</p>`
    : videos.length === 0
      ? `<p class="notice">${h(w.none)}</p>`
      : [...groups].map(([playlist, vs]) => `<h2>${h(playlist)}</h2>\n  ${vs.map(card).join('\n  ')}`).join('\n  ');
  const html = `<!doctype html>
<html lang="${info.locale}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#6B48C8">
<title>${h(w.pageTitle)}</title>
<style>
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --red:#B42318; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --red:#FF8A80; color-scheme: dark; } }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin:0; background:var(--bg); color:var(--ink); font:18px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 20px 16px calc(32px + env(safe-area-inset-bottom)); }
h1 { font-size: 26px; margin: 2px 0 2px; line-height: 1.2; }
h2 { font-size: 20px; margin: 28px 0 0; color: var(--muted); }
h3 { font-size: 19px; margin: 0 0 10px; line-height: 1.3; }
.muted { color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 18px; margin: 14px 0; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.row .primary, .row .wide { grid-column: 1 / -1; }
h3 .muted { font-weight: 400; font-size: 16px; white-space: nowrap; }
.button { display: flex; align-items: center; justify-content: center; text-align: center; min-height: 48px; padding: 4px 12px; border-radius: 14px; border: 1px solid var(--line); color: var(--ink); background: var(--card); font-weight: 600; text-decoration: none; }
.button.primary { min-height: 56px; background: var(--primary); border-color: var(--primary); color: #fff; }
.notice { padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); margin: 12px 0; }
.notice.red { color: var(--red); }
.pick { text-align: end; margin: 0; } .pick select { font: inherit; font-size: 15px; color: var(--muted); background: none; border: 0; min-height: 48px; }
</style>
</head>
<body>
<main>
  <p class="pick"><label>🌐 <select id="ui-lang" aria-label="${h(w.language)}">${choices}</select></label></p>
  <h1>${h(w.title)}</h1>
  ${list}
</main>
<script>
document.getElementById('ui-lang').addEventListener('change', (e) => { const u = new URL(location.href); u.searchParams.set('lang', e.target.value); location.replace(u); });
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A newly published video shows within five minutes; the page is in the language the browser asks for.
      'cache-control': 'public, max-age=300',
      vary: 'accept-language',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}
