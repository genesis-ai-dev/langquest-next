import { readdirSync, readFileSync } from 'node:fs';

// No production job runs in GitHub Actions (docs/server-jobs.md, decisions.md
// 140): a schedule there is delayed or dropped under load, switched off after
// 60 idle days in a public repository, and holds the production key in the
// repository's secrets. Server jobs run in the job container behind the
// dashboard Worker, or in an Edge Function when they fit it. The nightly
// test runs in guardrails.yml are scheduled too, and hold no production key.

/** A secret that reaches production: this app's service-role key, or v2's keys. */
const PRODUCTION_KEY = /secrets\.(V3_SERVICE_ROLE_KEY|V2_|SUPABASE_SERVICE_ROLE_KEY)/;

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));

describe('GitHub Actions workflows', () => {
  it('hold no production key, scheduled or not', () => {
    expect(workflows.filter((w) => PRODUCTION_KEY.test(w.text)).map((w) => w.f)).toEqual([]);
  });

  it('still have the scheduled test runs, which hold no production key', () => {
    const scheduled = workflows.filter((w) => /^\s+schedule:\s*$/m.test(w.text)).map((w) => w.f);
    expect(scheduled).toEqual(['guardrails.yml']);
  });
});
