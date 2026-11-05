// The app never reads every passage from memory (decisions.md 143), held by
// ESLint as `whole-language/no-every-passage` (eslint.config.mjs).
//
// A language kept on disk holds in memory only the passages a screen has
// open. Code that looks across every passage in the state sees those few and
// answers wrongly, without any error: a list that shows most passages as not
// started, a count that is too low. Lists read the language's lines
// (`ctx.language.lines`); a screen that needs a few passages' records reads
// them in (`withPassages`). So nothing in the app loops over a map of passage
// records, or calls one of core's answers about every passage, unless ALLOWED
// lists the file with why the passages it reads are in memory.
//
// The two lists below are core's (`PASSAGE_PARTS` maps, `READS_EVERY_PASSAGE`);
// apps/mobile/test/wholeLanguage.test.ts holds them equal, so a map or an
// answer added to core is added here too.

/** The maps of passage records: core `PASSAGE_PARTS`, by `map`. */
export const PASSAGE_MAPS = [
  'recordings', 'takes', 'submissions', 'responses', 'kindReviews', 'departures', 'undoneDepartures', 'requests',
  'withdrawnRequests', 'withdrawnReviews', 'notes', 'withdrawnNotes', 'studyMarks', 'cardVerses', 'cardCleanUps', 'passageLinks',
  'referencesUsed', 'keyTermLinks', 'releases'
];

/** Core's answers that look at every passage in the state: core `READS_EVERY_PASSAGE`. */
export const READS_EVERY_PASSAGE = [
  'filePlanOf', 'referencedBlobs', 'deriveUploadWork', 'deriveDownloadWork', 'defaultOfflineScope', 'workedBy',
  'deriveMissingBlobs', 'lostFilesView', 'evictableBlobs', 'offlineByUnit', 'offlineSummary',
  'takesLinkingTerm', 'usualTarget', 'updatesFor', 'languageLines', 'languageProgress', 'highlightsFor',
  'unitsAskedOf', 'waitingOn', 'upNext', 'languageReport'
];

/** Files that read every passage, what they read, and why the passages they read are in memory. Paths from the app folder. */
export const ALLOWED = {
  'src/recording/recordingFlow.ts': { reads: ['takes'], why: 'the passage on screen: which of its recordings a take already holds' },
  'src/recording/workspaceModel.ts': { reads: ['kindReviews'], why: "the passage on screen (`unsavedParts`): whether a review of its take already names the draft's parts" },
  'src/passage/passageResources.ts': { reads: ['recordings'], why: "the source audio of the passage's book and chapter, which come into memory with it" },
  'src/sync/lostFilesWords.ts': { reads: ['lostFilesView'], why: "only when no view is given; the alert passes the one worked out from the phone's table" },
  'src/sync/offline.tsx': { reads: ['offlineByUnit'], why: 'passages not kept offline, counted only while they are on screen' },
  'src/keyTerms/model.ts': { reads: ['takesLinkingTerm'], why: 'called with the passages read in for the term (`passagesLinkingTerm`)' },
  'src/passage/sendTarget.ts': { reads: ['usualTarget'], why: "given each passage's reviewers from the lines, it reads no records" },
  'src/sync/useLanguage.ts': { reads: ['languageLines', 'updatesFor'], why: 'on an empty language, before a session opens' },
  'src/templates/bookStructureModel.ts': { reads: ['languageLines'], why: "only when no lines are given (tests); screens pass the language's lines" }
};

const MAPS = new Set(PASSAGE_MAPS);
const EVERY = new Set(READS_EVERY_PASSAGE);
const FIX = "Read the language's lines, or read the passages in with `withPassages` (decisions.md 143); or list the file in ALLOWED in scripts/lint/wholeLanguage.mjs with why its passages are in memory.";

/** The map a member expression names, through `?.`, `!` and parentheses: `s.recordings`, `state?.takes!`. */
function mapOf(node) {
  let n = node;
  while (n && (n.type === 'ChainExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression')) n = n.expression;
  if (n?.type !== 'MemberExpression' || n.computed || n.property.type !== 'Identifier') return null;
  return MAPS.has(n.property.name) ? n.property.name : null;
}

/** The file's path from the app folder (`src/...`, `App.tsx`), or null outside the app. */
function appPath(filename) {
  const at = filename.replace(/\\/g, '/').lastIndexOf('apps/mobile/');
  return at < 0 ? null : filename.replace(/\\/g, '/').slice(at + 'apps/mobile/'.length);
}

const noEveryPassage = {
  meta: {
    type: 'problem',
    docs: { description: 'The app never reads every passage from memory (decisions.md 143).' },
    schema: [],
    messages: {
      reads: '{{name}} reads every passage: {{fix}}',
      stale: 'ALLOWED lists this file as reading {{name}}, and it no longer does: drop it from the list in scripts/lint/wholeLanguage.mjs, so the list stays true.'
    }
  },
  create(context) {
    const path = appPath(context.filename);
    const allowed = new Set((path && ALLOWED[path]?.reads) || []);
    const seen = new Set();
    const read = (node, name) => {
      seen.add(name);
      if (!allowed.has(name)) context.report({ node, messageId: 'reads', data: { name, fix: FIX } });
    };
    return {
      // Object.values(state.recordings), Object.entries(s?.takes ?? {}) and the like.
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' || callee.object.name !== 'Object') return;
        if (!['values', 'entries', 'keys'].includes(callee.property.name)) return;
        let arg = node.arguments[0];
        if (arg?.type === 'LogicalExpression') arg = arg.left;
        const name = arg && mapOf(arg);
        if (name) read(node, name);
      },
      // for (const id in state.takes)
      ForInStatement(node) {
        const name = mapOf(node.right);
        if (name) read(node, name);
      },
      // import { languageLines } from '@langquest-next/core' (values only; types are fine).
      ImportDeclaration(node) {
        if (node.source.value !== '@langquest-next/core' || node.importKind === 'type') return;
        for (const s of node.specifiers) {
          if (s.type === 'ImportSpecifier' && s.importKind !== 'type' && EVERY.has(s.imported.name)) read(s, s.imported.name);
        }
      },
      'Program:exit'(node) {
        for (const name of allowed) if (!seen.has(name)) context.report({ node, loc: { line: 1, column: 0 }, messageId: 'stale', data: { name } });
      }
    };
  }
};

export default { rules: { 'no-every-passage': noEveryPassage } };
