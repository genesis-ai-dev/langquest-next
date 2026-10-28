// Puts a filmed tutorial together (film.json from film.ts) as an MP4: the
// frames in a phone on a 1080x1920 page (or, filmed wide, a browser window on
// a 1920x1080 page) under the video's title, the voice's lines where they were
// said, the speaker's recordings where they were spoken and what the app played
// aloud, both quieter under the voice, evened to -16 LUFS.
//
//   npx tsx e2e/tutorials/compose.ts <film folder> <out.mp4>
//
// The page is drawn by Chromium (the same one that films), so a title in any
// app language finds its script in the system's Noto fonts; ffmpeg does the rest.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Film = {
  title: string;
  end: number;
  frames: { file: string; t: number }[];
  said: { t: number; file: string; seconds: number }[];
  spoken?: { t: number; file: string }[];
  heard?: { t: number; file: string; from: number; to: number }[];
};

const [folder, out] = process.argv.slice(2);
if (!folder || !out) throw new Error('Usage: compose.ts <film folder> <out.mp4>');
const film = JSON.parse(readFileSync(path.join(folder, 'film.json'), 'utf8')) as Film;
const work = path.join(folder, 'compose');
mkdirSync(work, { recursive: true });

const seconds = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const sizeOf = (file: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]).toString().trim().split('x').map(Number);

// A phone's screen is filmed tall; a computer's (what is done on the web) wide.
const [fw, fh] = sizeOf(film.frames[0]!.file) as [number, number];
const WIDE = fw > fh;
const W = WIDE ? 1920 : 1080;
const H = WIDE ? 1080 : 1920;
// Where the screen goes on the page, and how big: a window's page scaled from 2560x1600 under its
// title bar, or a phone's screen scaled from 860x1864 inside its bezel.
const SW = WIDE ? 1472 : 757;
const SH = WIDE ? 920 : 1640;
const BAR = 38;
const BEZEL = 22;
const PX = WIDE ? (W - SW) / 2 : (W - SW - 2 * BEZEL) / 2;
const PY = WIDE ? 112 : 212;
const SX = WIDE ? PX : PX + BEZEL;
const SY = WIDE ? PY + BAR : PY + BEZEL;

const INK = 'rgb(30 26 60)';
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: linear-gradient(rgb(244 241 252), rgb(232 227 246)); position: relative;
    font-family: Inter, "Noto Sans", "Noto Sans Ethiopic", "Noto Sans Arabic", "Noto Sans Bengali", "Noto Sans Devanagari",
      "Noto Sans Myanmar", "Noto Sans Thai", "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif; font-weight: 600; }
  h1 { position: absolute; left: 48px; right: 48px; top: ${WIDE ? 30 : 84}px; margin: 0; text-align: center;
    color: ${INK}; font-size: ${WIDE ? 50 : 58}px; line-height: 1.2; white-space: nowrap; }
  .phone { position: absolute; left: ${PX}px; top: ${PY}px; width: ${SW + 2 * BEZEL}px; height: ${SH + 2 * BEZEL}px;
    border-radius: 72px; background: rgb(28 25 46); }
  .window { position: absolute; left: ${PX - 1}px; top: ${PY - 1}px; width: ${SW + 2}px; height: ${BAR + SH + 2}px;
    border-radius: 14px; background: rgb(206 202 222); }
  .bar { position: absolute; left: ${PX}px; top: ${PY}px; width: ${SW}px; height: ${BAR + 14}px;
    border-radius: 13px 13px 0 0; background: rgb(236 233 245); }
  .dot { position: absolute; top: ${PY + BAR / 2 - 6}px; width: 12px; height: 12px; border-radius: 6px; }
</style></head><body>
  <h1 id="title"></h1>
  ${WIDE
    ? `<div class="window"></div><div class="bar"></div>${['rgb(237 106 94)', 'rgb(245 191 79)', 'rgb(98 197 84)']
      .map((c, i) => `<div class="dot" style="left:${PX + 16 + i * 22}px;background:${c}"></div>`).join('')}`
    : '<div class="phone"></div>'}
</body></html>`;
// Where the screen shows through: the phone's screen rounded, or the window's page with square top corners.
const mask = `<!doctype html><html><body style="margin:0;background:#000;width:${SW}px;height:${SH}px;overflow:hidden">
  <div style="width:${SW}px;height:${SH}px;background:#fff;border-radius:${WIDE ? '0 0 13px 13px' : '52px'}"></div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: H } });
await tab.setContent(page);
await tab.locator('#title').evaluate((el, title) => {
  el.textContent = title;
  // A long title gets smaller, to fit the page.
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > 20) el.style.fontSize = `${(size -= 2)}px`;
}, film.title);
await tab.screenshot({ path: path.join(work, 'page.png') });
await tab.setViewportSize({ width: SW, height: SH });
await tab.setContent(mask);
await tab.screenshot({ path: path.join(work, 'mask.png') });
await browser.close();

// The frames, each shown until the next was drawn.
const end = film.end + 1;
const list = film.frames.flatMap((f, i) => [`file '${f.file}'`, `duration ${Math.max((film.frames[i + 1]?.t ?? end) - f.t, 0.001).toFixed(4)}`]);
writeFileSync(path.join(work, 'frames.txt'), [...list, `file '${film.frames.at(-1)!.file}'`].join('\n') + '\n');

const inputs = ['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-loop', '1', '-i', path.join(work, 'page.png'), '-loop', '1', '-i', path.join(work, 'mask.png')];
const chains: string[] = [];
const mix: string[] = [];
let n = 3;
for (const [i, s] of film.said.entries()) {
  inputs.push('-i', s.file);
  chains.push(`[${n++}:a]aresample=48000,adelay=${Math.round(s.t * 1000)}:all=1[v${i}]`);
  mix.push(`[v${i}]`);
}
/** Quieter while a voice line is said over it (between a and b on the film's clock). */
const duck = (a: number, b: number) =>
  film.said.filter((s) => s.t < b && s.t + s.seconds > a).map((s) => `between(t,${(s.t - 0.15).toFixed(2)},${(s.t + s.seconds + 0.3).toFixed(2)})`).join('+') || '0';
// What the speaker says into the microphone, where they said it.
for (const [j, sp] of (film.spoken ?? []).entries()) {
  const a = sp.t;
  inputs.push('-i', sp.file);
  chains.push(`[${n++}:a]aresample=48000,adelay=${Math.round(a * 1000)}:all=1,volume='if(${duck(a, a + seconds(sp.file))},0.22,0.85)':eval=frame[sp${j}]`);
  mix.push(`[sp${j}]`);
}
// What the app played aloud, from its own audio, where it played it.
for (const [j, h] of (film.heard ?? []).entries()) {
  const a = h.t;
  inputs.push('-i', h.file);
  chains.push(`[${n++}:a]aresample=48000,atrim=${h.from.toFixed(3)}:${h.to.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(a * 1000)}:all=1,volume='if(${duck(a, a + h.to - h.from)},0.22,0.85)':eval=frame[h${j}]`);
  mix.push(`[h${j}]`);
}
const video = `[0:v]fps=30,scale=${SW}:${SH}:flags=lanczos,format=rgba[s];[2:v]format=gray,scale=${SW}:${SH}[m];[s][m]alphamerge[sm];` +
  `[1:v][sm]overlay=${SX}:${SY}:shortest=1,format=yuv420p[v]`;
const audio = `${chains.join(';')};${mix.join('')}amix=inputs=${mix.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,` +
  `atrim=0:${end.toFixed(2)},afade=t=out:st=${(end - 1.2).toFixed(2)}:d=1.2[a]`;
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${video};${audio}`, '-map', '[v]', '-map', '[a]',
  '-t', end.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`${out} ${end.toFixed(1)} s`);
