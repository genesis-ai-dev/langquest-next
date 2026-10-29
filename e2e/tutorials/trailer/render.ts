// Renders the channel trailer (README.md) for one language from its capture:
// film.html draws every frame from t, Chromium screenshots it, ffmpeg blends
// sub-frames into motion blur and lays the score under it.
//
//   npx tsx e2e/tutorials/trailer/render.ts --lang fr [--sub 4] [--capture <dir>] [--out trailer-fr.mp4]
//   npx tsx e2e/tutorials/trailer/render.ts --lang fr --stills 3,17.8,21.5   (PNGs to look at)
import { chromium, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AS_OF, CLIPS, TRAILER_DIR, TRAILER_WORDS } from './trailer';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const LANG = args.get('lang') ?? process.env['TUTORIAL_LANGUAGE'] ?? 'en';
const here = path.resolve(TRAILER_DIR);
const captureDir = path.resolve(args.get('capture') ?? path.join('e2e', 'results', 'trailer', LANG));
const out = path.resolve(args.get('out') ?? path.join(captureDir, `trailer-${LANG}.mp4`));
const FPS = Number(args.get('fps') ?? 30);
const SUB = Number(args.get('sub') ?? 1);
const SHUTTER = Number(args.get('shutter') ?? 0.5);
const WORKERS = Number(args.get('workers') ?? 3);
const FROM = Number(args.get('from') ?? 0);
const TO = Number(args.get('to') ?? 48);
const CRF = args.get('crf') ?? (SUB > 1 ? '16' : '20');
const PRESET = args.get('preset') ?? (SUB > 1 ? 'slow' : 'veryfast');

const SCRIPT_FONT: Record<string, string> = {
  ar: 'Noto Sans Arabic', am: 'Noto Sans Ethiopic', bn: 'Noto Sans Bengali', hi: 'Noto Sans Devanagari',
  ne: 'Noto Sans Devanagari', th: 'Noto Sans Thai', my: 'Noto Sans Myanmar', 'zh-Hans': 'Noto Sans SC'
};
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const words = TRAILER_WORDS[LANG];
if (!words) throw new Error(`no words for ${LANG} in words.json`);
const capture = JSON.parse(readFileSync(path.join(captureDir, 'capture.json'), 'utf8'));
if (capture.language !== LANG) throw new Error(`${captureDir} holds a ${capture.language} capture`);

// Chromium carries no number or date rules for these languages and writes them as American English. The page
// writes numbers with a locale it has that writes them as the language does (checked in openFilm), and takes the
// date from here.
const NUMBERS: Record<string, string> = { ha: 'en', my: 'en-u-nu-mymr', ne: 'hi-u-nu-deva' };
const DATE = new Intl.DateTimeFormat(LANG, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${AS_OF}T12:00:00Z`));

/** Every character the film writes, so Google Fonts sends only those. */
function filmText(): string {
  const nf = new Intl.NumberFormat(LANG);
  const all = [
    JSON.stringify(words), nf.format(1234567890), new Intl.NumberFormat(LANG, { minimumIntegerDigits: 7 }).format(0), DATE,
    'LangQuest Next langquest.org 0123456789 ,.·/:●–—+ '
  ].join('');
  return [...new Set([...all.replace(/[{}"[\]\\]/g, '')])].join('');
}

/** @font-face rules for the film's three families, the files inlined. */
async function fontCss(): Promise<string> {
  const text = filmText();
  const families: [string, string, string][] = [
    ['Film Sans', 'Inter', 'opsz,wght@32,500;32,600;32,700;32,800'],
    ['Film Mono', 'JetBrains Mono', 'wght@500;700'],
  ];
  const script = SCRIPT_FONT[LANG];
  if (script) families.push(['Film Script', script, 'wght@500;600;700;800']);
  let css = '';
  for (const [as, family, axes] of families) {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${axes}&text=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${family}: ${res.status} from Google Fonts`);
    for (const face of (await res.text()).match(/@font-face\s*{[^}]*}/g) ?? []) {
      const weight = /font-weight:\s*(\d+)/.exec(face)?.[1] ?? '400';
      const src = /url\(([^)]+)\)/.exec(face)?.[1];
      if (!src) continue;
      const file = await fetch(src, { headers: { 'user-agent': UA } });
      if (!file.ok) throw new Error(`${family} ${weight}: ${file.status}`);
      const data = Buffer.from(await file.arrayBuffer()).toString('base64');
      css += `@font-face{font-family:"${as}";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");}\n`;
    }
  }
  return css;
}

const css = await fontCss();
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });

async function openFilm(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.route('http://film.local/**', async (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === '/film.html') return route.fulfill({ path: path.join(here, 'film.html'), contentType: 'text/html' });
    if (p.startsWith('/c/')) return route.fulfill({ path: path.join(captureDir, p.slice(3)), contentType: 'image/jpeg' });
    return route.fulfill({ status: 404 });
  });
  await page.addInitScript((film) => { (window as unknown as { FILM: unknown }).FILM = film; }, {
    lang: LANG, numbers: NUMBERS[LANG] ?? LANG, date: DATE, words, capture, frameBase: 'http://film.local/c/', clips: CLIPS, fontCss: css
  });
  page.on('pageerror', (e) => console.error(`film: ${e.message}`));
  await page.goto('http://film.local/film.html');
  await page.evaluate(() => (window as unknown as { __ready: Promise<unknown> }).__ready);
  const numbers = (locale: string) => [
    new Intl.NumberFormat(locale).format(1234567), new Intl.NumberFormat(locale, { minimumIntegerDigits: 7 }).format(392523),
    new Intl.NumberFormat(locale, { useGrouping: false }).format(2026)
  ].join(' ');
  const there = await page.evaluate(`(${numbers})(${JSON.stringify(NUMBERS[LANG] ?? LANG)})`);
  if (there !== numbers(LANG)) throw new Error(`Chromium writes ${LANG} numbers as "${there}", not "${numbers(LANG)}": add it to NUMBERS`);
  return page;
}
const seek = (page: Page, t: number) => page.evaluate((x) => (window as unknown as { __seek(t: number): Promise<void> }).__seek(x), t);

// ---- stills ----------------------------------------------------------------------------------
if (args.has('stills')) {
  const dir = path.join(captureDir, 'film-stills');
  mkdirSync(dir, { recursive: true });
  const page = await openFilm();
  for (const t of args.get('stills')!.split(',').map(Number)) {
    await seek(page, t);
    await page.screenshot({ path: path.join(dir, `${t.toFixed(2).padStart(5, '0')}.png`) });
  }
  await browser.close();
  console.log(`${LANG}: stills → ${dir}`);
  process.exit(0);
}

// ---- the film --------------------------------------------------------------------------------
// The score: 48 seconds of AAC, laid under the picture as it is.
const score = args.get('score') ?? path.join(here, 'score.m4a');
const frames = Math.round((TO - FROM) * FPS);
const tmp = `${out}.parts`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

function ffmpeg(argv: string[], input?: boolean): ReturnType<typeof spawn> {
  return spawn('ffmpeg', ['-v', 'error', '-y', ...argv], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
}
const done = (p: ReturnType<typeof spawn>) => new Promise<void>((ok, no) => p.on('close', (c) => (c === 0 ? ok() : no(new Error(`ffmpeg exited ${c}`)))));

/** Frames [a, b) to one part, each blended from SUB moments across the shutter. */
async function part(n: number, a: number, b: number): Promise<string> {
  const page = await openFilm();
  const cdp = await page.context().newCDPSession(page);
  const file = path.join(tmp, `${String(n).padStart(2, '0')}.mp4`);
  const blend = SUB > 1 ? [`tmix=frames=${SUB}`, `select='eq(mod(n\\,${SUB})\\,${SUB - 1})'`, `setpts=N/(${FPS}*TB)`] : [`setpts=N/(${FPS}*TB)`];
  const enc = ffmpeg(['-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'mjpeg', '-i', '-',
    '-vf', [...blend, 'format=yuv420p'].join(','), '-r', String(FPS), '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', file], true);
  for (let i = a; i < b; i++) {
    for (let k = 0; k < SUB; k++) {
      const t = FROM + i / FPS + (SUB > 1 ? ((k + 0.5) / SUB - 0.5) * (SHUTTER / FPS) : 0);
      await seek(page, Math.max(0, t));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
      if (!enc.stdin!.write(Buffer.from(shot.data, 'base64'))) await new Promise((r) => enc.stdin!.once('drain', r));
    }
    if (n === 0 && i % 60 === 0) console.log(`${LANG}: ${Math.round((100 * (i - a)) / (b - a))}%`);
  }
  enc.stdin!.end();
  await done(enc);
  await page.close();
  return file;
}

const per = Math.ceil(frames / WORKERS);
const parts = await Promise.all(Array.from({ length: WORKERS }, (_, n) => part(n, n * per, Math.min(frames, (n + 1) * per))));
await browser.close();
writeFileSync(path.join(tmp, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
await done(ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'),
  '-ss', String(FROM), '-t', String(TO - FROM), '-i', path.resolve(score), '-map', '0:v', '-map', '1:a',
  ...(score.endsWith('.m4a') && FROM === 0 ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']), '-shortest',
  '-c:v', 'copy', '-movflags', '+faststart', out]));
rmSync(tmp, { recursive: true, force: true });
console.log(`${LANG}: ${out}`);
