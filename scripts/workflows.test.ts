import { readdirSync, readFileSync } from 'node:fs';

// No production job runs in GitHub Actions (docs/server-jobs.md, decisions.md
// 141): a schedule there is delayed or dropped under load, switched off after
// 60 idle days in a public repository, and holds the production key in the
// repository's secrets. Server jobs run in the job container behind the
// app's Worker, or in an Edge Function when they fit it. The nightly
// test runs in guardrails.yml are scheduled too, and hold no production key,
// as do the nightly filming of the tutorial videos (tutorials.yml) and
// Claude's nightly look at their feedback (tutorial-review.yml), which reaches
// production only through the app's Worker, by GitHub's OIDC token.

/** A secret that reaches production: this app's service-role key, or v2's keys. */
const PRODUCTION_KEY = /secrets\.(V3_SERVICE_ROLE_KEY|V2_|SUPABASE_SERVICE_ROLE_KEY)/;

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));

describe('GitHub Actions workflows', () => {
  it('hold no production key, scheduled or not', () => {
    expect(workflows.filter((w) => PRODUCTION_KEY.test(w.text)).map((w) => w.f)).toEqual([]);
  });

  it('still have the scheduled test runs, release-branch tidying, tutorial filming and the look at the videos\' feedback, which hold no production key', () => {
    // release-branches.yml deletes a release branch once its new build is
    // public (decisions.md 155); it holds a GitHub App token for this
    // repository only, and a late or dropped run only keeps a branch longer.
    // tutorials.yml films the tutorial videos into this repository's release
    // with the Gemini key alone; the job container brings them in (decision 183).
    // tutorial-review.yml holds a Claude plan's token and reads and writes the
    // videos' feedback only through the Worker's /api/tutorial-review, which
    // lets in that workflow on main by its OIDC token (decision 186).
    const scheduled = workflows.filter((w) => /^\s+schedule:\s*$/m.test(w.text)).map((w) => w.f).sort();
    expect(scheduled).toEqual(['guardrails.yml', 'release-branches.yml', 'tutorial-review.yml', 'tutorials.yml']);
  });
});
