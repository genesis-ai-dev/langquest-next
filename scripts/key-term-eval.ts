// The bar for the key-term check (decision 207): precision and recall of each
// matcher over a set of term examples and passages with known contents.
//
//   npm run key-terms:eval -- eval/key-terms/<set>
//   npm run key-terms:eval -- eval/key-terms/<set> --matcher ./path/to/matchers.ts --threshold 0.6 --bar 0.9,0.8
//
// The set's layout is in eval/key-terms/README.md. Without --matcher only the
// two baselines run (everything heard, nothing heard): the floor a real
// matcher has to beat. A matcher module's default export is a Matcher[].
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BASELINES, DEFAULT_BAR, decodeWav, formatReports, manifestProblem, reportFor, scorePairs,
  type EvalClip, type EvalManifest, type EvalSet, type Matcher
} from '../packages/core/src/keyTermEval';

function clip(folder: string, file: string): EvalClip {
  const { samples, sampleRate } = decodeWav(new Uint8Array(readFileSync(resolve(folder, file))));
  return { id: file, samples, sampleRate };
}

export function loadSet(folder: string): EvalSet {
  const manifest: unknown = JSON.parse(readFileSync(resolve(folder, 'manifest.json'), 'utf8'));
  const problem = manifestProblem(manifest);
  if (problem) throw new Error(`${folder}/manifest.json: ${problem}`);
  const m = manifest as EvalManifest;
  return {
    language: m.language,
    terms: m.terms.map((t) => ({ termId: t.termId, examples: t.examples.map((f) => clip(folder, f)) })),
    passages: m.passages.map((p) => ({ id: p.id, clip: clip(folder, p.file), heard: p.heard }))
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const folder = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));
  if (!folder) throw new Error('Usage: npm run key-terms:eval -- <set folder> [--matcher <module>] [--threshold 0.5] [--bar precision,recall]');
  const threshold = Number(flag('--threshold') ?? 0.5);
  const [bp, br] = (flag('--bar') ?? '').split(',').map(Number);
  const bar = bp !== undefined && br !== undefined && Number.isFinite(bp) && Number.isFinite(br) ? { precision: bp, recall: br } : DEFAULT_BAR;
  const matchers: Matcher[] = [...BASELINES];
  const module = flag('--matcher');
  if (module) matchers.push(...((await import(pathToFileURL(resolve(dirname('.'), module)).href)) as { default: Matcher[] }).default);
  const set = loadSet(folder);
  const reports = [];
  for (const matcher of matchers) reports.push(reportFor(matcher, await scorePairs(matcher, set), threshold));
  console.log(formatReports(set, reports, bar));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
