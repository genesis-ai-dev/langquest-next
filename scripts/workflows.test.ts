import { readdirSync, readFileSync } from 'node:fs';

// No production job runs in GitHub Actions (docs/server-jobs.md, decisions.md
// 140): a schedule there is delayed or dropped under load, switched off after
// 60 idle days in a public repository, and holds the production key in the
// repository's secrets. Server jobs run in the job container behind the
// dashboard Worker, or in the Edge Function when they fit it. A production
// job is a scheduled workflow that holds a production key; the nightly test
// runs in guardrails.yml are scheduled too, and hold none. The allowlist is
// what is still to move; it empties with the v2 import (server-jobs.md, step
// three). Add nothing to it.

const STILL_SCHEDULED = ['v2-import.yml'];

/** A secret that reaches production: this app's service-role key, or v2's keys. */
const PRODUCTION_KEY = /secrets\.(V3_SERVICE_ROLE_KEY|V2_|SUPABASE_SERVICE_ROLE_KEY)/;

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));
const scheduled = workflows.filter((w) => /^\s+schedule:\s*$/m.test(w.text));

describe('GitHub Actions workflows', () => {
  it('schedule no production job beyond the ones still to move', () => {
    expect(scheduled.filter((w) => PRODUCTION_KEY.test(w.text)).map((w) => w.f).sort()).toEqual(STILL_SCHEDULED);
  });

  it('still have the scheduled test runs, which hold no production key', () => {
    const tests = scheduled.filter((w) => !PRODUCTION_KEY.test(w.text)).map((w) => w.f);
    expect(tests).toEqual(['guardrails.yml']);
  });
});
