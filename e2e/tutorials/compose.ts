// Puts a filmed tutorial together (film.json from film.ts) as an MP4: the
// frames on a wide 1920x1080 page, in a phone beside the app's mark and the
// video's title (or, filmed wide, in a browser window under the title), the
// voice's lines where they were said, the speaker's recordings where they were
// spoken and what the app played aloud, both quieter under the voice, evened
// to -16 LUFS. The camera moves in on the part each step lit (camera.ts), so
// the app's words are big enough to read. Never a tall page: YouTube makes a
// tall video under three minutes a Short, whose links cannot be clicked and
// which the channel lists apart from its videos (decisions.md 191).
//
//   npx tsx e2e/tutorials/compose.ts <film folder> <out.mp4>
//
// The page is drawn by Chromium (the same one that films), so a title in any
// app language finds its script in the system's Noto fonts; ffmpeg does the rest.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cameraPath, titleShows, viewExpression, type Focus } from './camera';

type Film = {
  title: string;
  end: number;
  /** The screen's size in points (a film made before the camera moved has none, and no focus: it is shown whole throughout). */
  viewport?: { width: number; height: number };
  focus?: Focus[];
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
const W = 1920;
const H = 1080;
// Where the screen goes on the page, and how big: a window's page scaled from 2560x1600 under its
// title bar, or a phone's screen scaled from 860x1864 inside its bezel, on the right, as tall as the page allows.
const SW = WIDE ? 1472 : 452;
const SH = WIDE ? 920 : 980;
const BAR = 38;
const BEZEL = 16;
const PX = WIDE ? (W - SW) / 2 : 1400 - (SW + 2 * BEZEL) / 2;
const PY = WIDE ? 112 : (H - SH - 2 * BEZEL) / 2;
const SX = WIDE ? PX : PX + BEZEL;
const SY = WIDE ? PY + BAR : PY + BEZEL;
// The camera's moves, from where on the screen each step looked to where that is on the page.
const end = film.end + 1;
const toPage = film.viewport && { x: SW / film.viewport.width, y: SH / film.viewport.height };
const moves = toPage
  ? cameraPath((film.focus ?? []).map((f) => ({
    t: f.t,
    box: f.box && { x: SX + f.box.x * toPage.x, y: SY + f.box.y * toPage.y, width: f.box.width * toPage.x, height: f.box.height * toPage.y },
    rows: f.rows?.map(([a, b]) => [SY + a * toPage.y, SY + b * toPage.y] as [number, number])
  })), end, { width: W, height: H }, { x: SX, y: SY, width: SW, height: SH })
  : [];
// A camera that moves in films a page drawn twice as big, so what it shows close up stays sharp, and
// makes a 1440p video: YouTube makes its sharper versions (VP9) of a video uploaded at 1440p or more.
const K = moves.length ? 2 : 1;
const OUT = K > 1 ? { width: 2560, height: 1440 } : { width: W, height: H };
// Beside the phone: the app's mark and name over the title, as on the channels' banners (banners.ts).
const mark = readFileSync(path.join('apps', 'mobile', 'assets', 'icon.png')).toString('base64');

const INK = 'rgb(30 26 60)';
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: linear-gradient(rgb(244 241 252), rgb(232 227 246)); position: relative;
    font-family: Inter, "Noto Sans", "Noto Sans Ethiopic", "Noto Sans Arabic", "Noto Sans Bengali", "Noto Sans Devanagari",
      "Noto Sans Myanmar", "Noto Sans Thai", "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif; font-weight: 600; }
  h1 { margin: 0; color: ${INK}; }
  .top h1 { position: absolute; left: 48px; right: 48px; top: 30px; text-align: center; font-size: 50px; line-height: 1.2; white-space: nowrap; }
  .side { position: absolute; left: 150px; width: 860px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 40px; }
  .side h1 { font-size: 88px; line-height: 1.12; font-weight: 700; overflow-wrap: break-word; }
  .app { display: flex; align-items: center; gap: 22px; color: rgb(94 86 140); font-size: 44px; font-weight: 700; }
  .app img { width: 76px; height: 76px; border-radius: 18px; }
  .phone { position: absolute; left: ${PX}px; top: ${PY}px; width: ${SW + 2 * BEZEL}px; height: ${SH + 2 * BEZEL}px;
    border-radius: 56px; background: rgb(28 25 46); box-shadow: 0 24px 60px rgb(30 26 60 / 0.25); }
  .window { position: absolute; left: ${PX - 1}px; top: ${PY - 1}px; width: ${SW + 2}px; height: ${BAR + SH + 2}px;
    border-radius: 14px; background: rgb(206 202 222); }
  .bar { position: absolute; left: ${PX}px; top: ${PY}px; width: ${SW}px; height: ${BAR + 14}px;
    border-radius: 13px 13px 0 0; background: rgb(236 233 245); }
  .dot { position: absolute; top: ${PY + BAR / 2 - 6}px; width: 12px; height: 12px; border-radius: 6px; }
</style></head><body class="${WIDE ? 'top' : ''}">
  ${WIDE
    ? '<h1 id="title" dir="auto"></h1>'
    : `<div class="side"><div class="app" dir="ltr"><img src="data:image/png;base64,${mark}" alt="">LangQuest</div><h1 id="title" dir="auto"></h1></div>`}
  ${WIDE
    ? `<div class="window"></div><div class="bar"></div>${['rgb(237 106 94)', 'rgb(245 191 79)', 'rgb(98 197 84)']
      .map((c, i) => `<div class="dot" style="left:${PX + 16 + i * 22}px;background:${c}"></div>`).join('')}`
    : '<div class="phone"></div>'}
</body></html>`;
// Where the screen shows through: the phone's screen rounded, or the window's page with square top corners.
const mask = `<!doctype html><html><body style="margin:0;background:#000;width:${SW}px;height:${SH}px;overflow:hidden">
  <div style="width:${SW}px;height:${SH}px;background:#fff;border-radius:${WIDE ? '0 0 13px 13px' : '40px'}"></div></body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: K });
await tab.setContent(page);
await tab.locator('#title').evaluate((el, title) => {
  el.textContent = title;
  // A long title gets smaller, to fit the page: on one line over a window, on three at most beside a phone.
  // (No function is named in here: what tsx adds to name one is not in the page.)
  let size = parseFloat(getComputedStyle(el).fontSize);
  while ((el.scrollWidth > el.clientWidth || (el.closest('.side') && el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight) > 3.2)) && size > 20) {
    el.style.fontSize = `${(size -= 2)}px`;
  }
}, film.title);
await tab.evaluate(() => document.fonts.ready);
// A camera that moves in fades the title (and the app's mark) out as it goes, so the ends of its words never show at
// the edge of a close shot, and back in whenever it goes out: the title is a picture of its own over the page.
const heading = tab.locator(WIDE ? '#title' : '.side');
const title = K > 1 ? await heading.evaluate((el) => {
  const boxes = (el.id === 'title' ? [el] : [...el.children]).map((c) => c.getBoundingClientRect());
  const [x, y] = [Math.floor(Math.min(...boxes.map((b) => b.left))), Math.floor(Math.min(...boxes.map((b) => b.top)))];
  return { x, y, width: Math.ceil(Math.max(...boxes.map((b) => b.right))) - x, height: Math.ceil(Math.max(...boxes.map((b) => b.bottom))) - y };
}) : undefined;
if (title) await heading.evaluate((el) => { el.style.visibility = 'hidden'; });
await tab.screenshot({ path: path.join(work, 'page.png') });
if (title) {
  await heading.evaluate((el) => {
    el.style.visibility = 'visible';
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    for (const other of document.body.children) if (other !== el) (other as HTMLElement).style.visibility = 'hidden';
  });
  await tab.screenshot({ path: path.join(work, 'title.png'), clip: title, omitBackground: true });
}
await tab.setViewportSize({ width: SW, height: SH });
await tab.setContent(mask);
await tab.screenshot({ path: path.join(work, 'mask.png') });
await browser.close();

// The frames, each shown until the next was drawn.
const list = film.frames.flatMap((f, i) => [`file '${f.file}'`, `duration ${Math.max((film.frames[i + 1]?.t ?? end) - f.t, 0.001).toFixed(4)}`]);
writeFileSync(path.join(work, 'frames.txt'), [...list, `file '${film.frames.at(-1)!.file}'`].join('\n') + '\n');

// The page and the mask as one raw frame each, played over and over 30 times a second: a picture
// read again for every frame (a PNG 3840 wide) took three times as long.
const raw = (png: string, format: string) => {
  const file = png.replace(/\.png$/, '.nut');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-pix_fmt', format, '-c:v', 'rawvideo', '-f', 'nut', file]);
  return ['-stream_loop', '-1', '-r', '30', '-i', file];
};
// A frame of another size (the screencast now and then sends one twice as big) is scaled like the rest, not
// a reason to start the filters again, which put the camera back at the start and cut the video short.
const inputs = ['-reinit_filter', '0', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), ...raw(path.join(work, 'page.png'), 'yuv420p'), ...raw(path.join(work, 'mask.png'), 'gray'),
  ...(title ? raw(path.join(work, 'title.png'), 'yuva420p') : [])];
const chains: string[] = [];
const mix: string[] = [];
let n = title ? 4 : 3;
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
// zoompan crops the view (x, y, and the page's width over the zoom) from the page and scales it to the video's size,
// a frame for each frame it is given.
const view = (side: 'x' | 'y' | 'width') => viewExpression(moves, side, { width: W, height: H });
const camera = K > 1 ? `,zoompan=z='${W}/(${view('width')})':x='${K}*(${view('x')})':y='${K}*(${view('y')})':d=1:s=${OUT.width}x${OUT.height}:fps=30` : '';
// The title goes as the camera moves in and comes back whenever it goes out to the whole page (titleShows), so a
// whole shot in the middle has its title too, not an empty page beside the phone (the frame check found three).
// Each stretch is an overlay of its own, off while it is not seen, so it costs nothing then.
const shows = titleShows(moves, { width: W, height: H });
const titled = title && moves.length
  ? `[3:v]split=${shows.length}${shows.map((_, i) => `[t${i}]`).join('')};` + shows.map((w, i) => {
    const fades = [w.from > 0 ? `fade=t=in:st=${w.from.toFixed(2)}:d=${w.in.toFixed(2)}:alpha=1` : '', w.to !== null ? `fade=t=out:st=${w.to.toFixed(2)}:d=0.5:alpha=1` : ''].filter(Boolean);
    const on = w.to === null ? `gte(t,${w.from.toFixed(2)})` : `between(t,${w.from.toFixed(2)},${(w.to + 0.5).toFixed(2)})`;
    return `[t${i}]${fades.join(',') || 'null'}[f${i}];[${i ? `p${i - 1}` : '1:v'}][f${i}]overlay=${K * title.x}:${K * title.y}:enable='${on}'[${i === shows.length - 1 ? 'page' : `p${i}`}];`;
  }).join('')
  : '';
const video = `${titled}[0:v]fps=30,scale=${K * SW}:${K * SH}:flags=lanczos,format=yuva420p[s];[s][2:v]alphamerge[sm];` +
  `[${titled ? 'page' : '1:v'}][sm]overlay=${K * SX}:${K * SY}:shortest=1:format=yuv420${camera},format=yuv420p[v]`;
const audio = `${chains.join(';')};${mix.join('')}amix=inputs=${mix.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,` +
  `atrim=0:${end.toFixed(2)},afade=t=out:st=${(end - 1.2).toFixed(2)}:d=1.2[a]`;
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${video};${audio}`, '-map', '[v]', '-map', '[a]',
  '-t', end.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`${out} ${end.toFixed(1)} s`);
