import { readFileSync, readdirSync } from 'node:fs';

import { parseJsonc, wranglerFor } from './env-files.mjs';
import {
  ADMIN_KEYS, CRON_JOB, EAS_KEYS, EAS_PROJECT, HYPERDRIVE_PLACEHOLDER, ONLY, createdId, hyperdriveId, withHyperdriveId, FILE_KEYS, OPTIONAL_KEYS, PUSH_FUNCTION, REQUIRED_KEYS, RETIRED_FUNCTION_SECRETS, RETIRED_JOB, SCHEDULE_MIGRATION, WEBHOOK_MIGRATION, WORKERS, destinations, digest, drift, easNames, failure, hyperdriveGone, parseArgs, queryRows, relayUrl, secretListFailure, summarize, unknownKeys, unreadable, vaultSql, workersIn
} from './secrets.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const values = { INVITE_RELAY_SECRET: 'relay', PUSH_DELIVERY_SECRET: 'push' };

describe('secrets', () => {
  it('sets exactly the secrets each Worker requires, so a deploy never stops for one', () => {
    for (const env of ['production', 'preview']) {
      const wanted = destinations(env, { ...values, DIAG_DATABASE_URL: 'postgresql://diag' }, 'ref', 'service');
      for (const [worker, config] of Object.entries(workersIn(env))) {
        const required = wranglerFor(parseJsonc(read(config as string)), env).secrets?.required ?? [];
        // A Worker that requires none (the ops dashboard, with no provider token in the file) gets none.
        const given = (wanted.workers as Record<string, Record<string, string>>)[worker] ?? {};
        expect(Object.keys(given).sort(), `${worker} ${env}`).toEqual([...required].sort());
      }
    }
  });

  it("gives the ops dashboard the tokens the file has, and diag_reader's login to Hyperdrive, never to the Worker, and only in production", () => {
    const file = { ...values, DIAG_DATABASE_URL: 'postgresql://diag', ADMIN_EXPO_TOKEN: 'e', ADMIN_GITHUB_TOKEN: '' };
    const production = destinations('production', file, 'ref', 'service');
    expect(production.workers.admin).toEqual({ ADMIN_EXPO_TOKEN: 'e' });
    expect(production.hyperdrive).toEqual({ connectionString: 'postgresql://diag' });
    expect(destinations('preview', file, 'ref', 'service').workers).not.toHaveProperty('admin');
    expect(destinations('preview', file, 'ref', 'service').hyperdrive).toBeNull();
    expect(destinations('production', { ...values, DIAG_DATABASE_URL: 'postgresql://diag' }, 'ref', 'service').workers).not.toHaveProperty('admin');
    for (const key of ADMIN_KEYS) {
      expect(FILE_KEYS).toContain(key);
      expect(wranglerFor(parseJsonc(read(WORKERS.admin)), 'production').secrets?.required ?? []).not.toContain(key);
    }
  });

  it('passes the Bible Brain key to the app\'s Worker only when the file has it, and never requires it', () => {
    const withKey = destinations('production', { ...values, BIBLE_BRAIN_ACCESS_KEY: 'bb' }, 'ref', 'service');
    expect(withKey.workers.app).toEqual({ SUPABASE_SERVICE_ROLE_KEY: 'service', BIBLE_BRAIN_ACCESS_KEY: 'bb' });
    expect(destinations('production', { ...values, BIBLE_BRAIN_ACCESS_KEY: '' }, 'ref', 'service').workers.app).toEqual({ SUPABASE_SERVICE_ROLE_KEY: 'service' });
    for (const key of OPTIONAL_KEYS) {
      expect(FILE_KEYS).toContain(key);
      expect(REQUIRED_KEYS).not.toContain(key);
      for (const env of ['production', 'preview']) expect(wranglerFor(parseJsonc(read(WORKERS.app)), env).secrets?.required ?? []).not.toContain(key);
    }
  });

  it('sets every secret an Edge Function reads, except the ones Supabase sets itself', () => {
    // Every function folder, and the `_shared` code they import.
    // Folders only: the ignored local `.env` (scripts/local-db.mjs) sits beside them.
    const names = readdirSync(new URL('../supabase/functions', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      .flatMap((dir) => readdirSync(new URL(`../supabase/functions/${dir}`, import.meta.url))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => `supabase/functions/${dir}/${file}`))
      .flatMap((file) => [...read(file).matchAll(/Deno\.env\.get\(['"]([A-Z0-9_]+)['"]\)/g)].map((m) => m[1]))
      .filter((name) => !name.startsWith('SUPABASE_') && !RETIRED_FUNCTION_SECRETS.includes(name));
    expect(Object.keys(destinations('production', { ...values, V2_SUPABASE_ANON_KEY: 'v2' }, 'ref', 'k').functions).sort()).toEqual([...new Set(names)].sort());
    // Without v2's key, signing in with a v2 account is simply not set up.
    expect(destinations('production', values, 'ref', 'k').functions).not.toHaveProperty('V2_SUPABASE_ANON_KEY');
  });

  it('unsets a retired function secret without the CLI\'s prompt, which unsets nothing when unanswered', () => {
    // Why: `npm run secrets -- production` left PROJECTION_WORKER_SECRET set twice (2026-10-20).
    expect(read('scripts/secrets.mjs')).toMatch(/run\('supabase', \['secrets', 'unset', '--yes',/);
  });

  it('writes the Vault names the push delivery job reads, and the schedule leaves the pass off pg_cron', () => {
    const sql = read(SCHEDULE_MIGRATION);
    const { vault } = destinations('preview', values, 'abc', 'k');
    for (const name of Object.keys(vault)) expect(sql).toMatch(new RegExp(`name\\s*=\\s*'${name}'`));
    expect(vault.langquest_project_url).toBe('https://abc.supabase.co');
    // Why: the pass runs in the Worker's job container, hosted and local (decisions.md 141, 148);
    // a pg_cron pass as well would run it twice, racing the container's writes.
    expect(sql).toMatch(new RegExp(`cron\\.unschedule[\\s\\S]*'${RETIRED_JOB}'`));
    expect(sql).not.toMatch(new RegExp(`cron\\.schedule\\(\\s*'${RETIRED_JOB}'`));
    // Push delivery calls its own function (decisions.md 148), under the name npm run secrets checks.
    expect(sql).toMatch(new RegExp(`cron\\.schedule\\(\\s*'${CRON_JOB}'[\\s\\S]*'${PUSH_FUNCTION}'`));
    expect(sql).not.toMatch(/functions\/v1\/stream-projections/);
  });

  it('gives the app\'s Worker v2\'s keys for the import\'s job, only when the file has them', () => {
    const wanted = destinations('production', { ...values, V2_SUPABASE_ANON_KEY: 'v2', V2_DATABASE_URL: 'postgres://ro' }, 'ref', 'k');
    expect(wanted.workers.app).toMatchObject({ V2_SUPABASE_ANON_KEY: 'v2', V2_DATABASE_URL: 'postgres://ro' });
    expect(Object.keys(destinations('production', values, 'ref', 'k').workers.app)).not.toContain('V2_DATABASE_URL');
    expect(OPTIONAL_KEYS).toContain('V2_DATABASE_URL');
    // The YouTube OAuth client goes to the app's Worker as a pair, never one alone.
    const client = { YOUTUBE_CLIENT_ID: 'id.apps.googleusercontent.com', YOUTUBE_CLIENT_SECRET: 'secret' };
    expect(destinations('production', { ...values, ...client }, 'ref', 'k').workers.app).toMatchObject(client);
    expect(Object.keys(destinations('production', { ...values, YOUTUBE_CLIENT_ID: 'id' }, 'ref', 'k').workers.app)).not.toContain('YOUTUBE_CLIENT_ID');
  });

  it('gives the app\'s Worker Linear\'s key when the file has it, and never the Gemini key or the Claude token', () => {
    const all = { ...values, GEMINI_API_KEY: 'g', LINEAR_API_KEY: 'lin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-oat' };
    expect(destinations('production', all, 'ref', 'k').workers.app).toMatchObject({ LINEAR_API_KEY: 'lin' });
    expect(Object.keys(destinations('production', all, 'ref', 'k').workers.app)).not.toContain('GEMINI_API_KEY');
    expect(Object.keys(destinations('production', all, 'ref', 'k').workers.app)).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(Object.keys(destinations('production', values, 'ref', 'k').workers.app)).not.toContain('LINEAR_API_KEY');
    expect(OPTIONAL_KEYS).toContain('LINEAR_API_KEY');
  });

  it('gives the app\'s Worker the nearby signing key when the file has it, and nowhere else; a deploy never waits for it', () => {
    const wanted = destinations('production', { ...values, NEARBY_SIGNING_KEY: '{"kid":"k1"}' }, 'ref', 'k');
    expect(wanted.workers.app).toMatchObject({ NEARBY_SIGNING_KEY: '{"kid":"k1"}' });
    expect(JSON.stringify({ ...wanted, workers: { ...wanted.workers, app: {} } })).not.toContain('NEARBY_SIGNING_KEY');
    expect(Object.keys(destinations('preview', values, 'ref', 'k').workers.app)).not.toContain('NEARBY_SIGNING_KEY');
    expect(OPTIONAL_KEYS).toContain('NEARBY_SIGNING_KEY');
    expect(read('apps/web/wrangler.jsonc')).not.toMatch(/"required": \[[^\]]*NEARBY_SIGNING_KEY/);
  });

  it('gives GitHub the Gemini key for the nightly filming and the Claude token for the nightly look and frame check, from production\'s file only, and nothing else', () => {
    expect(destinations('production', { ...values, GEMINI_API_KEY: 'g' }, 'ref', 'k').github).toEqual({ GEMINI_API_KEY: 'g' });
    expect(destinations('production', { ...values, GEMINI_API_KEY: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'sk-oat' }, 'ref', 'k').github)
      .toEqual({ GEMINI_API_KEY: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'sk-oat' });
    expect(destinations('preview', { ...values, GEMINI_API_KEY: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'sk-oat' }, 'ref', 'k').github).toEqual({});
    expect(destinations('production', values, 'ref', 'k').github).toEqual({});
    expect(read('.github/workflows/tutorials.yml')).toContain('secrets.GEMINI_API_KEY');
    expect(read('.github/workflows/tutorial-review.yml')).toContain('secrets.CLAUDE_CODE_OAUTH_TOKEN');
    expect(read('.github/workflows/tutorials.yml')).toContain('CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    expect(FILE_KEYS).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('gives GitHub the Bible Brain key for the survey of its numberings, and the app\'s Worker keeps it too', () => {
    const wanted = destinations('production', { ...values, BIBLE_BRAIN_ACCESS_KEY: 'bb' }, 'ref', 'k');
    expect(wanted.github).toEqual({ BIBLE_BRAIN_ACCESS_KEY: 'bb' });
    expect(wanted.workers.app).toMatchObject({ BIBLE_BRAIN_ACCESS_KEY: 'bb' });
    expect(destinations('preview', { ...values, BIBLE_BRAIN_ACCESS_KEY: 'bb' }, 'ref', 'k').github).toEqual({});
    expect(read('.github/workflows/bible-survey.yml')).toContain('secrets.BIBLE_BRAIN_ACCESS_KEY');
  });

  it('gives EAS the store keys for the App Review and Play review steps, from production\'s file only, and no other system gets them', () => {
    const all = { ...values, APP_STORE_REVIEW_KEY: '{"issuerId":"i"}', PLAY_REVIEW_KEY: '{"client_email":"c"}', GEMINI_API_KEY: 'g' };
    const production = destinations('production', all, 'ref', 'k');
    expect(production.eas).toEqual({ APP_STORE_REVIEW_KEY: '{"issuerId":"i"}', PLAY_REVIEW_KEY: '{"client_email":"c"}' });
    expect(destinations('preview', all, 'ref', 'k').eas).toEqual({});
    expect(destinations('production', values, 'ref', 'k').eas).toEqual({});
    const elsewhere = [production.github, production.functions, production.vault, ...Object.values(production.workers)];
    for (const place of elsewhere) for (const key of EAS_KEYS) expect(Object.keys(place)).not.toContain(key);
    for (const key of EAS_KEYS) {
      expect(FILE_KEYS).toContain(key);
      expect(REQUIRED_KEYS).not.toContain(key);
    }
    // The EAS project is the app's, and its workflows read the key in EAS's production environment.
    expect(JSON.parse(read(`${EAS_PROJECT}/app.json`)).expo.extra.eas.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(read(`${EAS_PROJECT}/.eas/workflows/app-store-review.yml`)).toContain('environment: production');
  });

  it('reads the names, never the values, from what eas env:list prints', () => {
    const printed = '\u001b[1mEnvironment: production\u001b[22m\n'
      + '\u001b[1mEXPO_PUBLIC_SUPABASE_URL\u001b[22m=https://x.supabase.co\n'
      + "APP_STORE_REVIEW_KEY=***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)\n"
      + 'not a variable\n';
    expect(easNames(printed)).toEqual(['EXPO_PUBLIC_SUPABASE_URL', 'APP_STORE_REVIEW_KEY']);
    expect(easNames('Environment: production\nNo variables found for this environment.\n')).toEqual([]);
  });

  it('takes --check or --yes, and --only eas to apply EAS alone, and flags anything else', () => {
    expect(parseArgs(['production'])).toEqual({ environment: 'production', check: false, yes: false, only: null, unknown: null });
    expect(parseArgs(['production', '--only', 'eas', '--check'])).toMatchObject({ only: 'eas', check: true, unknown: null });
    expect(parseArgs(['production', '--only=eas', '--yes'])).toMatchObject({ only: 'eas', yes: true, unknown: null });
    expect(parseArgs(['production', '--only'])).toMatchObject({ only: '' });
    expect(parseArgs(['preview', '--force'])).toMatchObject({ unknown: '--force' });
    expect(ONLY).toEqual(['eas']);
    expect(read('scripts/commands.mjs')).toContain('secrets');
  });

  it('reports a missing EAS secret as behind, and no cron job when only EAS was compared', () => {
    expect(summarize({ eas: { APP_STORE_REVIEW_KEY: 'set' } })).toEqual({
      lines: ['  ✓ EAS secret APP_STORE_REVIEW_KEY (set; its value cannot be read back)'], behind: false
    });
    expect(summarize({ eas: { APP_STORE_REVIEW_KEY: 'missing' } })).toEqual({
      lines: ['  + EAS secret APP_STORE_REVIEW_KEY (missing)'], behind: true
    });
  });

  it('gives the webhook poke one secret at both ends and the Worker\'s own address, only when the file has it', () => {
    const sql = read(WEBHOOK_MIGRATION);
    const wanted = destinations('preview', { ...values, WEBHOOK_POKE_SECRET: 'poke' }, 'abc', 'k');
    expect(wanted.vault.langquest_webhook_poke_secret).toBe(wanted.workers.app.WEBHOOK_POKE_SECRET);
    expect(wanted.vault.langquest_dashboard_url).toBe('https://next-preview.langquest.org');
    for (const name of ['langquest_dashboard_url', 'langquest_webhook_poke_secret']) expect(sql).toMatch(new RegExp(`name\\s*=\\s*'${name}'`));
    expect(destinations('production', { ...values, WEBHOOK_POKE_SECRET: 'poke' }, 'abc', 'k').vault.langquest_dashboard_url).toBe('https://next.langquest.org');
    expect(Object.keys(destinations('preview', values, 'abc', 'k').vault)).not.toContain('langquest_webhook_poke_secret');
  });

  it('sends one relay secret to both ends, so they cannot drift apart', () => {
    const wanted = destinations('production', values, 'ref', 'k');
    expect(wanted.workers['invite-email'].INVITE_RELAY_SECRET).toBe(wanted.functions.INVITE_RELAY_SECRET);
  });

  it('points the relay at each environment\'s invite-email Worker', () => {
    const name = (env: string) => (env === 'production' ? '' : `-${env}`);
    for (const env of ['production', 'preview']) {
      expect(relayUrl(env)).toMatch(new RegExp(`^https://${parseJsonc(read(WORKERS['invite-email'])).name}${name(env)}\\.`));
    }
  });

  it('refuses a key it would neither place nor knowingly keep local', () => {
    expect(unknownKeys([...FILE_KEYS, 'STRAY'])).toEqual(['STRAY']);
    for (const key of REQUIRED_KEYS) expect(FILE_KEYS).toContain(key);
  });

  it('compares digests, never values', () => {
    expect(drift({ A: 'x', B: 'y', C: 'z' }, { A: digest('x'), B: digest('other') }))
      .toEqual({ A: 'same', B: 'differs', C: 'missing' });
  });

  it('reports a missing Worker secret or cron job as behind', () => {
    const ok = { workers: { app: { K: 'set' } }, functions: { A: 'same' }, vault: { V: 'same' }, scheduled: true };
    expect(summarize(ok).behind).toBe(false);
    expect(summarize({ ...ok, workers: { app: { K: 'missing' } } }).behind).toBe(true);
    expect(summarize({ ...ok, scheduled: false }).behind).toBe(true);
    expect(summarize({ ...ok, github: { GEMINI_API_KEY: 'set' } }).behind).toBe(false);
    expect(summarize({ ...ok, github: { GEMINI_API_KEY: 'missing' } }).behind).toBe(true);
  });

  it('says when a Worker is not on the account wrangler is signed in to, before its secrets', () => {
    const { lines, behind } = summarize({ workers: { app: { K: 'missing' } }, absent: ['app'], functions: {}, vault: {}, scheduled: true });
    expect(behind).toBe(true);
    expect(lines[0]).toMatch(/app Worker is not on the Cloudflare account wrangler is signed in to \(npx wrangler whoami\)/);
    expect(lines[1]).toMatch(/app Worker secret K \(missing\)/);
  });

  it('reads query rows in either shape the Supabase CLI prints', () => {
    expect(queryRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(queryRows({ boundary: 'x', rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('shows the command\'s own error, not npm\'s notices', () => {
    const stdout = '{"_tag":"Error","error":{"code":"X","message":"--project-ref only applies with --linked"}}\n';
    expect(failure(stdout, 'npm notice run langquest-next@0.0.1 npx\nnpm notice run supabase db query\n'))
      .toBe('--project-ref only applies with --linked');
  });

  it('quotes Vault values so a quote cannot end the literal', () => {
    const sql = vaultSql({ n: "a'b" });
    expect(sql).toContain("vault.create_secret('a''b', 'n')");
    expect(sql).toContain("vault.update_secret(existing, 'a''b')");
  });
});

describe('the ops dashboard\'s Hyperdrive config', () => {
  const config = `{\n  "name": "langquest-next-admin",\n  // diag_reader's login lives in Hyperdrive\n  "hyperdrive": [{ "binding": "DIAG", "id": "${HYPERDRIVE_PLACEHOLDER}" }]\n}\n`;
  const id = '0123456789abcdef0123456789abcdef';

  it('reads no id while the config holds the placeholder, and the id once it is written', () => {
    expect(hyperdriveId(config)).toBeNull();
    expect(hyperdriveId(withHyperdriveId(config, id))).toBe(id);
  });

  it('writes the id over the placeholder only, keeping the comments', () => {
    const written = withHyperdriveId(config, id);
    expect(written).toBe(config.replace(HYPERDRIVE_PLACEHOLDER, id));
    expect(() => withHyperdriveId(config, 'not-an-id')).toThrow(/not a Hyperdrive id/);
    expect(() => withHyperdriveId(written, id)).toThrow(/has no/);
  });

  it('finds the id in what wrangler prints when it makes the config', () => {
    expect(createdId(`✅ Created new Hyperdrive PostgreSQL config: ${id}\n{ "id": "${id}" }`)).toBe(id);
    expect(createdId('nothing here')).toBeNull();
  });

  it('holds the committed config to a placeholder or a real id', () => {
    const committed = read(WORKERS.admin);
    expect(committed).toMatch(new RegExp(`"binding": "DIAG", "id": "(${HYPERDRIVE_PLACEHOLDER}|[0-9a-f]{32})"`));
  });
  it('never hands a value to npx, which writes its arguments to npm\'s debug log on disk (security review, 2026-11-10)', () => {
    const scripts = readdirSync(new URL('../scripts', import.meta.url)).filter((f) => /\.(sh|mjs)$/.test(f));
    for (const file of scripts) {
      const text = read(`scripts/${file}`);
      expect(text, file).not.toMatch(/npx dotenvx set/);
      expect(text, file).not.toMatch(/'npx', \['eas', 'env:(set|create|update)'/);
    }
    // env-update passes the value on stdin, to the one helper that calls dotenvx's own set.
    expect(read('scripts/env-update.sh')).toContain(`printf '%s' "$value" | node scripts/dotenvx-set.mjs "$key" "$src" secret`);
  });
});

// What wrangler prints, from wrangler 4.158's source and a run of 2026-11-13,
// when a person ran `npm run secrets -- production` signed out: every Worker
// secret and the Hyperdrive config were reported missing, and a yes would have
// set them all again and made a second config.
describe('a Cloudflare listing that fails', () => {
  const signedOut = "✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work. Please go to https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ for instructions on how to create an api token, and assign its value to CLOUDFLARE_API_TOKEN.";
  const badToken = '✘ [ERROR] A request to the Cloudflare API (/accounts/a1/workers/scripts/langquest-next/secrets) failed.\n\n  Authentication error [code: 10000]';
  const offline = '✘ [ERROR] fetch failed\n  getaddrinfo ENOTFOUND api.cloudflare.com';
  const config = '0123456789abcdef0123456789abcdef';

  it('takes a Worker that does not exist as one with no secrets yet, and nothing else', () => {
    expect(secretListFailure('✘ [ERROR] Worker "langquest-next" not found.\n\nIf this is a new Worker, run `wrangler deploy` first to create it.\nOtherwise, check that the Worker name is correct and you\'re logged into the right account.')).toBe('absent');
    expect(secretListFailure('✘ [ERROR] Worker "langquest-next-preview" (env: preview) not found.')).toBe('absent');
    expect(secretListFailure('✘ [ERROR] A request to the Cloudflare API (/accounts/a1/workers/scripts/x/secrets) failed.\n\n  This Worker does not exist on your account. [code: 10007]')).toBe('absent');
    for (const output of [signedOut, badToken, offline, '', 'Unexpected token < in JSON at position 0']) {
      expect(secretListFailure(output), output).toBe('unreadable');
    }
  });

  it('takes a Hyperdrive config as gone only when Cloudflare says so', () => {
    expect(hyperdriveGone(`✘ [ERROR] A request to the Cloudflare API (/accounts/a1/hyperdrive/configs/${config}) failed.\n\n  Hyperdrive config not found [code: 2005]`)).toBe(true);
    expect(hyperdriveGone(signedOut)).toBe(false);
    expect(hyperdriveGone(badToken.replace('workers/scripts/langquest-next/secrets', `hyperdrive/configs/${config}`))).toBe(false);
    expect(hyperdriveGone(offline)).toBe(false);
  });

  it('stops with what wrangler said, and how to sign in when that was it', () => {
    for (const output of [signedOut, badToken]) {
      const message = unreadable("the app Worker's secrets", output);
      expect(message).toMatch(/^could not read the app Worker's secrets, so nothing was compared or applied/);
      // The script runs wrangler with this profile; a plain `wrangler login` signs in another one (2026-11-13).
      expect(message).toContain('npx wrangler auth create langquest-email');
      expect(message).toContain(output);
    }
    expect(unreadable('x', signedOut, '', null)).toContain('npx wrangler login');
    const message = unreadable("the app Worker's secrets", offline, 'Run this again.');
    expect(message).not.toMatch(/wrangler (login|auth)/);
    expect(message).toContain('Run this again.');
    expect(message).toContain(offline);
    expect(unreadable('x', signedOut, 'Run this again.')).not.toContain('Run this again.');
  });
});
