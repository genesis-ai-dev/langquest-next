// Looks at a new film as someone who pauses it would (decisions.md 192): a
// still while each line is said (the part it lights, the camera in on it),
// and the first and the last, as the video shows them, shown to Claude
// together, which says what is wrong in each: a line or a box's edge left
// outside the lit part or cut through, text cut off or on top of other text,
// a blank, loading or error screen, words not in the video's language, a
// heading that does not agree with what the voice says. Caleb found such
// frames by hand on 2026-10-30. nightly.ts puts up only a film with nothing
// wrong; the stills that have something wrong stay beside the film (check/),
// with check.json.
//
//   npx tsx e2e/tutorials/frame-check.ts <film folder> <video.mp4> [language]
//
// Claude Code looks, as Sonnet (TUTORIAL_CHECK_MODEL) thinking at high
// effort (TUTORIAL_CHECK_EFFORT), with no tools, signed in with the Claude
// plan's token that the nightly look at the videos' feedback uses
// (CLAUDE_CODE_OAUTH_TOKEN, tutorial-review.yml): it counts against the
// plan's limits and is not billed. Gemini looked until 2026-11-01, at its
// full price, thinking as many tokens as it was sent: about US$175 of the
// US$230 Google charged for the week the spotlight and ring were filmed
// again in every language. One look a film, the stills 1280 wide. What
// Claude counted, and what it would cost at the API's list price, goes on a
// line of TUTORIAL_GEMINI_USAGE beside Gemini's (gemini-usage.mjs), and a
// token Claude refuses is said on the ops dashboard (needs-you.mjs).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_LANGUAGES } from '@langquest-next/core';
import { claudeNeedsYou, needsYou } from './needs-you.mjs';

export const CHECK_MODEL = process.env['TUTORIAL_CHECK_MODEL'] ?? 'sonnet';
const EFFORT = process.env['TUTORIAL_CHECK_EFFORT'] ?? 'high';
const USAGE = process.env['TUTORIAL_GEMINI_USAGE'] ?? path.join('e2e', 'results', 'tutorials', 'gemini-usage.jsonl');

/** A moment to look at, in seconds into the video, and the line said then ('' for none). */
export interface Still { t: number; says: string }
export interface Checked extends Still { file: string; problems: string[] }
/** One look: Claude Code given the message (a line of stream-json), and what it printed (stream-json lines). */
export type Look = (message: string) => Promise<string>;

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Where to pause a film (film.ts's film.json): the title at the start, the middle of each line (the part lit,
 * the camera arrived), and the end, which compose.ts makes a second longer than the film.
 */
export function stillsOf(film: { end: number; said: { t: number; seconds: number; words?: string }[] }): Still[] {
  const all = [{ t: 0.5, says: '' }, ...film.said.map((s) => ({ t: s.t + s.seconds / 2, says: s.words ?? '' })), { t: film.end + 0.8, says: '' }];
  return all.filter((s, i) => i === 0 || s.t - all[i - 1]!.t >= 0.3).map((s) => ({ t: Math.round(s.t * 100) / 100, says: s.says }));
}

/** What Claude is asked, before the stills: the video's title, and its app language by code (fr). */
export function promptOf(title: string, code: string): string {
  const language = UI_LANGUAGES.find((l) => l.code === code)?.english ?? code;
  return [
    `These are stills from a LangQuest tutorial video, "${title}", with the app in ${language}, at the moments a viewer might pause it.`,
    'Each shows the app on a phone (or in a browser window) on a pale page, with the title beside it at the start and the end; in between the camera is zoomed in, so the page, the title and the phone are cut off at the picture\'s edges on purpose.',
    'While the voice talks about a part of the screen, the rest of the screen is dimmed on purpose and that part stays bright: the bright area is the part\'s own button or card, or a little round words or an icon. A white ring opening out is a finger\'s tap; a round white dot is a finger held down. The people, teams and languages have made-up names, and Bible text may be in English in every language, as may the names of books and passages taken from it.',
    'What the team wrote or named in the app is theirs, not the app\'s, and may be in English in every language: role names (Organization Admin, Translator, Coordinator), the names of review steps, templates and reference material, and people\'s questions, notes, reasons and study guides. So may words a language commonly takes from English (Offline, Online, OK, WhatsApp).',
    'When the voice says to open something, the bright part may be the first thing to tap on the way to it (a tab at the bottom).',
    'The part is lit before the tap, so an option or switch the voice names may or may not be selected yet. A step that lights nothing shows the whole phone, not dimmed, with the title beside it; so does a step that lights something tall, or something with mostly empty screen around it (it is then lit on the whole phone).',
    'A list scrolls under the bars at the top and foot of the screen, so its words may be cut where they meet a bar. A progress bar may be nearly empty. The round sync mark at the top right may turn while the app syncs. A small green round check (or a spinner) beside a header\'s question mark is the saved mark: what is being written or recorded there is kept as it is made. The app itself draws a thin purple border round the card for the next thing to do, and a purple line down the left of a quoted verse. While the question mark is on, the app itself dims the screen and puts a number on each part.',
    'A passage\'s row of small round marks has one mark for each check: a green tick is done, an amber speech bubble is feedback waiting, a clock is asked of someone, an empty ring is not started, a lock is not open yet, and a grey mark with a skip-forward sign (two small arrowheads and a bar) is a check set aside. Recording is not a check and has no mark: the first mark is the first review check, so a recorded passage can show only empty rings.',
    'The red recording panel\'s clock counts all the time it listened; a part kept from it is the voice alone, with the silence before and after cut off, so the part can be a few seconds shorter than the clock said. On a passage\'s page, the Record step\'s "Version 1 · 0:48" (its version and length) is the passage\'s own recording, not a back translation or anything recorded since.',
    'Read each heading, number and label in a still, and check that it agrees with what the voice says then (the part, verse, step or person it names) and with the still before it.',
    'Find what a careful viewer would see as a mistake in a still:',
    '- a bright area whose edge cuts through words, a button, a field or an icon (part of it bright and part dimmed); lighting some rows or part of a bigger card, list or sheet is meant',
    '- a bright area on something other than what the voice names, or leaving out part of it',
    '- a heading, number or label that does not agree with what the voice says',
    '- words cut off, clipped by an edge, on top of other words, or running out of their box',
    '- a blank screen, a spinner or loading state, an error message, a broken image or a missing icon',
    `- words of the app in another language than ${language} (other than the names, Bible text and the team's words above)`,
    '- anything else drawn wrong: misplaced, duplicated, half drawn, or a glitch.',
    'Say nothing about what is meant to be there (the dimming, the bright part, the taps, the zoom, the phone\'s frame). Report a mistake only when you can see it; say where it is and what it is, in one short English sentence each.',
    'Answer with {"stills": [...]}: one entry for each still that has a mistake, {"still": <its number>, "problems": [<sentence>, ...]}. "stills" is empty when every still is right.'
  ].join('\n');
}

const schema = {
  type: 'object',
  properties: {
    stills: { type: 'array', items: { type: 'object', properties: { still: { type: 'integer' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['still', 'problems'] } }
  },
  required: ['stills']
};

/** Claude's answer as each still's problems (by still number, from 1); an answer that is not what was asked for throws. */
export function problemsOf(answer: unknown, count: number): Map<number, string[]> {
  let value = answer;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.replace(/^\s*```(?:json)?|```\s*$/g, ''));
    } catch {
      value = undefined;
    }
  }
  const list = Array.isArray(value) ? value : (value as { stills?: unknown } | undefined)?.stills;
  if (!Array.isArray(list)) throw new Error(`Claude's frame check answered ${(typeof answer === 'string' ? answer : JSON.stringify(answer) ?? '').slice(0, 200)}`);
  const out = new Map<number, string[]>();
  for (const entry of list as { still?: unknown; problems?: unknown }[]) {
    const n = Number(entry.still);
    const problems = Array.isArray(entry.problems) ? entry.problems.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
    if (Number.isInteger(n) && n >= 1 && n <= count && problems.length) out.set(n, [...(out.get(n) ?? []), ...problems]);
  }
  return out;
}

/** Claude Code with nothing but the stills: no tools, no settings, no MCP servers, no CLAUDE.md (it runs in the temp folder). */
function claudeLooks(message: string): Promise<string> {
  const args = [
    '-p', '--model', CHECK_MODEL, ...(EFFORT ? ['--effort', EFFORT] : []),
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
    '--system-prompt', 'You check stills from app tutorial videos for mistakes a viewer would see.',
    '--json-schema', JSON.stringify(schema)
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (out.includes('"type":"result"')) resolve(out);
      else reject(new Error(`Claude Code ended (${code}) without an answer: ${(err || out).trim().slice(-300)}`));
    });
    child.stdin.end(message);
  });
}

interface Used { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; thinkingTokens?: number; costUSD?: number }
interface Result { is_error?: boolean; subtype?: string; result?: string; api_error_status?: number | null; structured_output?: unknown; total_cost_usd?: number; modelUsage?: Record<string, Used> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Claude Code's answer to one look, tried again while Claude is busy (a 429, 5xx or 529 that is not the plan's
 * usage limit). A token Claude refuses goes to the ops dashboard; Claude Code not installed says so.
 */
async function answerOf(look: Look, message: string, wait: number): Promise<Result> {
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    let result: Result | undefined;
    try {
      const lines = (await look(message)).split('\n').filter((l) => l.startsWith('{'));
      result = lines.map((l) => JSON.parse(l) as Result & { type?: string }).reverse().find((l) => l.type === 'result');
      if (!result) last = 'no answer';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error("Claude's frame check: Claude Code is not installed (npm install -g @anthropic-ai/claude-code)");
      last = error instanceof Error ? error.message : String(error);
    }
    if (result && !result.is_error && result.subtype === 'success') return result;
    if (result) last = `${result.api_error_status ?? result.subtype ?? 'error'} ${String(result.result ?? '').slice(0, 300)}`;
    const problem = claudeNeedsYou(last);
    if (problem) {
      needsYou(problem);
      break;
    }
    const busy = /\b(429|5\d\d)\b|overloaded|rate.?limit|timed? ?out|ECONNRESET|without an answer/i.test(last) && !/usage limit/i.test(last);
    if (!busy) break;
    if (attempt < 4) await sleep(wait * 2 ** attempt);
  }
  throw new Error(`Claude's frame check: ${last}`);
}

/** A still of the video at t seconds, 1280 wide, as JPEG. */
function grabStill(mp4: string, t: number, file: string): void {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', file]);
}

/**
 * Checks a film's stills: each with what Claude found wrong in it. The stills with something wrong are kept in
 * <folder>/check/, the rest removed; check.json lists all of them. (A test gives its own look, stills, usage file
 * and wait between tries.)
 */
export async function checkFilm(
  folder: string,
  mp4: string,
  language: string,
  { look = claudeLooks as Look, grab = grabStill, usage = USAGE, wait = 7_500 }: { look?: Look; grab?: (mp4: string, t: number, file: string) => void; usage?: string; wait?: number } = {}
): Promise<Checked[]> {
  const film = JSON.parse(readFileSync(path.join(folder, 'film.json'), 'utf8')) as { title: string; end: number; said: { t: number; seconds: number; words?: string }[] };
  const dir = path.join(folder, 'check');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const stills = stillsOf(film).map((s, i) => ({ ...s, file: path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`) }));
  for (const s of stills) grab(mp4, s.t, s.file);
  const content = [{ type: 'text', text: promptOf(film.title, language) }, ...stills.flatMap((s, i) => [
    { type: 'text', text: `Still ${i + 1}, at ${clock(s.t)}.${s.says ? ` The voice says: "${s.says}"` : ''}` },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(s.file).toString('base64') } }
  ])];
  const result = await answerOf(look, `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`, wait);
  // The model that answered (Claude Code also asks a small model for a title); the tokens and price of both.
  const models = Object.entries(result.modelUsage ?? {});
  const model = models.reduce<[string, Used] | undefined>((a, b) => (!a || (b[1].costUSD ?? 0) > (a[1].costUSD ?? 0) ? b : a), undefined)?.[0] ?? CHECK_MODEL;
  const sum = (k: keyof Used) => models.reduce((n, [, u]) => n + (u[k] ?? 0), 0);
  mkdirSync(path.dirname(usage), { recursive: true });
  appendFileSync(usage, `${JSON.stringify({
    model, plan: true, requests: 1,
    in: sum('inputTokens') + sum('cacheReadInputTokens') + sum('cacheCreationInputTokens'),
    out: sum('outputTokens'), thinking: sum('thinkingTokens'), usd: result.total_cost_usd ?? sum('costUSD')
  })}\n`);
  const found = problemsOf(result.structured_output ?? result.result ?? '', stills.length);
  const checked = stills.map((s, i) => ({ ...s, problems: found.get(i + 1) ?? [] }));
  for (const s of checked) if (!s.problems.length) rmSync(s.file, { force: true });
  writeFileSync(path.join(folder, 'check.json'), JSON.stringify({ model, stills: checked }, null, 1));
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
