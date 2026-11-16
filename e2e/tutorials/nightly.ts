// The nightly filming of one app language (docs/tutorial-videos.md,
// .github/workflows/tutorials.yml): every video is tried first without voice
// or film (--dry), its screens' words are compared with those of the film
// the release keeps (look.ts), and only the videos that look different, or
// have no film yet, are filmed again, as is every film framed or described
// as films no longer are (playlists.ts FRAME). What the release should hold
// afterwards goes into <out>: each new film under its release name, and the
// language's manifest (server/tutorialIntakeModel.ts), which keeps the films
// that did not change. The intake job brings the new ones into R2 for Publish.
// Each new film is first looked at as someone who pauses it would
// (frame-check.ts): one with something wrong keeps its last film, and what is
// wrong goes on the run's summary.
// A video is filmed again too when its script changed (what it says, does or
// lights), and each film keeps why it was made and the commit it was filmed
// from (why.ts); the changes merged since then that touched a screen it shows
// slot it, and the night says whether its words changed. Every video's state
// goes into <out>/status-<language>.json, for the release and the chart.
// The channel's trailer (trailer/README.md) goes the same way: its screens
// captured, and the film made again when its look changed.
//
//   npx tsx e2e/tutorials/nightly.ts --language fr --release <dir> --out <dir> [video ...]
//
// Videos named are filmed whatever their look ("trailer" for the trailer;
// naming only others leaves it as it was). <dir> holds the release's
// manifest-fr.json when there is one. Needs what make-videos.ts needs. Exits
// 1 when a video could not be tried, filmed or passed by the frame check; the
// rest still go out, and a video that failed keeps its last film.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { filmName, manifestName, readManifest, type Film } from '../../server/tutorialIntakeModel';
import { TRAILER, type ChannelLanguage } from '../../server/youtube';
import { GROUPS, TUTORIALS } from './all';
import { checkFilm, problemLines } from './frame-check';
import { lookOf, stepLooks, tryAgain } from './look';
import { firstSentence, FRAME, PLAYLISTS, TRAILER_FRAME, youtubeText } from './playlists';
import { importsOf, screenCode, stepScreens, type ScreenCode } from './screens';
import { TRAILER_DIR, trailerLook, trailerText } from './trailer/trailer';
import { causeLine, readLog, scriptOf, slotsOf, whyFilm, type Cause, type Change, type Slot } from './why';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const language = flag('--language') as ChannelLanguage | undefined;
const releaseDir = flag('--release');
const outDir = flag('--out');
if (!language || !releaseDir || !outDir || !PLAYLISTS[language]) {
  console.error('usage: npx tsx e2e/tutorials/nightly.ts --language <app language> --release <dir> --out <dir> [video ...]');
  process.exit(2);
}
// Videos named by hand are filmed whether or not they look changed: what the look cannot see (a sound, a colour).
const named = args.length > 0;
const trailerNamed = args.includes(TRAILER);
// The public's videos only: one for LangQuest staff is filmed by hand (make-videos.ts), never for YouTube.
const ids = (named ? args.filter((id) => id !== TRAILER) : Object.keys(TUTORIALS)).filter((id) => !TUTORIALS[id]?.staff && !TUTORIALS[id]?.notIn?.includes(language));
for (const id of ids) if (!TUTORIALS[id]) throw new Error(`No tutorial called ${id}`);
const results = path.join('e2e', 'results', 'tutorials');
mkdirSync(outDir, { recursive: true });
const linesFile = path.join('e2e', 'tutorials', 'lines', `${language}.json`);
const lines = language === 'en' || !existsSync(linesFile) ? {} : JSON.parse(readFileSync(linesFile, 'utf8')) as Record<string, string>;
const say = (english: string) => (language === 'en' ? english : lines[english] ?? english);

// What each video is filmed from tonight: the commit, its script, and the code that draws its screens (why.ts).
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
let head: string | undefined;
try {
  head = git('rev-parse', 'HEAD').trim();
} catch {
  console.log(`${language}: not in a git checkout; films keep no commit and nothing is slotted`);
}
const logs = new Map<string, Change[] | null>();
/** The changes merged into main since a commit, newest first; null when this history does not have it. */
function changesSince(commit: string | undefined): Change[] | null {
  if (!head || !commit || !/^[0-9a-f]{40}$/.test(commit)) return null;
  if (commit === head) return [];
  if (!logs.has(commit)) {
    const known = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD']).status === 0;
    logs.set(commit, known ? readLog(git('log', '--first-parent', '--diff-merges=first-parent', '--name-only', '--format=%x00%H%x09%s', `${commit}..HEAD`)) : null);
  }
  return logs.get(commit)!;
}
let code: ScreenCode = { own: new Map(), shared: new Set() };
try {
  code = screenCode({ read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null) });
} catch (error) {
  console.log(`${language}: the screens' code could not be read (${String(error)}); nothing is slotted`);
}
const scriptFile = (id: string) => path.join('e2e', 'tutorials', `${id}.ts`);
const scriptSource = (id: string) => (existsSync(scriptFile(id)) ? readFileSync(scriptFile(id), 'utf8') : '');
/** A video's script tonight, in this language (why.ts `scriptOf`). */
const scriptNow = (id: string) => scriptOf(scriptSource(id), TUTORIALS[id]!.steps.map((s) => (s.say ? say(s.say) : undefined)), TUTORIALS[id]!.speech ?? []);
/** Its own files, and the helpers in this folder it imports: where a change to its script is found. */
const scriptFiles = (id: string) => new Set([
  `e2e/tutorials/${id}.ts`, `e2e/tutorials/lines/${language}.json`,
  ...importsOf(scriptSource(id)).filter((i) => /^\.\/[\w-]+$/.test(i) && i !== './tutorial').map((i) => `e2e/tutorials/${i.slice(2)}.ts`)
]);

const manifestFile = path.join(releaseDir, manifestName(language));
// A video taken out of all.ts, out of this language, or for staff leaves the manifest; the trailer stays.
const kept = new Map<string, Film>(
  (existsSync(manifestFile) ? readManifest(language, JSON.parse(readFileSync(manifestFile, 'utf8'))).films : [])
    .filter((f) => f.tutorial === TRAILER || (TUTORIALS[f.tutorial] && !TUTORIALS[f.tutorial]!.staff && !TUTORIALS[f.tutorial]!.notIn?.includes(language)))
    .map((f) => [f.tutorial, f])
);

// The commit each video was last checked or filmed at: the changes merged since then slot it (why.ts).
const lastCheck = new Map([...kept].map(([id, f]) => [id, f.checked?.commit ?? f.commit]));

/** make-videos.ts for these videos; which ended well. `alone`: one video at a time. */
function makeVideos(videos: string[], dry: boolean, alone = dry): Set<string> {
  const report = path.join(results, `nightly-${language}-${dry ? 'dry' : 'film'}.jsonl`);
  rmSync(report, { force: true });
  spawnSync('npx', ['tsx', path.join('e2e', 'tutorials', 'make-videos.ts'), ...(dry ? ['--dry'] : []), '--language', language!, ...videos], {
    stdio: 'inherit',
    // A dry run one video at a time: two films at once share the database, and each would see the other's work.
    env: { ...process.env, TUTORIAL_REPORT: report, TUTORIAL_AT_ONCE: alone ? '1' : process.env['TUTORIAL_AT_ONCE'] ?? '2' }
  });
  const lines = existsSync(report) ? readFileSync(report, 'utf8').split('\n').filter(Boolean) : [];
  return new Set(lines.map((l) => JSON.parse(l) as { id: string; ok: boolean }).filter((r) => r.ok).map((r) => r.id));
}

const stepsOf = (id: string) => {
  const dir = path.join(results, 'films', language, id, 'steps');
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(path.join(dir, f), 'utf8'));
};

// make-videos.ts with no video named makes them all: when only the trailer is named, none is tried.
const tried = ids.length ? makeVideos(ids, true) : new Set<string>();
// A dry run that failed is tried once more, as a film is below: the local stack now and then answers
// a call with an error under load (save_profile: "An invalid response was received from the upstream server").
const untried = ids.filter((id) => !tried.has(id));
if (untried.length) {
  console.log(`${language}: ${untried.length} failed, tried once more: ${untried.join(' ')}`);
  for (const id of makeVideos(untried, true)) tried.add(id);
}
const looks = new Map([...tried].map((id) => [id, lookOf(stepsOf(id), language)]));
const scripts = new Map(ids.map((id) => [id, scriptNow(id)]));
// A film framed as films no longer are (FRAME) is made again whatever its look: no need to try it twice.
const stale = (id: string) => kept.has(id) && kept.get(id)!.frame !== FRAME;
// A video that looks changed is tried again, at most twice (look.ts tryAgain).
const seen = new Map([...looks].map(([id, look]) => [id, [look]]));
const unsure = () => (named ? [] : [...seen].filter(([id, tries]) => !stale(id) && tryAgain(tries, kept.get(id)?.look)).map(([id]) => id));
let triedAgain = 0;
for (let again = unsure(); again.length; again = unsure()) {
  triedAgain += again.length;
  const ok = makeVideos(again, true);
  for (const id of again) {
    if (ok.has(id)) seen.get(id)!.push(lookOf(stepsOf(id), language));
    else seen.delete(id);
  }
}
for (const [id, tries] of seen) looks.set(id, tries[tries.length - 1]!);
// Each step's look, from the last try (the one its look is from).
const steps = new Map([...looks.keys()].map((id) => [id, stepLooks(stepsOf(id), language)]));
// Why each video is filmed (why.ts): no film, named, framed as films no longer are, its script, its words on a screen.
const why = new Map<string, Cause[]>();
for (const id of ids) {
  if (!looks.has(id)) continue;
  const film = kept.get(id);
  const causes = whyFilm({
    ...(film ? { film } : {}), named, frame: FRAME, tried: { look: looks.get(id)!, steps: steps.get(id)! }, script: scripts.get(id)!,
    screens: stepScreens(TUTORIALS[id]!), scriptFiles: scriptFiles(id), changes: changesSince(film?.commit), code
  });
  if (causes.length) why.set(id, causes);
}
const changed = ids.filter((id) => why.has(id));
console.log(`${language}: ${tried.size} of ${ids.length} tried (${triedAgain} tries again), ${changed.length} to film: ${changed.join(' ') || 'none'}`);
for (const id of changed) console.log(`${language}: ${id}: ${why.get(id)!.map(causeLine).join('; ')}`);

const filmed = changed.length ? makeVideos(changed, false) : new Set<string>();
// A film that failed although its dry run passed is filmed once more, alone: two films at once share the
// stack, and a slow answer or a screen drawn again under a tap fails one now and then.
const missed = changed.filter((id) => !filmed.has(id));
if (missed.length) {
  console.log(`${language}: ${missed.length} to film again, alone: ${missed.join(' ')}`);
  for (const id of makeVideos(missed, false, true)) filmed.add(id);
}
// Each new film's stills looked at, two films at a time (frame-check.ts): five languages film at once, on one
// Claude plan. A film with something wrong, or one that could not be looked at, is held: it is not put up, and the
// video keeps its last film until a night's is right.
const held = new Map<string, string[]>();
const toCheck = [...filmed];
await Promise.all([0, 1].map(async () => {
  for (let id = toCheck.shift(); id; id = toCheck.shift()) {
    try {
      const found = problemLines(await checkFilm(path.join(results, 'films', language!, id), path.join(results, language!, `${id}.mp4`), language!));
      if (found.length) held.set(id, found);
    } catch (error) {
      held.set(id, [`The stills could not be looked at: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }
}));
if (held.size) {
  const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const summary = [`### Held by the frame check (${language})`, '', ...[...held].flatMap(([id, found]) => [`- **${id}**`, ...found.map((f) => `  - ${f}`)]), ''];
  if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${summary.join('\n')}\n`);
  for (const [id, found] of held) {
    console.log(`${language}: ${id} held by the frame check:\n  ${found.join('\n  ')}`);
    if (process.env['GITHUB_ACTIONS']) console.log(`::warning title=${escape(`Frame check: ${id} (${language})`).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${escape(found.join('\n'))}`);
  }
}
const order = Object.keys(TUTORIALS);
const now = new Date().toISOString();
for (const id of filmed) {
  if (held.has(id)) continue;
  const tutorial = TUTORIALS[id]!;
  const mp4 = path.join(results, language, `${id}.mp4`);
  const sha256 = createHash('sha256').update(readFileSync(mp4)).digest('hex');
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  const who = GROUPS.find((g) => g.videos.includes(tutorial))!.who;
  const opening = tutorial.steps.find((s) => s.say)?.say;
  const text = youtubeText(say(tutorial.title), opening ? firstSentence(say(opening)) : '', { language, tutorial: id, ...(tutorial.notIn ? { notIn: tutorial.notIn } : {}) });
  kept.set(id, {
    tutorial: id, sha256, bytes: readFileSync(mp4).length, seconds: Math.max(1, Math.round(seconds)), ...text,
    playlist: PLAYLISTS[language]![who], position: order.indexOf(id), look: looks.get(id)!, frame: FRAME,
    ...(head ? { commit: head } : {}), filmedAt: now, script: scripts.get(id)!, steps: steps.get(id)!, why: why.get(id)!
  });
  copyFileSync(mp4, path.join(outDir, filmName(language, id, sha256)));
}
// A film tried tonight that reads as it did is checked as of tonight: changes merged before now slot it no more.
// One from before films kept their script, steps and commit takes tonight's as its own, once.
for (const id of ids) {
  const film = kept.get(id);
  if (!film || why.has(id) || !looks.has(id) || film.look !== looks.get(id)) continue;
  kept.set(id, {
    ...film, script: film.script ?? scripts.get(id)!, steps: film.steps ?? steps.get(id)!,
    ...(head ? { commit: film.commit ?? head, checked: { commit: head, at: now } } : {})
  });
}

/** The trailer: captured until its look is sure (as a video's dry run is tried again), made when it changed. */
function trailer(): boolean {
  const dir = path.join('e2e', 'results', 'trailer', language!);
  const film = kept.get(TRAILER)?.look;
  const framed = !kept.has(TRAILER) || kept.get(TRAILER)!.frame === TRAILER_FRAME;
  const tries: string[] = [];
  do {
    const capture = spawnSync('npx', ['tsx', path.join(TRAILER_DIR, 'capture.ts'), dir], { stdio: 'inherit', env: { ...process.env, TUTORIAL_LANGUAGE: language } });
    if (capture.status !== 0) return false;
    tries.push(trailerLook(language!, dir));
  } while (!trailerNamed && framed && tryAgain(tries, film));
  const look = tries[tries.length - 1]!;
  const same = look === film && framed && !trailerNamed;
  console.log(`${language}: the trailer ${same ? 'looks as it did' : 'to make'}${tries.length > 1 ? ` (${tries.length} captures)` : ''}`);
  if (same) return true;
  const mp4 = path.join(dir, `${TRAILER}-${language}.mp4`);
  const render = spawnSync('npx', ['tsx', path.join(TRAILER_DIR, 'render.ts'), '--lang', language!, '--capture', dir, '--out', mp4, '--sub', '4'], { stdio: 'inherit' });
  if (render.status !== 0 || !existsSync(mp4)) return false;
  const sha256 = createHash('sha256').update(readFileSync(mp4)).digest('hex');
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  // First in the playlist for everyone, and the channel's trailer once it is up (server/tutorialPublisher.ts).
  kept.set(TRAILER, {
    tutorial: TRAILER, sha256, bytes: readFileSync(mp4).length, seconds: Math.max(1, Math.round(seconds)), ...trailerText(language!),
    playlist: PLAYLISTS[language!]!.everyone, position: 0, look, frame: TRAILER_FRAME
  });
  copyFileSync(mp4, path.join(outDir!, filmName(language!, TRAILER, sha256)));
  return true;
}
const trailerMade = !named || trailerNamed ? trailer() : true;

const films = [...kept.values()].sort((a, b) => a.position - b.position);
writeFileSync(path.join(outDir, manifestName(language)), `${JSON.stringify({ language, films }, null, 2)}\n`);
const failed = [...ids.filter((id) => !tried.has(id) || (changed.includes(id) && !filmed.has(id))), ...(trailerMade ? [] : [TRAILER])];

// Every public video's state in this language, for the release and the chart: its film and why it was made,
// tonight's try, and the changes that slot it (merged since its last check, touching a screen it shows).
type Tonight = 'filmed' | 'held' | 'failed' | 'same' | 'not tried';
const tonight = (id: string): Tonight =>
  !ids.includes(id) ? 'not tried' : held.has(id) ? 'held' : filmed.has(id) ? 'filmed' : changed.includes(id) || !tried.has(id) ? 'failed' : 'same';
const slots = new Map<string, Slot[]>();
const status = Object.keys(TUTORIALS).filter((id) => !TUTORIALS[id]!.staff && !TUTORIALS[id]!.notIn?.includes(language)).map((id) => {
  const film = kept.get(id);
  // A video filmed tonight has answered what slotted it: its causes say which changes.
  const slot = tonight(id) === 'filmed' ? [] : slotsOf(stepScreens(TUTORIALS[id]!), changesSince(lastCheck.get(id)), code);
  if (slot.length) slots.set(id, slot);
  return {
    tutorial: id, title: TUTORIALS[id]!.title, tonight: tonight(id),
    film: film ? { sha256: film.sha256, filmedAt: film.filmedAt ?? null, commit: film.commit ?? null, why: film.why ?? null } : null,
    why: why.get(id) ?? [], slots: tonight(id) === 'same' ? [] : slot, checked: tonight(id) === 'same' ? slot : [],
    ...(held.has(id) ? { held: held.get(id)! } : {})
  };
});
writeFileSync(path.join(outDir, `status-${language}.json`), `${JSON.stringify({ language, commit: head ?? null, at: now, videos: status }, null, 2)}\n`);
const summary = [
  ...(changed.length ? [`### Why each video was filmed (${language})`, '', ...changed.map((id) => `- **${id}** (${tonight(id)}): ${why.get(id)!.map(causeLine).join('; ')}`), ''] : []),
  ...(slots.size ? [`### Slotted by code changes to their screens (${language})`, '',
    ...[...slots].map(([id, s]) => `- **${id}** (${tonight(id) === 'same' ? 'words the same, slot cleared' : tonight(id)}): ${s.map((c) => `${c.pr ? `#${c.pr}` : c.sha.slice(0, 7)} (${c.screens.join(', ')})`).join(', ')}`), ''] : [])
];
if (summary.length && process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${summary.join('\n')}\n`);
console.log(`${language}: ${filmed.size - held.size} filmed, ${films.length} in the manifest${failed.length ? `, failed: ${failed.join(' ')}` : ''}` +
  `${held.size ? `, held by the frame check: ${[...held.keys()].join(' ')}` : ''}`);
if (failed.length || held.size) process.exit(1);
