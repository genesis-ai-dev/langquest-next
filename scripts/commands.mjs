#!/usr/bin/env node
// Every root npm script, grouped, with one line each. package.json cannot
// hold comments, so the words live here and package.json lists the scripts
// in the same order (scripts/commands.test.ts holds both).
//
//   npm run help             every script, by group
//   npm run help -- deploy   only those whose name or line mentions "deploy"
//
// Most take more arguments after `--`; the file a script runs says which.

/** @type {{ title: string, scripts: Record<string, string> }[]} */
export const GROUPS = [
  {
    title: 'Every day',
    scripts: {
      help: 'this list',
      dev: 'the whole local stack: Supabase, then the web Worker on :8787 until Ctrl-C',
      app: 'Metro for the dev client (apps/mobile)',
      'web:dev': 'only the web Worker on :8787 (Reports, the API, the job container)',
      'admin:dev': 'the ops dashboard Worker on :8791 (docs/admin.md)',
      'db:start': 'local Supabase, the scheduled jobs and the library',
      'db:stop': 'stop local Supabase',
      'db:reset': 'wipe the local database, migrate and set it up again',
    },
  },
  {
    title: 'Checks and tests',
    scripts: {
      guardrails: 'what CI checks, before a push (-- --web, -- --all)',
      typecheck: 'every TypeScript project',
      lint: 'what may import what (eslint.config.mjs)',
      test: 'unit, property and model tests (vitest)',
      'test:coverage': 'the same, held to the coverage thresholds',
      'test:integration': 'two real users syncing through local Supabase',
      'test:old-sync': "each store build's sync test against this branch's database, when it changes a migration (-- --always)",
      'db:test': 'migrations on a fresh database, the SQL smokes and SQL-to-core parity',
      'test:web-smoke': 'the release web export in Chromium, Firefox and WebKit',
      'test:ui:web': 'the UI test suite on the web export (Playwright)',
      'test:ui:phone': 'the UI test suite on a simulator or emulator (Maestro)',
      'test:ui:build': 'the release app build the phone flows run on',
      'test:mutation': 'mutation testing over packages/core (Stryker, slow)',
      'server-calls': 'every server call that a supported store build makes is still on the server',
    },
  },
  {
    title: 'Ship and deploy',
    scripts: {
      ship: 'the mobile app on preview: an update, a native build, or --check (apps/mobile/README.md)',
      'db:check': 'hosted migrations against this branch (-- --diff for the live schema)',
      'db:apply': 'push migrations to the linked hosted project',
      'web:deploy': 'the app Worker, production (Cloudflare Workers Builds runs it)',
      'web:deploy:preview': 'the app Worker, preview (Cloudflare Workers Builds runs it)',
      'email:deploy': 'the invite email Worker, production (Cloudflare Workers Builds runs it)',
      'email:deploy:preview': 'the invite email Worker, preview (Cloudflare Workers Builds runs it)',
      'admin:deploy': 'the ops dashboard Worker, production (Cloudflare Workers Builds runs it)',
      'r2:buckets': "create an environment's R2 buckets when missing",
      'github:rules': 'the GitHub rulesets in .github/rulesets: what would change (-- --apply to apply)',
    },
  },
  {
    title: 'Environments and secrets (docs/environments.md)',
    scripts: {
      'env:doctor': "this machine's env setup, for a new teammate",
      'env:check': 'no plaintext secret or misplaced key in committed env files',
      'env:update': 'change one setting or secret in its file and commit it',
      'env:eas': 'compare or push an EAS environment to its committed file',
      secrets: "apply one environment's secrets to Cloudflare and Supabase",
    },
  },
  {
    title: 'Data and support',
    scripts: {
      diag: 'field diagnostics: a person, a language, an error code, the server jobs',
      moderation: 'open content reports, and acting on them',
      'global-viewer': 'Global Viewers: grant on a call, revoke, reset a lost authenticator, list (docs/global-viewers.md)',
      'org-verification': "organizations' blue checks: list requests, grant, decline, revoke (docs/verified-organizations.md)",
      'publisher-import': "importers for organizations' own material: list, grant, revoke, step (docs/publisher-imports.md)",
      v2: 'the LangQuest v2 import: the board, a sync, a dry run',
      'library:seed': "publish the LangQuest organization's library",
      'sample:org': 'a sample organization the team can join',
      'ui:fixture': "the UI test suite's fixture world, on the local server",
      languoids: 'the languoid explorer, preview and apply',
      'help-audio': "help mode's recorded voice: the lines to record, the upload",
      snapshot: 'one snapshot pass over every language',
      reconcile: 'confirm uploaded files in R2 (-- --verify hashes them)',
      'listening:demo': "a local stand-in for LangQuest's partner API (decision 109)",
    },
  },
  {
    title: 'Performance',
    scripts: {
      fleet: 'a fleet of phones on simulated time (docs/fleet-simulation.md)',
      'fleet:baselines': 'every fleet scenario, into docs/fleet-baselines.md',
      'bench:core': 'the fold, the views and snapshots in core',
      'bench:kept': 'passage lines of a language kept on disk',
      'bench:server': "the server's SQL against the local database",
    },
  },
  {
    title: 'Build steps (other scripts and the git hooks run these)',
    scripts: {
      prepare: 'turn on the git hooks in .githooks (npm install runs it)',
      'build:push-delivery': 'bundle the push-delivery Edge Function into supabase/functions',
      'build:jobs': "bundle the job runner's jobs into apps/web/jobs/dist",
      'build:explorer': 'bundle the languoid explorer globe into apps/mobile/public',
      'email:typecheck': 'the invite email Worker, with its generated types',
    },
  },
];

function print(filter) {
  const needle = filter?.toLowerCase();
  const width = Math.max(...GROUPS.flatMap((g) => Object.keys(g.scripts).map((n) => n.length)));
  for (const group of GROUPS) {
    const rows = Object.entries(group.scripts).filter(
      ([name, line]) => !needle || name.includes(needle) || line.toLowerCase().includes(needle),
    );
    if (rows.length === 0) continue;
    console.log(`\n${group.title}`);
    for (const [name, line] of rows) console.log(`  npm run ${name.padEnd(width)}  ${line}`);
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) print(process.argv[2]);
