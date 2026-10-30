// The nightly filming of one app language (docs/tutorial-videos.md,
// .github/workflows/tutorials.yml): every video is tried first without voice
// or film (--dry), its screens' words are compared with those of the film
// the release keeps (look.ts), and only the videos that look different, or
// have no film yet, are filmed again, as is every film framed or described
// as films no longer are (playlists.ts FRAME). What the release should hold
// afterwards goes into <out>: each new film under its release name, and the
// language's manifest (server/tutorialIntakeModel.ts), which keeps the films
// that did not change. The intake job brings the new ones into R2 for Publish.
// The channel's trailer (trailer/README.md) goes the same way: its screens
// captured, and the film made again when its look changed.
//
//   npx tsx e2e/tutorials/nightly.ts --language fr --release <dir> --out <dir> [video ...]
//
// Videos named are filmed whatever their look ("trailer" for the trailer;
// naming only others leaves it as it was). <dir> holds the release's
// manifest-fr.json when there is one. Needs what make-videos.ts needs. Exits
// 1 when a video could not be tried or filmed; the rest still go out, and a
// video that failed keeps its last film.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { filmName, manifestName, readManifest, type Film } from '../../server/tutorialIntakeModel';
import { TRAILER, type ChannelLanguage } from '../../server/youtube';
import { GROUPS, TUTORIALS } from './all';
import { lookOf, tryAgain } from './look';
import { firstSentence, FRAME, PLAYLISTS, youtubeText } from './playlists';
import { TRAILER_DIR, trailerLook, trailerText } from './trailer/trailer';

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

const manifestFile = path.join(releaseDir, manifestName(language));
// A video taken out of all.ts, out of this language, or for staff leaves the manifest; the trailer stays.
const kept = new Map<string, Film>(
  (existsSync(manifestFile) ? readManifest(language, JSON.parse(readFileSync(manifestFile, 'utf8'))).films : [])
    .filter((f) => f.tutorial === TRAILER || (TUTORIALS[f.tutorial] && !TUTORIALS[f.tutorial]!.staff && !TUTORIALS[f.tutorial]!.notIn?.includes(language)))
    .map((f) => [f.tutorial, f])
);

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
const looks = new Map([...tried].map((id) => [id, lookOf(stepsOf(id), language)]));
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
const changed = ids.filter((id) => looks.has(id) && (named || stale(id) || kept.get(id)?.look !== looks.get(id)));
console.log(`${language}: ${tried.size} of ${ids.length} tried (${triedAgain} tries again), ${changed.length} to film: ${changed.join(' ') || 'none'}`);

const filmed = changed.length ? makeVideos(changed, false) : new Set<string>();
// A film that failed although its dry run passed is filmed once more, alone: two films at once share the
// stack, and a slow answer or a screen drawn again under a tap fails one now and then.
const missed = changed.filter((id) => !filmed.has(id));
if (missed.length) {
  console.log(`${language}: ${missed.length} to film again, alone: ${missed.join(' ')}`);
  for (const id of makeVideos(missed, false, true)) filmed.add(id);
}
const lines = language === 'en' ? {} : JSON.parse(readFileSync(path.join('e2e', 'tutorials', 'lines', `${language}.json`), 'utf8')) as Record<string, string>;
const say = (english: string) => (language === 'en' ? english : lines[english] ?? english);
const order = Object.keys(TUTORIALS);
for (const id of filmed) {
  const tutorial = TUTORIALS[id]!;
  const mp4 = path.join(results, language, `${id}.mp4`);
  const sha256 = createHash('sha256').update(readFileSync(mp4)).digest('hex');
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  const who = GROUPS.find((g) => g.videos.includes(tutorial))!.who;
  const opening = tutorial.steps.find((s) => s.say)?.say;
  const text = youtubeText(say(tutorial.title), opening ? firstSentence(say(opening)) : '', { language, tutorial: id, ...(tutorial.notIn ? { notIn: tutorial.notIn } : {}) });
  kept.set(id, {
    tutorial: id, sha256, bytes: readFileSync(mp4).length, seconds: Math.max(1, Math.round(seconds)), ...text,
    playlist: PLAYLISTS[language]![who], position: order.indexOf(id), look: looks.get(id)!, frame: FRAME
  });
  copyFileSync(mp4, path.join(outDir, filmName(language, id, sha256)));
}

/** The trailer: captured until its look is sure (as a video's dry run is tried again), made when it changed. */
function trailer(): boolean {
  const dir = path.join('e2e', 'results', 'trailer', language!);
  const film = kept.get(TRAILER)?.look;
  const framed = !kept.has(TRAILER) || kept.get(TRAILER)!.frame === FRAME;
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
    playlist: PLAYLISTS[language!]!.everyone, position: 0, look, frame: FRAME
  });
  copyFileSync(mp4, path.join(outDir!, filmName(language!, TRAILER, sha256)));
  return true;
}
const trailerMade = !named || trailerNamed ? trailer() : true;

const films = [...kept.values()].sort((a, b) => a.position - b.position);
writeFileSync(path.join(outDir, manifestName(language)), `${JSON.stringify({ language, films }, null, 2)}\n`);
const failed = [...ids.filter((id) => !tried.has(id) || (changed.includes(id) && !filmed.has(id))), ...(trailerMade ? [] : [TRAILER])];
console.log(`${language}: ${filmed.size} filmed, ${films.length} in the manifest${failed.length ? `, failed: ${failed.join(' ')}` : ''}`);
if (failed.length) process.exit(1);
