// Puts one language's nightly films into the repository's `tutorials`
// release (.github/workflows/tutorials.yml, docs/tutorial-videos.md): the new
// films first, then the manifest that names them, so the intake job never
// reads a manifest naming a film that is not there yet; then the voice they
// were said in, for the next night; last it deletes that language's films
// the manifest no longer names. Uses gh, with GH_TOKEN. It says how many
// films it put in as the step's `films` output, so the workflow tells the
// app's Worker only when there are new ones (films-in.mjs, decisions.md 192).
//
//   npx tsx e2e/tutorials/put-in-release.ts fr <out dir>
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { filmName, manifestName, readManifest, TUTORIALS_TAG } from '../../server/tutorialIntakeModel';
import type { ChannelLanguage } from '../../server/youtube';

const [language, out] = process.argv.slice(2) as [ChannelLanguage | undefined, string | undefined];
if (!language || !out) {
  console.error('usage: npx tsx e2e/tutorials/put-in-release.ts <language> <out dir>');
  process.exit(2);
}
const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const manifest = path.join(out, manifestName(language));
if (!existsSync(manifest)) {
  console.log(`${language}: no manifest, nothing to put in the release`);
  process.exit(0);
}
const named = new Set(readManifest(language, JSON.parse(readFileSync(manifest, 'utf8'))).films.map((f) => filmName(language, f.tutorial, f.sha256)));
const films = readdirSync(out).filter((f) => named.has(f));
if (films.length) gh('release', 'upload', TUTORIALS_TAG, ...films.map((f) => path.join(out, f)), '--clobber');
gh('release', 'upload', TUTORIALS_TAG, manifest, '--clobber');

// The voice: each line said, the speaker's readings and the pieces they are
// made of, so a line is never paid for twice. Kept whenever Gemini said
// something (gemini-voice.mjs writes what it counted), films or not.
const results = path.join('e2e', 'results', 'tutorials');
if (films.length || existsSync(path.join(results, 'gemini-usage.jsonl'))) {
  const voices = existsSync(path.join(results, 'films', language))
    ? readdirSync(path.join(results, 'films', language)).map((id) => path.join('films', language, id, 'voice')).filter((v) => existsSync(path.join(results, v)))
    : [];
  const speech = [path.join('speech', language), path.join('speech', 'pieces')].filter((s) => existsSync(path.join(results, s)));
  if (speech.length || voices.length) {
    const archive = path.join(out, `voice-${language}.tgz`);
    execFileSync('tar', ['czf', archive, '-C', results, ...speech, ...voices]);
    gh('release', 'upload', TUTORIALS_TAG, archive, '--clobber');
  }
}

const prefix = `${language}.`;
const assets = gh('release', 'view', TUTORIALS_TAG, '--json', 'assets', '--jq', '.assets[].name').split('\n').filter(Boolean);
const old = assets.filter((a) => a.startsWith(prefix) && a.endsWith('.mp4') && !named.has(a));
for (const name of old) gh('release', 'delete-asset', TUTORIALS_TAG, name, '--yes');
console.log(`${language}: ${films.length} films put in the release, ${old.length} older ones taken out`);
if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], `films=${films.length}\n`);
