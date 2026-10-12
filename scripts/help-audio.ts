// Help mode's recorded voice, per language (LAN-42, docs/localization.md).
//
//   npm run help-audio -- lines <lang> [file.csv]
//     Every line help can say in that language (every catalog string without
//     a placeholder), with the file name its recording must have:
//     <hash>.m4a. Give the sheet to whoever records.
//
//   npm run help-audio -- upload <lang> <folder> [preview|production]
//     Puts each <hash>.m4a (or <key>.m4a, named by catalog key) from the
//     folder in the blobs bucket under help-audio/<lang>/, then rewrites that
//     language's index.json: the recordings whose words are still current.
//     A recording whose words have since changed is left out (re-record it).
//
// The hash is the first 16 hex digits of SHA-256 over "<lang>\n<words>",
// as apps/mobile/src/helpAudio.ts computes it on the phone.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Tree = { [k: string]: string | Tree };

export function lineHash(language: string, words: string): string {
  return createHash('sha256').update(`${language}\n${words.trim()}`).digest('hex').slice(0, 16);
}

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

/** What help can say in a language: every string with no placeholder or tag, once each. */
export function helpLines(language: string, catalog: Tree): { key: string; text: string; hash: string }[] {
  const all = leaves(catalog).filter(([, text]) => text.trim() && !/\{\{|<\/?\w+>/.test(text));
  const seen = new Set<string>();
  const out: { key: string; text: string; hash: string }[] = [];
  for (const [key, text] of all) {
    const hash = lineHash(language, text);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ key, text: text.trim(), hash });
  }
  return out;
}

const csv = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function catalogOf(language: string): Tree {
  return JSON.parse(readFileSync(join('apps/mobile/src/i18n', `${language}.json`), 'utf8')) as Tree;
}

function wrangler(args: string[], input?: string): string {
  return execFileSync('npx', ['wrangler', ...args, '-c', 'apps/web/wrangler.jsonc'], { encoding: 'utf8', ...(input ? { input } : {}), stdio: ['pipe', 'pipe', 'inherit'] });
}

function main() {
  const [command, language, ...rest] = process.argv.slice(2);
  if (!language || !/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(language)) throw new Error('Usage: help-audio lines|upload <lang> ...');
  const lines = helpLines(language, catalogOf(language));
  if (command === 'lines') {
    const out = rest[0] ?? `help-audio-${language}.csv`;
    writeFileSync(out, ['file,key,text', ...lines.map((l) => `${l.hash}.m4a,${csv(l.key)},${csv(l.text)}`)].join('\n') + '\n');
    console.log(`${lines.length} lines → ${out}`);
    return;
  }
  if (command === 'upload') {
    const [folder, env = 'production'] = rest;
    if (!folder) throw new Error('Usage: help-audio upload <lang> <folder> [preview|production]');
    const bucket = env === 'preview' ? 'langquest-next-blobs-preview' : 'langquest-next-blobs';
    const byKey = new Map(lines.map((l) => [l.key, l.hash]));
    const current = new Set(lines.map((l) => l.hash));
    let listed: string[] = [];
    try {
      listed = (JSON.parse(wrangler(['r2', 'object', 'get', `${bucket}/help-audio/${language}/index.json`, '--pipe', '--remote'])) as { lines: string[] }).lines;
    } catch { /* no recordings yet */ }
    const kept = new Set(listed.filter((h) => current.has(h)));
    for (const name of readdirSync(folder).filter((f) => f.endsWith('.m4a'))) {
      const stem = name.slice(0, -4);
      const hash = /^[0-9a-f]{16}$/.test(stem) ? stem : byKey.get(stem);
      if (!hash || !current.has(hash)) { console.warn(`skipped ${name}: not a current line in ${language}`); continue; }
      wrangler(['r2', 'object', 'put', `${bucket}/help-audio/${language}/${hash}.m4a`, '--file', join(folder, name), '--content-type', 'audio/mp4', '--remote']);
      kept.add(hash);
    }
    const index = JSON.stringify({ lines: [...kept].sort() });
    const tmp = join(folder, '.index.json');
    writeFileSync(tmp, index);
    wrangler(['r2', 'object', 'put', `${bucket}/help-audio/${language}/index.json`, '--file', tmp, '--content-type', 'application/json', '--remote']);
    console.log(`${kept.size} of ${lines.length} lines recorded in ${language} (${bucket})`);
    return;
  }
  throw new Error('Usage: help-audio lines|upload <lang> ...');
}

if (process.argv[1]?.endsWith('help-audio.ts')) main();
