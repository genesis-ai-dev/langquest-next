// The bar for the key-term check (decision 207, LAN-228 stage 2): a set of
// recorded term examples and passages whose content is known, and the
// precision and recall of a matcher over them. Pure: bytes and numbers in,
// numbers and text out. `scripts/key-term-eval.ts` reads the set from disk.
//
// A matcher says how sure it is that a passage's audio holds a term, from
// the term's recorded examples (query by example, not speech recognition).
// Stages 3 and 4 each bring one; this file only measures.

export interface EvalClip {
  id: string;
  /** Mono samples in -1..1. */
  samples: Float32Array;
  sampleRate: number;
}

export interface EvalTerm {
  termId: string;
  examples: EvalClip[];
}

export interface EvalPassage {
  id: string;
  clip: EvalClip;
  /** The terms known to be said in it; every other term of the set is known not to be. */
  heard: string[];
}

export interface EvalSet {
  /** What the set was recorded in, for the report only. */
  language: string;
  terms: EvalTerm[];
  passages: EvalPassage[];
}

export interface Matcher {
  id: string;
  version: string;
  /** 0 to 1; higher means more likely said. */
  score(term: EvalTerm, passage: EvalClip): number | Promise<number>;
}

export interface PairScore {
  termId: string;
  passageId: string;
  score: number;
  /** The known answer. */
  present: boolean;
}

export interface Tally {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Of what it called heard, how much was; 1 when it called nothing heard. */
  precision: number;
  /** Of what was said, how much it found; 1 when nothing was said. */
  recall: number;
  f1: number;
}

export interface MatcherReport {
  matcher: string;
  version: string;
  threshold: number;
  overall: Tally;
  perTerm: Record<string, Tally>;
  /** The threshold with the best F1 over this set, so a matcher is judged at its best and its fixed default apart. */
  best: { threshold: number; tally: Tally };
}

/** The pair counts for one threshold: a score at or above it says "heard". */
export function tally(pairs: readonly PairScore[], threshold: number): Tally {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of pairs) {
    const said = p.score >= threshold;
    if (said && p.present) tp++; else if (said) fp++; else if (p.present) fn++; else tn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

/** Every term against every passage, with the known answer beside the score. */
export async function scorePairs(matcher: Matcher, set: EvalSet): Promise<PairScore[]> {
  const out: PairScore[] = [];
  for (const term of set.terms) {
    for (const passage of set.passages) {
      const raw = await matcher.score(term, passage.clip);
      const score = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      out.push({ termId: term.termId, passageId: passage.id, score, present: passage.heard.includes(term.termId) });
    }
  }
  return out;
}

export function reportFor(matcher: Pick<Matcher, 'id' | 'version'>, pairs: readonly PairScore[], threshold: number): MatcherReport {
  const perTerm: Record<string, Tally> = {};
  for (const termId of new Set(pairs.map((p) => p.termId))) perTerm[termId] = tally(pairs.filter((p) => p.termId === termId), threshold);
  let best = { threshold, tally: tally(pairs, threshold) };
  for (const candidate of new Set(pairs.map((p) => p.score))) {
    const t = tally(pairs, candidate);
    if (t.f1 > best.tally.f1 || (t.f1 === best.tally.f1 && candidate > best.threshold)) best = { threshold: candidate, tally: t };
  }
  return { matcher: matcher.id, version: matcher.version, threshold, overall: tally(pairs, threshold), perTerm, best };
}

/** What a matcher has to reach before it ships (decision 207). Both numbers are for the team to confirm. */
export interface Bar {
  precision: number;
  recall: number;
}
export const DEFAULT_BAR: Bar = { precision: 0.8, recall: 0.8 };

export function meetsBar(t: Pick<Tally, 'precision' | 'recall'>, bar: Bar = DEFAULT_BAR): boolean {
  return t.precision >= bar.precision && t.recall >= bar.recall;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4);

/** The report a person reads: one block per matcher, one line per term. */
export function formatReports(set: EvalSet, reports: readonly MatcherReport[], bar: Bar = DEFAULT_BAR): string {
  const said = set.passages.reduce((n, p) => n + p.heard.length, 0);
  const lines = [
    `Key-term check on ${set.language}: ${set.terms.length} terms, ${set.passages.length} passages, ${said} known mentions.`,
    `Bar: precision ${pct(bar.precision).trim()}, recall ${pct(bar.recall).trim()}.`
  ];
  for (const r of reports) {
    lines.push('', `${r.matcher} (${r.version}) at threshold ${r.threshold.toFixed(2)}: precision ${pct(r.overall.precision)}, recall ${pct(r.overall.recall)} ${meetsBar(r.overall, bar) ? 'MEETS THE BAR' : 'below the bar'}`);
    lines.push(`  best threshold ${r.best.threshold.toFixed(2)}: precision ${pct(r.best.tally.precision)}, recall ${pct(r.best.tally.recall)} ${meetsBar(r.best.tally, bar) ? 'meets the bar' : 'below the bar'}`);
    for (const [termId, t] of Object.entries(r.perTerm)) {
      lines.push(`  ${termId.padEnd(20)} precision ${pct(t.precision)}  recall ${pct(t.recall)}  (found ${t.tp}, wrong ${t.fp}, missed ${t.fn})`);
    }
  }
  return lines.join('\n');
}

/** The floor every real matcher has to beat: call everything heard, or nothing. */
export const BASELINES: Matcher[] = [
  { id: 'always-heard', version: '1', score: () => 1 },
  { id: 'never-heard', version: '1', score: () => 0 }
];

// ---- reading a set -----------------------------------------------------------

/** The manifest of an evaluation set; paths are relative to its folder. */
export interface EvalManifest {
  language: string;
  terms: { termId: string; examples: string[] }[];
  passages: { id: string; file: string; heard: string[] }[];
}

/** What is wrong with a manifest, in words, or null. Run before any audio is read. */
export function manifestProblem(m: unknown): string | null {
  if (typeof m !== 'object' || m === null) return 'The manifest must be an object.';
  const x = m as Partial<EvalManifest>;
  if (typeof x.language !== 'string' || !x.language) return 'The manifest needs a language.';
  if (!Array.isArray(x.terms) || x.terms.length === 0) return 'The manifest needs at least one term.';
  if (!Array.isArray(x.passages) || x.passages.length === 0) return 'The manifest needs at least one passage.';
  const ids = new Set<string>();
  for (const t of x.terms) {
    if (typeof t?.termId !== 'string' || !t.termId || ids.has(t.termId)) return 'Every term needs its own termId.';
    ids.add(t.termId);
    if (!Array.isArray(t.examples) || t.examples.length === 0 || t.examples.some((e) => typeof e !== 'string')) return `Term ${t.termId} needs example files.`;
  }
  const passageIds = new Set<string>();
  for (const p of x.passages) {
    if (typeof p?.id !== 'string' || !p.id || passageIds.has(p.id)) return 'Every passage needs its own id.';
    passageIds.add(p.id);
    if (typeof p.file !== 'string' || !Array.isArray(p.heard)) return `Passage ${p.id} needs a file and a heard list.`;
    const unknown = p.heard.find((h) => !ids.has(h));
    if (unknown !== undefined) return `Passage ${p.id} says ${String(unknown)}, which is not a term of the set.`;
  }
  const said = new Set(x.passages.flatMap((p) => p.heard));
  const withoutAny = x.terms.find((t) => !said.has(t.termId));
  if (withoutAny) return `Term ${withoutAny.termId} is said in no passage, so its recall cannot be measured.`;
  if (x.terms.every((t) => x.passages!.every((p) => p.heard.includes(t.termId)))) return 'Every term is in every passage, so precision cannot be measured.';
  return null;
}

/** Mono float samples from a 16-bit PCM WAV file (more channels are averaged). Throws a plain message for anything else. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let at = 12, channels = 0, sampleRate = 0, bits = 0, format = 0;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at), size = v.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true); channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true); bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16 || channels < 1) throw new Error('Only 16-bit PCM WAV is read.');
      const n = Math.floor(Math.min(size, bytes.byteLength - body) / (2 * channels));
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += v.getInt16(body + (i * channels + c) * 2, true);
        samples[i] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error('The WAV file has no sound.');
}
