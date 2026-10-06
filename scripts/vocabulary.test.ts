import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Below an organization there are only languages, and the sync unit is the
 * stream (decision 63, docs/streams-and-languages.md). The words for the
 * levels that are gone must not come back into the code: a `laneId` or a
 * `partition` in a new file is the old model returning by habit.
 */

const ROOTS = ['packages/core/src', 'packages/client/src', 'apps/mobile/src', 'apps/mobile/App.tsx', 'apps/web/worker', 'server', 'supabase/migrations', 'scripts'];
const SKIP = new Set(['node_modules', 'scripts/vocabulary.test.ts']);

/** "partition", "lane" or "project" as a word or a camelCase part, singular or plural. */
const OLD = /(?<![A-Za-z])(?:[Pp]artition|[Ll]ane|[Pp]roject)s?(?![a-z])|(?<=[a-z0-9_])(?:Partition|Lane|Project)s?(?![a-z])|(?<![A-Za-z])(?:PARTITION|LANE|PROJECT)S?(?![A-Z])/g;

/** Where the word means something else, by file (a path prefix) and what it may say there. */
const ALLOWED: { path: string; words: RegExp; why: string }[] = [
  { path: '', words: /^project$/i, why: "a Supabase or EAS project (a hosted project, `projectId` in app.json's extra, `langquest_project_url`)" },
  { path: 'packages/client/src/v2import.ts', words: /^projects?$/i, why: "LangQuest v2's own projects and its `project_id` columns" },
  { path: 'server/importV2.ts', words: /^projects?$/i, why: "the v2 projects it imports" },
  { path: 'apps/mobile/src/flow.ts', words: /^projects?$/i, why: "the demo's own words: its dropped project screens, and comments ported with its edges" },
  { path: 'apps/mobile/src/study/chapterText.ts', words: /^lanes?$/i, why: 'Bible text ("the streets and lanes of the city")' },
  { path: 'scripts', words: /^projects?$/i, why: "Supabase and Cloudflare projects in deploy and environment scripts" },
  { path: 'scripts/linear-sync', words: /^lanes?$/i, why: 'deploy lanes (iOS, Android), not languages' },
  { path: 'packages/client/src/sqliteStore.ts', words: /^lane$/i, why: 'dropping a table older apps made' }
];

function files(path: string): string[] {
  if (SKIP.has(path) || path.endsWith('/node_modules')) return [];
  const s = statSync(path, { throwIfNoEntry: false });
  if (!s) return [];
  if (s.isFile()) return /\.(ts|tsx|sql|mjs)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe('vocabulary (decision 63)', () => {
  it('names no partition, lane or project in the code', () => {
    const found: string[] = [];
    for (const file of ROOTS.flatMap(files)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(OLD)) {
          if (ALLOWED.some((a) => file.startsWith(a.path) && a.words.test(m[0]))) continue;
          found.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
