# 162. Staff may mark feedback and run a server job from the ops dashboard, through the app Worker, which checks them again and records every attempt

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: 160 kept the ops dashboard read-only and said acting from it needs
its own decision. Carl chose (2026-10-21) read-only first, then a few
actions safe to take from a browser: marking feedback seen, done or open
again (the step `docs/diagnostics.md` left to "the admin page"), and running
a server job now (the projection pass, the v2 import, the fold canary, the
R2 check). Decided:
- **The admin Worker still holds no writer's key.** It passes the action and
  the person's own token over a service binding to the app Worker's
  `OpsActions` entrypoint (`apps/web/worker/opsActions.ts`), whose one method
  checks the token itself (verified claims, a live session (118), `aal2`,
  `_gv_on`) and only then acts with the service role. A bug in the admin
  Worker cannot act without a Global Viewer's live, verified session.
- **A closed list.** `parseAction` takes the two kinds with their arguments
  checked (a feedback id and status; a job key from `JOBS`); anything else
  is refused before anyone is asked. Running a job goes through its
  `JobRunner`, which leaves a run already going alone.
- **Every attempt is recorded.** `ops.actions` (migration
  `20261023110000_ops_actions.sql`) holds who (profile id), what, the
  target, the result and a code, refused attempts too; written only by the
  service role through `ops_record_action`, read by `diag_reader` through
  `diag.ops_actions`, kept a year.
- **Not from the page:** suspending or deleting accounts, moderation,
  Global Viewer grants and anything that changes an organization's work.
  Those stay in the command-line scripts, run on a call.
Reverse if: staff need another action often enough that the command line
is in the way; each one is added to the list here, never as a generic
"run this" call.

Amended (2026-10-22, Carl Sauder): the Vercel section is removed. LangQuest
Next runs nothing on Vercel (its web app, API, files and jobs are on
Cloudflare, and the privacy pages left Vercel under 46); the section
watched other FrontierRND projects (the website, the v2 web app, the dev
docs, the partner demo) that support and devops do not look after here.
Vercel has no read-only token, so `ADMIN_VERCEL_TOKEN` would have been a
token that can change the whole team's projects, on a Worker that
otherwise holds only read tokens. If the website needs watching, an
uptime check on its address does it without a token.

Amended (2026-10-26, Caleb Koster): a third kind of action, granting or
declining an organization's blue check request that waits for staff
(decision 173): `verification` in `parseAction`, with the request's id and
`grant` or `decline`, recorded as `verification_grant` or
`verification_decline`. Granting is a staff call about an organization's
identity, not a change to its work; revoking stays in the script
(`npm run org-verification -- revoke`).

Amended (2026-10-29, Caleb Koster): two more kinds, for the feedback on the
tutorial videos (decision 186): `tutorial-note`, a note about a video or one
not made yet, recorded as `tutorial_note`; and `tutorial-suggestion`, a
suggestion Claude made accepted, edited (its text, before a yes or no) or
rejected (with why), recorded as `suggestion_accepted`, `suggestion_edited`
or `suggestion_rejected`. They change only that feedback, never an
organization's work. Accepting a code change also files it in Linear when
the app Worker has `LINEAR_API_KEY`.

Amended (2026-11-05, Caleb Koster): a sixth kind, `quiet-account`, recorded
as `quiet_ok` or `quiet_ok_undo`. The warning about installs gone quiet
counted 43 installs and named nobody. Asked who they were, Caleb confirmed
that 3 accounts holding 40 of them were the store review account, a
developer and Caleb's own; a reinstall leaves the old install quiet. Caleb
asked to see the accounts behind the warning on the page and to say of one
that it is not an issue. Silent phones now lists quiet installs by account
(`diag.ops_quiet_accounts`), and a mark (`ops.quiet_accounts_ok`, gone with
the account) takes that account's quiet installs out of the warning's count,
now and later, until someone presses Undo. Not `ops.watch_ignored`: that
also leaves the account out of the watch for user issues (202), and a
problem on a marked account's phone is still a problem. It changes only this
count, never an organization's work. The page shows the account's id and no
name or email, as diagnostics do (38); its Look up opens the account's installs.

Amended (2026-11-19, Caleb Koster): one more kind, `tutorial-reply`: what
became of the reply Claude suggested for a comment on a tutorial video,
which a person posts on YouTube themselves (decision 186, amended
2026-11-19): `posted`, `none` (no reply needed) or `open` (taken back),
recorded as `reply_posted`, `reply_none` or `reply_open` with the comment's
input id. It records only; it posts nothing and changes no organization's
work.
