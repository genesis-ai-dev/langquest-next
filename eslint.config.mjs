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

const D104 = 'decisions.md 104';
const D105 = 'decisions.md 105';

/** Supabase lives in apps/mobile/src/server (decisions.md 105). */
const noSupabase = {
  paths: [{ name: '@supabase/supabase-js', allowTypeImports: true, message: `Call a function in src/server instead; types are fine (${D105}).` }],
  patterns: [{ regex: '(^|/)server/supabase$', message: `Only src/server talks to Supabase: add a function there (${D105}).` }]
};
/** A package is used through its entry, never its files. */
const noDeepPackage = { regex: '^@langquest-next/[^/]+/', message: 'Import the package, not its files: export what you need from its index.' };
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

/** The design system: it knows i18n, help mode (badges in the kit) and the flow's screen ids, and no feature. */
const uiLayer = {
  patterns: [{ regex: '^\\.\\./(?!ui/|i18n(/|$)|helpMode/|shell/flow$)', message: `src/ui is the design system: features use it, not the other way round (${D105}).` }]
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
const ROLE = 'decisions.md 105, docs/merging-onto-the-restructure.md';
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
  mayNotImport('screen', ['screen'], 'A screen does not import another screen: move what both need into a component, hook or model'),
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
    files: [APP, 'apps/mobile/App.tsx', 'packages/*/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, boundaries, '@typescript-eslint': tseslint.plugin },
    // Older comments silence react-hooks/exhaustive-deps, which is not on yet (55 effects to
    // review): an unused one is not reported.
    linterOptions: { reportUnusedDisableDirectives: 'off' }
  },
  // React's rules for hooks: a hook called conditionally or from a plain function is a bug.
  { files: [APP, 'apps/mobile/App.tsx'], rules: { 'react-hooks/rules-of-hooks': 'error' } },
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
  { files: [APP], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noScreens) } },
  { files: ['apps/mobile/src/screens/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noStorage) } },
  { files: ['apps/mobile/src/server/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': restrict(noDeepPackage, serverLayer) } },
  { files: ['apps/mobile/src/ui/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noScreens, uiLayer) } },
  { files: ['apps/mobile/App.tsx'], rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage) } },
  { files: MODELS, rules: { 'no-restricted-imports': restrict(noSupabase, noDeepPackage, noScreens, pure) } },

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
