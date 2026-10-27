// What depends on what (decisions.md 104, 105), held by ESLint: the
// architecture only, no style. `npm run lint`; CI and pre-push run it.
//
// no-restricted-imports does not merge across blocks: the last block that
// matches a file decides. So each kind of file gets one block with its whole
// list, built from the lists below, and blocks go from general to specific.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import boundaries from 'eslint-plugin-boundaries';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import wholeLanguage from './scripts/lint/wholeLanguage.mjs';

const D104 = 'decisions.md 104';
const D105 = 'decisions.md 105';

/** Code that runs beside the app (servers, the Worker, jobs, the admin page, the importer): held to one rule, not the app's. */
const OUTSIDE = ['server/**/*.ts', 'apps/web/worker/**/*.ts', 'apps/web/jobs/**/*.ts', 'apps/admin/src/**/*.ts', 'packages/v2-import/src/**/*.ts'];
const outsideTheApp = {
  patterns: [
    { regex: '(^|/)packages/[^/]+/src(/|$)', message: 'Import the package (@langquest-next/core, @langquest-next/sync, or @langquest-next/sync/server for server jobs), not its files.' },
    { regex: '(^|/)apps/mobile/src(/|$)', message: 'Put shared code in packages/core: only the app imports apps/mobile/src.' }
  ]
};

/** Supabase lives in apps/mobile/src/server (decisions.md 105). */
const noSupabase = {
  paths: [{ name: '@supabase/supabase-js', allowTypeImports: true, message: `Call a function in src/server instead; types are fine (${D105}).` }],
  patterns: [{ regex: '(^|/)server/supabase$', message: `Only src/server talks to Supabase: add a function there (${D105}).` }]
};
/** A package is used through its entry, never its files. */
const noDeepPackage = { regex: '^@langquest-next/[^/]+/', message: 'Import the package, not its files: export what you need from its index.' };
/** Icons come one file each through src/ui/icons: lucide's own entry brings every icon it has. */
const noIconBarrel = {
  paths: [{ name: 'lucide-react-native', allowTypeImports: true, message: 'Import icons from src/ui/icons, which takes each from its own file: the package itself brings all 1,800-odd (1.5 MB on the web).' }]
};
/** Only App.tsx and the screens themselves import a screen file. */
const noScreens = { regex: '(^|/)screens/', message: `Screens are entry points: move what you need into a feature module (${D105}).` };
/** Screens lay out; storage sits behind a hook or module. */
const noStorage = {
  paths: ['@react-native-async-storage/async-storage', 'expo-sqlite', 'expo-file-system'].map((name) => ({
    name, message: `A screen lays out: keep storage in a hook or module beside the feature (${D105}).`
  })),
  patterns: [{ regex: '^(\\.\\./)+(sync/)?store$', message: `A screen lays out: keep the event store in a hook or module (${D105}).` }]
};
/** A model is pure: no React, no platform, no I/O, so it is tested without rendering. */
const pure = {
  paths: [
    ...['react', '@langquest-next/sync'].map((name) => ({ name, allowTypeImports: true, message: `A model is pure: no React or sync engine; types are fine (${D105}).` })),
    ...['react-native', '@react-native-async-storage/async-storage'].map((name) => ({ name, message: `A model is pure: no platform or storage (${D105}).` }))
  ],
  patterns: [
    { regex: '^expo(-|$)', message: `A model is pure: no Expo modules (${D105}).` },
    { regex: '(^|/)server/', message: `A model is pure: call the server from a hook or module, not a model (${D105}).` },
    { regex: '(^|/)(store|blobs|kit|SyncIndicator)$', allowTypeImports: true, message: `A model is pure: no storage, files or UI; types are fine (${D105}).` },
    { regex: '(^|/)use[A-Z][A-Za-z]*$', allowTypeImports: true, message: `A model is pure: hooks call models, not the other way round; types are fine (${D105}).` }
  ]
};
/** The server folder is the bottom of the app: it knows nothing of screens or React. */
const serverLayer = {
  paths: [{ name: 'react', message: `src/server holds plain calls, no React (${D105}).` }],
  patterns: [{ regex: '(^|/)(screens|shell|ui)/|(^|/)kit$', message: `src/server sits below screens, the shell and the UI (${D105}).` }]
};

/**
 * The base layer under the feature folders (decisions.md 105): what every feature
 * stands on. A base folder imports, as values, only base folders at its own level
 * or below, so the features can import each other and the base can still not
 * reach back into them. Types may come from anywhere. Lowest first:
 *   L0 i18n (the app's words), build (which build this is)
 *   L1 ui (the design system), helpMode (help badges and spoken help)
 *   L2 session (who is signed in, read-only), storage (the on-device database,
 *      stored files)
 *   L3 diagnostics (the recorder and its reports)
 *   L4 server (Supabase calls)
 * Features import any of them. What a lower layer needs from a higher one is
 * handed in at start (shell/wiring.ts) or sits in the lower layer.
 */
const BASE_LAYERS = [['i18n', 'build'], ['ui', 'helpMode'], ['session', 'storage'], ['diagnostics'], ['server']];
const LAYER_NAMES = BASE_LAYERS.map((folders, i) => `L${i} ${folders.join(', ')}`).join('; ');
const BASE_FOLDERS = BASE_LAYERS.flat();
const layerOf = (folder) => {
  const level = BASE_LAYERS.findIndex((folders) => folders.includes(folder));
  const allowed = BASE_LAYERS.slice(0, level + 1).flat();
  return {
    patterns: [{
      regex: `^\\.\\./(?!(?:${allowed.join('|')})(?:/|$))`,
      allowTypeImports: true,
      message: `src/${folder} is base layer L${level} (${D105}): ${LAYER_NAMES}. `
        + `It imports values only from ${allowed.join(', ')}; a feature folder is above it (hand it in at start, shell/wiring.ts), types are fine.`
    }]
  };
};

const restrict = (...parts) => ['error', {
  paths: parts.flatMap((p) => p.paths ?? []),
  patterns: parts.flatMap((p) => p.patterns ?? (p.regex ? [p] : []))
}];

const APP = 'apps/mobile/src/**/*.{ts,tsx}';
const MODELS = ['apps/mobile/src/**/model.{ts,tsx}', 'apps/mobile/src/**/*Model.{ts,tsx}'];
const HOOKS = 'apps/mobile/src/**/use[A-Z]*.{ts,tsx}';

// ---- each file one role (decisions.md 105) --------------------------------------------
//
// A file's name says its role, and the role says what it may export and import:
//   screen     screens/*.tsx         one screen (and its `contracts`)
//   component  other *.tsx           components only
//   hook       use<Thing>.ts(x)      hooks only (and the contexts they read)
//   model      model.ts, <x>Model.ts pure functions and types
//   server     server/*              Supabase calls
//   module     other *.ts            anything else: no hooks, no JSX
// Types may be imported from anywhere; the rules below are about values.
const ROLE = 'decisions.md 105';
const roleFiles = [
  { category: 'screen', pattern: 'apps/mobile/src/screens/*.tsx', stopMatching: true },
  { category: 'server', pattern: 'apps/mobile/src/server/**', stopMatching: true },
  { category: 'model', pattern: MODELS, stopMatching: true },
  { category: 'hook', pattern: HOOKS, stopMatching: true },
  { category: 'component', pattern: 'apps/mobile/src/**/*.tsx', stopMatching: true },
  { category: 'module', pattern: 'apps/mobile/src/**/*.ts', stopMatching: true }
];
/** Value imports a role may not make, and what to do instead. */
const mayNotImport = (from, to, message) => ({
  from: { file: { categories: from } },
  disallow: { to: { file: { categories: { anyOf: to } } }, dependency: { kind: 'value' } },
  message: `${message} (${ROLE}).`
});
const rolePolicies = [
  mayNotImport('screen', ['screen', 'server'], 'A screen does not import another screen or the server: move what both need into a component, hook or model, and call the server through a hook or module'),
  mayNotImport('component', ['screen', 'server'], 'A component calls the server through a hook or module, and never imports a screen'),
  mayNotImport('hook', ['screen', 'component'], 'A hook does not import components: return data, and let the component draw it'),
  mayNotImport('model', ['screen', 'component', 'hook', 'server'], 'A model is pure: no components, hooks or server calls'),
  mayNotImport('module', ['screen', 'component', 'hook'], 'A module does not import components or hooks: a hook may call the module instead'),
  mayNotImport('server', ['screen', 'component', 'hook'], 'src/server holds plain calls: no components or hooks')
];
const HOOK_EXPORT = '/^(use[A-Z]|[A-Z]\\w*Context$)/';
const hookExportsOnly = [
  `ExportNamedDeclaration > FunctionDeclaration[id.name!=${HOOK_EXPORT}]`,
  `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name!=${HOOK_EXPORT}]`,
  'ExportNamedDeclaration > ClassDeclaration', 'ExportNamedDeclaration > TSEnumDeclaration', 'ExportDefaultDeclaration',
  `ExportNamedDeclaration[exportKind!='type'] > ExportSpecifier[exportKind!='type'][exported.name!=${HOOK_EXPORT}]`
].map((selector) => ({ selector, message: `A use<Thing> file exports hooks (and the contexts they read) only: put this in a module or model beside it (${ROLE}).` }));
const noHookExports = [
  'ExportNamedDeclaration > FunctionDeclaration[id.name=/^use[A-Z]/]',
  'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=/^use[A-Z]/]',
  'ExportSpecifier[exported.name=/^use[A-Z]/]'
].map((selector) => ({ selector, message: `A hook lives in a use<Thing> file of its own: move it there (${ROLE}).` }));

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/dist-sourcemaps/**', '**/build/**', '**/coverage/**', '.claude/**',
      'apps/mobile/android/**', 'apps/mobile/ios/**', 'supabase/functions/**', 'e2e/results/**'
    ]
  },
  {
    files: [APP, 'apps/mobile/App.tsx', 'packages/*/src/**/*.ts', ...OUTSIDE],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: {
      'react-hooks': reactHooks, 'react-refresh': reactRefresh, boundaries, '@typescript-eslint': tseslint.plugin,
      '@eslint-community/eslint-comments': eslintComments
    },
    // core's generated data files carry a blanket disable from their generator.
    linterOptions: { reportUnusedDisableDirectives: 'off' }
  },
  // In the app a disable comment that no longer excuses anything is an error: it goes.
  { files: [APP, 'apps/mobile/App.tsx'], linterOptions: { reportUnusedDisableDirectives: 'error' } },
  // React's rules for hooks: a hook called conditionally or from a plain function is a bug, and so
  // is one that reads a value it does not list (it keeps the value from the draw it first ran in).
  // Where a hook means to list less or more, the disable comment says why after `--`.
  {
    files: [APP, 'apps/mobile/App.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@eslint-community/eslint-comments/require-description': 'error'
    }
  },
  // An import only for types says so (`import type`), so the role rules below see it as one.
  {
    files: [APP, 'apps/mobile/App.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      '@typescript-eslint/no-import-type-side-effects': 'error'
    }
  },

  // Core says what the data means: pure TypeScript, nothing imported.
  { files: ['packages/core/src/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\.)', message: 'packages/core is pure: no I/O and no dependencies (AGENTS.md).' }] }] } },
  // Sync keeps and moves it: core, supabase-js and its own files; a platform comes in as an argument.
  { files: ['packages/sync/src/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\.|@langquest-next/core$|@supabase/supabase-js$)', message: `packages/sync imports only core, supabase-js and its own files: pass the platform in (${D104}).` }] }] } },
  { files: ['packages/sync/src/testing/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\.|node:|@langquest-next/core$|@supabase/supabase-js$)', message: `packages/sync/src/testing runs in Node: its own files, core, supabase-js and Node built-ins (${D104}).` }] }] } },

  // The app, general to specific.
  { files: OUTSIDE, rules: { 'no-restricted-imports': ['error', outsideTheApp] } },
  { files: [APP], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel, noScreens) } },
  { files: ['apps/mobile/src/screens/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel, noStorage) } },
  // The base folders: the app's general rules, and the layer they sit in.
  ...BASE_FOLDERS.filter((f) => f !== 'server').map((f) => ({
    files: [`apps/mobile/src/${f}/**/*.{ts,tsx}`], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel, noScreens, layerOf(f)) }
  })),
  { files: ['apps/mobile/src/server/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': restrict(noDeepPackage, noIconBarrel, serverLayer, layerOf('server')) } },
  { files: ['apps/mobile/App.tsx'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel) } },
  { files: MODELS, rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel, noScreens, pure) } },
  // A model in a base folder is pure and in its layer: the last block decides, so it has both.
  ...BASE_FOLDERS.map((f) => ({
    files: MODELS.map((m) => m.replace('src/**/', `src/${f}/**/`)), rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noIconBarrel, noScreens, pure, layerOf(f)) }
  })),
  // The one file that may name lucide's files.
  { files: ['apps/mobile/src/ui/icons.ts'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noScreens, layerOf('ui')) } },

  // A language kept on disk holds only the passages on screen: the app never reads every passage from
  // memory, but where the list in scripts/lint/wholeLanguage.mjs says why it may (decisions.md 143).
  { files: [APP, 'apps/mobile/App.tsx'], plugins: { 'whole-language': wholeLanguage }, rules: { 'whole-language/no-every-passage': 'error' } },

  // Each file one role: what it may import (by role) and what it may export.
  {
    files: [APP],
    settings: {
      'boundaries/include': ['apps/mobile/src/**/*'],
      'boundaries/elements': [{ type: 'feature', pattern: 'apps/mobile/src/*', capture: ['feature'] }],
      'boundaries/files': roleFiles,
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.web.ts', '.web.tsx', '.js', '.json'] } }
    },
    rules: { 'boundaries/dependencies': ['error', { checkInternals: true, default: 'allow', policies: rolePolicies }] }
  },
  { files: ['apps/mobile/src/**/*.tsx'], ignores: [HOOKS], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true }] } },
  { files: ['apps/mobile/src/screens/*.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['contracts'] }] } },
  { files: [HOOKS], rules: { 'no-restricted-syntax': ['error', ...hookExportsOnly] } },
  { files: ['apps/mobile/src/**/*.ts'], ignores: [HOOKS], rules: { 'no-restricted-syntax': ['error', ...noHookExports] } }
];
