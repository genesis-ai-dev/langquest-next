import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PASSAGE_PARTS, READS_EVERY_PASSAGE } from '@langquest-next/core';

/**
 * A language kept on disk (decisions.md 143) holds in memory only the
 * passages a screen has open. Code that looks across every passage in the
 * state sees those few and answers wrongly, without any error: a list that
 * shows most passages as not started, a count that is too low. Lists read
 * the language's lines (`ctx.language.lines`); a screen that needs a few
 * passages' records reads them in (`withPassages`). So nothing here loops
 * over a map of passage records, or calls one of core's answers about every
 * passage (`READS_EVERY_PASSAGE`), unless it is listed below with why the
 * passages it reads are in memory.
 */
const APP = join(__dirname, '..');

const ALLOWED: Record<string, { reads: string[]; why: string }> = {
  'src/recording/recordingFlow.ts': { reads: ['takes'], why: 'the passage on screen: which of its recordings a take already holds' },
  'src/passage/passageResources.ts': { reads: ['recordings'], why: "the source audio of the passage's book and chapter, which come into memory with it" },
  'src/sync/lostFilesWords.ts': { reads: ['lostFilesView'], why: "only when no view is given; the alert passes the one worked out from the phone's table" },
  'src/sync/offline.tsx': { reads: ['offlineByUnit'], why: 'passages not kept offline, counted only while they are on screen' },
  'src/keyTerms/model.ts': { reads: ['takesLinkingTerm'], why: "called with the passages read in for the term (`passagesLinkingTerm`)" },
  'src/passage/sendTarget.ts': { reads: ['usualTarget'], why: "given each passage's reviewers from the lines, it reads no records" },
  'src/sync/useLanguage.ts': { reads: ['languageLines', 'updatesFor'], why: 'on an empty language, before a session opens' },
  'src/templates/bookStructureModel.ts': { reads: ['languageLines'], why: "only when no lines are given (tests); screens pass the language's lines" }
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without its comments, which may name these. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const maps = PASSAGE_PARTS.map((p) => p.map).join('|');
const loop = new RegExp(`Object\\.(?:values|entries|keys)\\(\\s*[\\w.?!]*\\.(${maps})\\s*\\)|\\bin\\s+[\\w.?!]*\\.(${maps})\\s*\\)`, 'g');

/** The names a file imports from core as values (types aside). */
function fromCore(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s*from\s*['"]@langquest-next\/core['"]/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!;
      if (name && !/^type\s/.test(part.trim())) names.push(name);
    }
  }
  return names;
}

describe('the app never reads every passage from memory', () => {
  it('loops over passage records, or core answers about every passage, only where listed', () => {
    const every = new Set<string>(READS_EVERY_PASSAGE);
    const found: string[] = [];
    const used = new Map<string, Set<string>>();
    for (const file of [...files(join(APP, 'src')), join(APP, 'App.tsx')]) {
      const name = relative(APP, file);
      const source = code(readFileSync(file, 'utf8'));
      const reads = new Set<string>();
      for (const m of source.matchAll(loop)) reads.add(m[1] ?? m[2]!);
      for (const n of fromCore(source)) if (every.has(n)) reads.add(n);
      used.set(name, reads);
      const allowed = new Set(ALLOWED[name]?.reads ?? []);
      for (const r of reads) if (!allowed.has(r)) found.push(`${name} reads ${r}`);
    }
    expect(found, 'Read the language\'s lines, or read the passages in with `withPassages` (decisions.md 143); or list the file in ALLOWED with why its passages are in memory.').toEqual([]);
    // A listed read that is gone is dropped from the list, so the list stays true.
    const stale = Object.entries(ALLOWED).flatMap(([file, a]) => a.reads.filter((r) => !used.get(file)?.has(r)).map((r) => `${file} no longer reads ${r}`));
    expect(stale).toEqual([]);
  });
});
