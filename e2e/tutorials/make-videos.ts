// Films the tutorial videos and puts each together as an MP4:
// e2e/results/tutorials/<language>/<id>.mp4, a line per video as it is done.
//
//   npm run tutorials                                  every video, in every app language
//   npm run tutorials -- --language es,fr record-a-passage key-words
//   npm run tutorials -- --dry --language ar           each step's picture, no voice or film
//
// It needs what the web UI tests need: local Supabase with the library
// (npm run db:start, then npm run library:seed -- --sources --timings
// library/timings/bsb-fs) and the web export on :8787 (e2e/ui-web.sh). Lines
// and readings not said yet are said by Gemini first (gemini-voice.mjs,
// make-readings.ts); lines not yet translated stop it (translate-lines.ts).
// Films run three at a time (TUTORIAL_AT_ONCE), each with its own addresses
// (TUTORIAL_SLOT). TUTORIAL_REPORT=<file> adds a line of JSON to it for each
// video as it ends ({ language, id, ok }), for nightly.ts.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UI_LANGUAGES } from '@langquest-next/core';
import { serviceClient } from '../ui/people-helpers';
import { TUTORIALS } from './all';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const dry = args.includes('--dry') ? (args.splice(args.indexOf('--dry'), 1), true) : false;
const languages = flag('--language')?.split(',') ?? UI_LANGUAGES.map((l) => l.code);
const ids = args.length ? args : Object.keys(TUTORIALS);
for (const id of ids) if (!TUTORIALS[id]) throw new Error(`No tutorial called ${id}. Known: ${Object.keys(TUTORIALS).join(', ')}`);
const results = path.join('e2e', 'results', 'tutorials');

/** Runs a command to its end, its output kept in log; true when it ends well. */
const run = (command: string, argv: string[], env: Record<string, string>, log: string) =>
  new Promise<boolean>((done) => {
    const child = spawn(command, argv, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => out.push(b));
    child.on('close', (code) => { writeFileSync(log, Buffer.concat(out), { flag: 'a' }); done(code === 0); });
  });

/**
 * Every world is built on the one local stack and named alike, so what a film's world shared with other
 * organizations (a review flow, published study guides) showed in each later world as one more "Riverside
 * Translation Team" row: three copies, after three tries (the frame check held two videos for it). When a film
 * ends, its world's organizations share nothing more. film.ts writes the world it built to world.json.
 */
async function unshareWorld(folder: string, log: string): Promise<void> {
  const file = path.join(folder, 'world.json');
  if (!existsSync(file)) return;
  const world = JSON.parse(readFileSync(file, 'utf8')) as { orgId?: string; org2Id?: string };
  const orgs = [world.orgId, world.org2Id].filter((o): o is string => !!o);
  const { error } = await serviceClient().from('library_items').update({ shared: false }).in('org_id', orgs).eq('shared', true);
  if (error) writeFileSync(log, `Could not stop sharing this world's library: ${error.message}\n`, { flag: 'a' });
}

mkdirSync(results, { recursive: true });
// A dry run needs the readings too: the people in a video's world have recorded them.
// Only those missing or made from something else are made (make-readings.ts).
const readingsLog = path.join(results, 'readings.log');
if (!(await run('npx', ['tsx', path.join('e2e', 'tutorials', 'make-readings.ts'), ...languages], {}, readingsLog))) {
  // Its end says why (Gemini's answer, a line not translated), where a runner's log shows it.
  console.error(readFileSync(readingsLog, 'utf8').split('\n').slice(-40).join('\n'));
  throw new Error(`The readings could not be made: ${readingsLog}`);
}

const queue = languages.flatMap((language) => ids.filter((id) => !TUTORIALS[id]!.notIn?.includes(language)).map((id) => ({ language, id })));
let next = 0;
let failed = 0;
await Promise.all([...Array(Number(process.env['TUTORIAL_AT_ONCE'] ?? 3)).keys()].map(async (slot) => {
  while (next < queue.length) {
    const { language, id } = queue[next++]!;
    const folder = path.join(results, 'films', language, id);
    mkdirSync(folder, { recursive: true });
    const log = path.join(folder, 'log.txt');
    writeFileSync(log, '');
    const env = { TUTORIAL_LANGUAGE: language, TUTORIAL_SLOT: String(slot), TUTORIAL_TTS: 'node e2e/tutorials/gemini-voice.mjs', ...(dry ? { TUTORIAL_DRY: '1' } : {}) };
    const mp4 = path.join(results, language, `${id}.mp4`);
    mkdirSync(path.dirname(mp4), { recursive: true });
    rmSync(path.join(folder, 'world.json'), { force: true });
    const filmed = await run('npx', ['tsx', path.join('e2e', 'tutorials', 'film.ts'), id, folder], env, log);
    await unshareWorld(folder, log);
    const ok = filmed && (dry || (await run('npx', ['tsx', path.join('e2e', 'tutorials', 'compose.ts'), folder, mp4], {}, log)));
    if (!ok) failed++;
    if (process.env['TUTORIAL_REPORT']) appendFileSync(process.env['TUTORIAL_REPORT'], `${JSON.stringify({ language, id, ok })}\n`);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${language} ${id}${ok ? (dry ? '' : ` → ${mp4}`) : ` (${log})`}`);
  }
}));
if (failed) {
  console.error(`${failed} of ${queue.length} did not finish.`);
  process.exit(1);
}
