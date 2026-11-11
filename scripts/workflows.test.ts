import { readdirSync, readFileSync } from 'node:fs';

// No production job runs in GitHub Actions (docs/server-jobs.md, decisions.md
// 141): a schedule there is delayed or dropped under load, switched off after
// 60 idle days in a public repository, and holds the production key in the
// repository's secrets. Server jobs run in the job container behind the
// app's Worker, or in an Edge Function when they fit it. The nightly
// test runs in guardrails.yml are scheduled too, and hold no production key,
// as do the nightly filming of the tutorial videos (tutorials.yml),
// Claude's nightly look at their feedback (tutorial-review.yml) and the watch
// for user issues (user-issues.yml), which reach production only through the
// app's Worker, by GitHub's OIDC token.

/** A secret that reaches production: this app's service-role key, or v2's keys. */
const PRODUCTION_KEY = /secrets\.(V3_SERVICE_ROLE_KEY|V2_|SUPABASE_SERVICE_ROLE_KEY)/;

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));

describe('GitHub Actions workflows', () => {
  it('hold no production key, scheduled or not', () => {
    expect(workflows.filter((w) => PRODUCTION_KEY.test(w.text)).map((w) => w.f)).toEqual([]);
  });

  it('still have the scheduled test runs, the phone tests, release-branch tidying, tutorial filming, the look at the videos\' feedback and the watch for user issues, which hold no production key', () => {
    // release-branches.yml deletes a release branch once its new build is
    // public (decisions.md 155); it holds a GitHub App token for this
    // repository only, and a late or dropped run only keeps a branch longer.
    // tutorials.yml films the tutorial videos into this repository's release
    // with the Gemini key and the Claude plan's token alone (the voice, and
    // the frame check); the job container brings them in (decision 183).
    // tutorial-review.yml holds a Claude plan's token and reads and writes the
    // videos' feedback only through the Worker's /api/tutorial-review, which
    // lets in that workflow on main by its OIDC token (decision 186).
    // user-issues.yml, every 15 minutes, holds the same token and the Linear
    // key, and reads the diagnostics only through the Worker's
    // /api/user-issues, the same way (decision 202). A run that is late or
    // dropped only tells the team 15 minutes later.
    // phone-tests.yml runs the phone flows on an emulator and a simulator
    // against a test server that lives only for the run, and files in Linear
    // with the Claude plan's token and the Linear key alone (decision 207).
    const scheduled = workflows.filter((w) => /^\s+schedule:\s*$/m.test(w.text)).map((w) => w.f).sort();
    expect(scheduled).toEqual(['guardrails.yml', 'phone-tests.yml', 'release-branches.yml', 'tutorial-review.yml', 'tutorials.yml', 'user-issues.yml']);
  });
});
