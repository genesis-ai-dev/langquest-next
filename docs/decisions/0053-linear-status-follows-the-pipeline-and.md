# 53. Linear status follows the pipeline, and user-facing flags wait until after prototyping

Date: 2026-10-01 · By: Ryder Wishart · Status: accepted

Reason: we ship by trunk-based development: small changes go straight to
`main`, deploys are automatic (decisions 42, 43, 45) and a bad change is
reverted or patched forward in minutes. There is no pull-request or QA
column, so the LangQuest Next team's Linear statuses are In Progress,
Verifying, Deploying, Live and Outage, and the pipeline moves them.
`scripts/linear-sync.mjs` reads the issue IDs (`LAN-12`) in the commits of a
push. `.github/workflows/linear-sync.yml` moves each issue to Deploying and
comments the deploy lanes its changed files reach (ios and
android). Each lane reports back from the EAS workflow, and a failed checks gate
reports from guardrails. Every
lane ok is Live, any failure or a failed checks gate is Outage, and a push
that reaches no lane (docs) is Live at once. The state lives in the issue's
comments, so nothing else is stored and the issue shows progress as it
happens. A revert commit puts the issue it names in Outage. Cloudflare and
Supabase deploy through their own integrations (decisions 42, 51) and cannot
report, so they are not lanes: a change to them alone goes Live when it is
pushed, and a migration that fails to apply leaves nothing for Linear to see.
Reverse if: we need a lane Linear can see for Cloudflare or Supabase (poll `db:check`, or a deploy webhook), or
issues move so often that comments are noise (then use Linear's deployment
releases instead).

Feature flags are not built, on purpose, while the app is a prototype. Once
it is not, user-facing changes (not bug fixes, performance or small quality
of life changes) ship behind a flag. The shape we agreed, so the first one
follows it: a small synced configuration document in the spirit of decision
36, defaults compiled into the app so it behaves the same offline, and per
organization overrides from the server; no third-party flag service, in line
with decision 39. A flag gates screens and behaviour only and never the shape
or validation of an event, since events are permanent. In Linear, a flagged
issue reaches Live when its code ships dark, and a follow-up issue tracks the
rollout and removing the flag. Reverse if: a flag must change what is
synced, or we need percentage rollouts that organizations cannot override.

Amended (2026-10-22, Caleb Koster): small changes still go to `main` on
their own, but through a pull request whose guardrails checks are green;
`main` takes no direct push (decisions.md 150).

Amended (2026-11-07, Carl Sauder): the app's first flag, nearby sync's
(220), has no synced configuration document. It keeps this entry's
per-organization control, default of off, offline behaviour, lack of a
third-party service, and its rule that a flag gates screens and behaviour,
never events. The record is `org_features` on the server, and the
certificate carries it to the phone: the certificate would still need its
own server check, and two places would have to agree
(`docs/nearby-sync-plan.md` 5.10). That document can come when a second
feature needs a flag; `org_features` names its feature, so it can grow. As
this entry asks, a follow-up issue tracks the rollout and removing the flag;
none exists yet.

Amended (2026-11-24, Caleb Koster): after the named issues move, the same
workflow has Claude check the merge against every other open issue, and moves
each one it fixes as a named one, with a comment and the pull request linked
(docs/decisions/2026-11-24-a-merge-closes-the-issues-it-fixes.md).
