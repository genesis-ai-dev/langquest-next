/**
 * How many Bibles and New Testaments are complete in LangQuest Next and in
 * LangQuest v2, and the five languages nearest a complete New Testament, with
 * the table to give a partner (LAN-231). It only reads; nothing here can write:
 *
 * - Next: one plain SELECT at a time (`assertOnlyReads`), through the Supabase
 *   CLI you are logged in with, of the report inputs the projection pass
 *   stores for each language (decisions.md 142). No language is folded here.
 * - v2: GET requests only, with v2's publishable key, through the reader the
 *   import uses. v2 times out on joins over its link tables, so SQL will not do.
 *
 *   npm run bibles:count                  both apps: about 30 minutes, most of it v2
 *   npm run bibles:count -- --only next   one app
 *   npm run bibles:count -- --out <file>  where the report goes
 *                                         (default /tmp/langquest-bible-counts.md)
 *
 * Run it on your own computer, after `npx supabase login`. The report names
 * private work, so it stays out of this public repository and CI (AGENTS.md).
 * `--next-db-url <url>` reads another Next database (local: add sslmode=disable).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRecommendations, restReader, type Recommendation, type V2Reader } from '@langquest-next/v2-import';
import {
  assertOnlyReads, looksLikeTest, nextCount, NEXT_LANGUAGES, NEXT_REPORTS, render, V2_MOVES, V2_PLACEMENTS, v2Counts, v2Verses,
  type LanguageCount, type NextReportRow, type V2Project
} from './bibleCounts';
import { rowsOf } from './global-viewer';

const root = fileURLToPath(new URL('..', import.meta.url));
const NEXT_REF = 'xymxnebdwtbkfxlbylch';
const V2_REF = 'unsxkmlcyxgtgmtzfonb';

export type Query = <T>(sql: string) => T[];
/** A person's choice of language for each v2 project they chose one for. */
type Decided = Map<string, { id: string; name: string | null }>;

interface NextRead {
  rows: LanguageCount[];
  warnings: string[];
  decided: Decided;
}

export function readNext(query: Query, recommendations: Map<string, Recommendation>): NextRead {
  const reports = query<NextReportRow>(NEXT_REPORTS);
  const languages = query<{ org_id: string; language_id: string }>(NEXT_LANGUAGES);
  const moves = query<{ from_org: string; from_language: string; to_org: string; to_language: string }>(V2_MOVES);
  const placements = query<{ project_id: string; languoid_id: string | null; language_name: string | null }>(V2_PLACEMENTS);

  const key = (org: string, language: string) => `${org}/${language}`;
  const newCopies = new Set(moves.map((m) => key(m.to_org, m.to_language)));
  const firstCopies = new Set(moves.map((m) => key(m.from_org, m.from_language)).filter((k) => !newCopies.has(k)));
  const kept = reports.filter((r) => !firstCopies.has(key(r.org_id, r.language_id)));
  const placed = new Set(placements.map((p) => p.project_id));
  const fromV2 = kept.filter((r) => placed.has(r.language_id) || newCopies.has(key(r.org_id, r.language_id)));
  const stored = new Set(reports.map((r) => key(r.org_id, r.language_id)));
  const noReport = languages.filter((l) => !stored.has(key(l.org_id, l.language_id)) && !firstCopies.has(key(l.org_id, l.language_id)));

  const decided: Decided = new Map();
  for (const [id, r] of recommendations) if (r.decision) decided.set(id, { id: r.decision, name: r.decision === r.languoidId ? r.name : null });
  // The board's choice comes after the CSV's decision, so it wins.
  for (const p of placements) if (p.languoid_id) decided.set(p.project_id, { id: p.languoid_id, name: p.language_name });

  const rows = kept.map(nextCount);
  return {
    rows, decided,
    warnings: [
      `Next: ${fromV2.length} of its ${kept.length} languages came over from v2, so their work is in both rows.`,
      ...(firstCopies.size ? [`Next: ${firstCopies.size} first copies of projects moved to another organization are left out, because the new copy holds the same work.`] : []),
      ...(noReport.length ? [`Next: ${noReport.length} languages have no stored report yet and are not counted. A new language has none until the server first reads it.`] : []),
      ...(rows.some((r) => r.notes.some((n) => n.includes('events behind'))) ? [`Next: ${rows.filter((r) => r.notes.some((n) => n.includes('events behind'))).length} languages have a report a few events behind. The server catches up by itself.`] : [])
    ]
  };
}

interface V2Read {
  rows: LanguageCount[];
  warnings: string[];
}

export async function readV2(reader: Pick<V2Reader, 'projects' | 'projectRows'>, decided: Decided, progress: (line: string) => void = () => {}): Promise<V2Read> {
  const active = (await reader.projects({ counts: true })).filter((p) => p.active !== false);
  const bibles = active.filter((p) => p.template === 'bible' || p.template === 'fia').sort((a, b) => a.assets - b.assets);
  const others = active.filter((p) => !bibles.includes(p) && p.assets > 0).sort((a, b) => b.assets - a.assets);

  const projects: V2Project[] = [];
  const failed: string[] = [];
  for (const [i, p] of bibles.entries()) {
    progress(`v2: project ${i + 1} of ${bibles.length} (${p.assets} items)`);
    try {
      projects.push({ id: p.id, name: p.name, private: !!p.private, language: decided.get(p.id) ?? null, verses: v2Verses(await reader.projectRows(p.id)) });
    } catch (e) {
      failed.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const shownName = (p: { name: string; private: boolean | null }) => `${p.name}${p.private ? '*' : ''}${looksLikeTest(p.name) ? '?' : ''}`;
  return {
    rows: v2Counts(projects),
    warnings: [
      ...(failed.length ? [`v2: THE COUNT IS INCOMPLETE. ${failed.length} projects could not be read: ${failed.join('; ')}`] : []),
      `v2: ${projects.length} active projects made from the Bible or FIA template are counted.`,
      `v2: ${others.length} other active projects, with ${others.reduce((n, p) => n + p.assets, 0)} items, are not counted, because they do not say which verses they hold. The largest: ${others.slice(0, 5).map((p) => `${shownName(p)} (${p.assets})`).join(', ') || 'none'}.`,
      `v2: ${projects.filter((p) => !p.language).length} counted projects have no confirmed language, so they show the project's name and count alone.`
    ]
  };
}

/** One SELECT through the Supabase CLI, from an empty folder, so no checkout's link is used. */
function cliQuery(target: string[]): Query {
  const cwd = mkdtempSync(join(tmpdir(), 'bible-counts-'));
  return <T>(sql: string): T[] => {
    const r = spawnSync(join(root, 'node_modules/.bin/supabase'), ['db', 'query', ...target, '--output-format', 'json', assertOnlyReads(sql)], { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error((r.stderr || r.stdout || r.error?.message || '').trim().slice(0, 800));
    return rowsOf<T>(r.stdout);
  };
}

/** v2's publishable key: from the environment, or the CLI you are logged in with. Never printed. */
function v2Key(): string {
  const set = process.env['V2_SUPABASE_ANON_KEY'];
  if (set) return set;
  const r = spawnSync(join(root, 'node_modules/.bin/supabase'), ['projects', 'api-keys', '--project-ref', V2_REF, '-o', 'json'], { cwd: mkdtempSync(join(tmpdir(), 'bible-counts-')), encoding: 'utf8' });
  const list = r.status === 0 ? (JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as { name: string; type?: string; api_key: string }[]) : [];
  const key = list.find((k) => k.name === 'anon' || k.type === 'publishable')?.api_key;
  if (!key) throw new Error('could not get v2\'s publishable key with the Supabase CLI; run npx supabase login first');
  return key;
}

/** `fetch` that refuses anything but a read. */
const getOnly: typeof fetch = (input, init) => {
  if (init?.method && init.method !== 'GET') throw new Error(`Refusing a ${init.method} request: this script only reads.`);
  return fetch(input, init);
};

async function main(argv: string[]): Promise<void> {
  if (process.env['CI']) throw new Error('This names private work, so it does not run on CI.');
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
  const only = flag('only');
  const out = flag('out') ?? '/tmp/langquest-bible-counts.md';
  const nextDb = flag('next-db-url');
  const progress = (line: string) => console.error(line);
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const write = (next: LanguageCount[] | null, v2: LanguageCount[] | null, warnings: string[]) => {
    const text = render({ at: new Date().toISOString(), next, v2, warnings });
    writeFileSync(out, text, { mode: 0o600 });
    return text;
  };

  const recommendations = parseRecommendations(readFileSync(join(root, 'docs/v2-project-languages.csv'), 'utf8'));
  const warnings: string[] = [];
  let next: LanguageCount[] | null = null;
  let v2: LanguageCount[] | null = null;
  let decided: Decided = new Map();

  progress('Next: reading each language\'s report');
  try {
    const read = readNext(cliQuery(nextDb ? ['--db-url', nextDb] : ['--linked', '--project-ref', NEXT_REF]), recommendations);
    next = only === 'v2' ? null : read.rows;
    decided = read.decided;
    if (only !== 'v2') warnings.push(...read.warnings);
  } catch (e) {
    warnings.push(`Next: could not read: ${message(e)}`);
    warnings.push('v2: no language confirmed on the board could be read, so every project shows its own name and counts alone.');
  }
  write(next, null, warnings);

  if (only !== 'next' && !nextDb) {
    progress('v2: reading the projects (GET requests only)');
    try {
      const reader = restReader({ url: `https://${V2_REF}.supabase.co`, key: v2Key(), bucket: 'assets', fetch: getOnly });
      const read = await readV2(reader, decided, progress);
      v2 = read.rows;
      warnings.push(...read.warnings);
    } catch (e) {
      warnings.push(`v2: could not read: ${message(e)}`);
    }
  }
  console.log(write(next, v2, warnings));
  progress(`\nThe report is in ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`x ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
