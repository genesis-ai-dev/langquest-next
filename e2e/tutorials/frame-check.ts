// Looks at a new film as someone who pauses it would (decisions.md 192): a
// still while each line is said (the part it lights, the camera in on it),
// and the first and the last, as the video shows them, sent to Gemini in one
// request, which says what is wrong in each: a line or a box's edge left
// outside the lit part or cut through, text cut off or on top of other text,
// a blank, loading or error screen, words not in the video's language. Caleb
// found such frames by hand on 2026-10-30. nightly.ts puts up only a film
// with nothing wrong; the stills that have something wrong stay beside the
// film (check/), with check.json.
//
//   npx tsx e2e/tutorials/frame-check.ts <film folder> <video.mp4> [language]
//
// One request a film, the stills at 1280x720, and only for a film made that
// night: about 15,000 tokens a video (well under a cent with Flash).
// GEMINI_API_KEY is sent when it is set, as in gemini-voice.mjs; what Gemini
// counted goes on a line of TUTORIAL_GEMINI_USAGE, and a refusal only a
// person can fix is said on the ops dashboard (needs-you.mjs).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_LANGUAGES } from '@langquest-next/core';
import { geminiNeedsYou, needsYou } from './needs-you.mjs';

export const CHECK_MODEL = process.env['TUTORIAL_CHECK_MODEL'] ?? 'gemini-flash-latest';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const USAGE = process.env['TUTORIAL_GEMINI_USAGE'] ?? path.join('e2e', 'results', 'tutorials', 'gemini-usage.jsonl');

/** A moment to look at, in seconds into the video, and the line said then ('' for none). */
export interface Still { t: number; says: string }
export interface Checked extends Still { file: string; problems: string[] }
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Where to pause a film (film.ts's film.json): the title at the start, the middle of each line (the part lit,
 * the camera arrived), and the end, which compose.ts makes a second longer than the film.
 */
export function stillsOf(film: { end: number; said: { t: number; seconds: number; words?: string }[] }): Still[] {
  const all = [{ t: 0.5, says: '' }, ...film.said.map((s) => ({ t: s.t + s.seconds / 2, says: s.words ?? '' })), { t: film.end + 0.8, says: '' }];
  return all.filter((s, i) => i === 0 || s.t - all[i - 1]!.t >= 0.3).map((s) => ({ t: Math.round(s.t * 100) / 100, says: s.says }));
}

/** What Gemini is asked, before the stills: the video's title, and its app language by code (fr). */
export function promptOf(title: string, code: string): string {
  const language = UI_LANGUAGES.find((l) => l.code === code)?.english ?? code;
  return [
    `These are stills from a LangQuest tutorial video, "${title}", with the app in ${language}, at the moments a viewer might pause it.`,
    'Each shows the app on a phone (or in a browser window) on a pale page, with the title beside it at the start and the end; in between the camera is zoomed in, so the page, the title and the phone are cut off at the picture\'s edges on purpose.',
    'While the voice talks about a part of the screen, that part has a white and purple ring around it and the rest of the screen is dimmed on purpose. A white ring opening out is a finger\'s tap; a round white dot is a finger held down. The people, teams and languages have made-up names, and Bible text may be in English in every language.',
    'What the team wrote or named in the app is theirs, not the app\'s, and may be in English in every language: role names (Organization Admin, Translator, Coordinator), the names of review steps, templates and reference material, and people\'s questions, notes, reasons and study guides. So may words a language commonly takes from English (Offline, Online, OK, WhatsApp).',
    'When the voice says to open something, the ring may be on the first thing to tap on the way to it (a tab at the bottom).',
    'The ring is lit before the tap, so an option or switch the voice names may or may not be selected yet. A ring around a tab in the bar at the foot of the screen, or around anything else at the screen\'s edge, may run off that edge. A step that lights nothing shows the whole phone, not dimmed and with no ring, with the title beside it; so does a step that lights something tall, or something with mostly empty screen around it (the ring is then around it on the whole phone).',
    'A list scrolls under the bars at the top and foot of the screen, so its words may be cut where they meet a bar. A progress bar may be nearly empty. The app itself draws a thin purple border round the card for the next thing to do, and a purple line down the left of a quoted verse; neither is the ring. While the question mark is on, the app itself dims the screen and puts a number on each part.',
    'Find what a careful viewer would see as a mistake in a still:',
    '- a line, border or edge of a box showing just outside the purple ring, doubled beside it, or cut by it; a ring that cuts through a card, a button or words instead of going around them',
    '- the ring around something other than what the voice names',
    '- words cut off, clipped by an edge, on top of other words, or running out of their box',
    '- a blank screen, a spinner or loading state, an error message, a broken image or a missing icon',
    `- words of the app in another language than ${language} (other than the names, Bible text and the team's words above)`,
    '- anything else drawn wrong: misplaced, duplicated, half drawn, or a glitch.',
    'Say nothing about what is meant to be there (the dimming, the rings, the zoom, the phone\'s frame). Report a mistake only when you can see it; say where it is and what it is, in one short English sentence each.',
    'Return a JSON array with one entry for each still that has a mistake: {"still": <its number>, "problems": [<sentence>, ...]}. Return [] when every still is right.'
  ].join('\n');
}

const schema = {
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: { still: { type: 'INTEGER' }, problems: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['still', 'problems'] }
};

/** Gemini's answer as each still's problems (by still number, from 1); an answer that is not the array asked for throws. */
export function problemsOf(answer: string, count: number): Map<number, string[]> {
  const list = JSON.parse(answer) as unknown;
  if (!Array.isArray(list)) throw new Error(`Gemini's frame check answered ${answer.slice(0, 200)}`);
  const out = new Map<number, string[]>();
  for (const entry of list as { still?: unknown; problems?: unknown }[]) {
    const n = Number(entry.still);
    const problems = Array.isArray(entry.problems) ? entry.problems.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
    if (Number.isInteger(n) && n >= 1 && n <= count && problems.length) out.set(n, [...(out.get(n) ?? []), ...problems]);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The JSON reply to a request, tried again while Gemini is busy; a refusal only a person can fix goes to the ops dashboard. */
async function call(fetcher: Fetch, url: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env['GEMINI_API_KEY']) headers['x-goog-api-key'] = process.env['GEMINI_API_KEY'];
  let lastError = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const text = await res.text();
    lastError = `${res.status} ${text.slice(0, 300)}`;
    const problem = geminiNeedsYou(res.status, text);
    if (problem) needsYou(problem);
    if (problem || (res.status !== 429 && res.status < 500)) break;
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`Gemini's frame check: ${lastError}`);
}

/** A still of the video at t seconds, 1280 wide, as JPEG. */
function grabStill(mp4: string, t: number, file: string): void {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', file]);
}

/**
 * Checks a film's stills: each with what Gemini found wrong in it. The stills with something wrong are kept in
 * <folder>/check/, the rest removed; check.json lists all of them. (A test gives its own fetch, stills and usage file.)
 */
export async function checkFilm(folder: string, mp4: string, language: string, { fetcher = fetch as Fetch, grab = grabStill, usage = USAGE } = {}): Promise<Checked[]> {
  const film = JSON.parse(readFileSync(path.join(folder, 'film.json'), 'utf8')) as { title: string; end: number; said: { t: number; seconds: number; words?: string }[] };
  const dir = path.join(folder, 'check');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const stills = stillsOf(film).map((s, i) => ({ ...s, file: path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`) }));
  for (const s of stills) grab(mp4, s.t, s.file);
  const parts = [{ text: promptOf(film.title, language) }, ...stills.flatMap((s, i) => [
    { text: `Still ${i + 1}, at ${clock(s.t)}.${s.says ? ` The voice says: "${s.says}"` : ''}` },
    { inline_data: { mime_type: 'image/jpeg', data: readFileSync(s.file).toString('base64') } }
  ])];
  const reply = await call(fetcher, `${API}/models/${CHECK_MODEL}:generateContent`, {
    contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema }
  });
  const u = reply.usageMetadata;
  mkdirSync(path.dirname(usage), { recursive: true });
  appendFileSync(usage, `${JSON.stringify({ model: CHECK_MODEL, requests: 1, in: u?.promptTokenCount ?? 0, out: u?.candidatesTokenCount ?? 0, thinking: u?.thoughtsTokenCount ?? 0 })}\n`);
  const answer = (reply.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  const found = problemsOf(answer, stills.length);
  const checked = stills.map((s, i) => ({ ...s, problems: found.get(i + 1) ?? [] }));
  for (const s of checked) if (!s.problems.length) rmSync(s.file, { force: true });
  writeFileSync(path.join(folder, 'check.json'), JSON.stringify({ model: CHECK_MODEL, stills: checked }, null, 1));
  return checked;
}

/** A film's problems as lines for a person: the still's time, the line said then, and what is wrong. */
export const problemLines = (checked: Checked[]) =>
  checked.filter((s) => s.problems.length).map((s) => `${clock(s.t)}${s.says ? ` ("${s.says.length > 60 ? `${s.says.slice(0, 57)}...` : s.says}")` : ''}: ${s.problems.join(' ')}`);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [folder, mp4, language = process.env['TUTORIAL_LANGUAGE'] ?? 'en'] = process.argv.slice(2);
  if (!folder || !mp4) throw new Error('Usage: frame-check.ts <film folder> <video.mp4> [language]');
  const lines = problemLines(await checkFilm(folder, mp4, language));
  console.log(lines.length ? lines.join('\n') : 'Nothing wrong in any still.');
  process.exit(lines.length ? 1 : 0);
}
