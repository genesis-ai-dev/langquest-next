# Field diagnostics

When a translator somewhere without reliable signal says "downloading is
really slow", support should be able to answer from records instead of from
a phone call: which phone, which build, how long it spent on the network and
how long working on the phone, whether a snapshot existed, how many files
failed and why. This is how the app collects that without collecting the
people or their work. The decision behind it is `decisions.md` 39.

## What a phone records

Small, content-free records (`packages/sync/src/diagnostics.ts`), each one
of these kinds, each with a fixed list of fields (`DIAG_SCHEMA`):

| Kind | When | Fields |
| --- | --- | --- |
| `sync` | A sync that moved events, took over 2 s, ended a spell offline, or changed outcome. A repeated offline or refused outcome at most once an hour. | total ms; network ms for push and pull; phone ms (fold and write); pushed, rejected (and by reason: not a member, not allowed, language not listed, invalid, other; clock-ahead refusals are counted apart, as they are stamped again rather than rejected), requeued, pulled; pages; outbox size; how long it was offline; outcome (`ok`, `offline`, `unrenewed`: the sign-in could not be renewed, `refused`, `too_old`, `error`); on an error its class, its SQLSTATE or PostgREST code or `http<status>`, and the phase (push, pull, snapshot, checkpoint, load, store) |
| `load` | A language's (or the org's) log is folded | ms, split into reading the store and folding; events folded; whether from a checkpoint (`none`, `ok`, `old_reducer`); why it ran (`open`, `rejected`, `requeue`, `redaction`, `snapshot`, `membership`, `other`); `staleCheckpointSeq` when an update dropped the checkpoint (decision 110) |
| `checkpoint` | The phone rolls its confirmed prefix into a checkpoint and prunes | ms, size in KB, seq, events pruned, fast or slow path |
| `open` | A stream is opened, until its first full pull | ms, syncs, events pulled, snapshot and load ms, whether it started cold |
| `snapshot` | A server snapshot is fetched | fetch ms, pieces, pieces resumed after a dropped link, bytes, seq; `none` when there was none to use; why (`cold`, `redaction`, `reducer`) |
| `fill` | A big language's first download by fill (decisions.md 147) | `start` when the Map opens: ms to the Map, head size in KB, passages and rows to fill, why (`cold`, `redaction`, `reducer`); `done` when every passage's rows are here: ms since the start, across sessions; `fallback` when the phone downloads the whole snapshot instead, with the reason (`no_rpc`, `no_cut`, `no_lines`, `old_lines`, `error`); `restart` when the cut it filled from went away (`cut_gone`) |
| `transfer` | Blob uploads or downloads, tallied per minute or 50 files, per source | files, bytes, ms, slowest; download split into signing, network and verifying on the phone; failures by cause (link, sign-in refused 401/403, not found 404, too large 413, bad digest 422, other 4xx, 5xx, hash, gone from the device, disk, other); source (`lang`, `guide`, `handover`, `stream`, `source`, `help`, `study`) |
| `device` | Each delivery | free and total disk (not on the web), audio cache size, files still wanted; files lost behind the app's back and unsent recordings among them (decision 92); takes mid-save and recoveries that failed; uploads waiting and the oldest unsent recording's age; the oldest wanted download's age; streams, events and database size held; diagnostics queued, and dropped past the 3000 bound |
| `error` | A fault reaches `reportError` (`apps/mobile/src/diagnostics/report.ts`) | error class, where, the id shown to the person, fatal or not, a fixed code (a recorder's `nospace`, a SQLSTATE), stack frames |
| `expected` | A failure already shown to the person (`noteExpected`), tallied per hour | where, error class, code; how many |
| `audio` | Recording and playback, tallied per hour per language | takes and their total length, takes too short to keep, microphone refused, start, stop, save and compression failures, WAV kept, interruptions; plays, playback failures, taps on audio not yet on the phone, stream failures; plays that reached sound, how long they waited for it added up, and the longest wait (decision 182, amended 2026-11-04) |
| `auth` | Signing in and staying in | what was tried (`sign_in`, `sign_up`, `code`, `v2`, `redeem`, `join`, `renew`, `ended`, `courier`, `outbox`, `route`, `delete`, `org_list`), how it ended, an Auth error code, SQLSTATE or our own code; ms, HTTP status, attempt, ages; for a hand-over, how much another person's sign-in left to send, never who; a sign-in from the phone's lock (decisions.md 168) is `sign_in` with action `lock_pattern` or `lock_password` |

Every delivery also sends the phone's context: install id, OS and version,
model (Android), the store build installed (`appVersion`: the store's
version and the build number, `2026.1030.1319 (48)`, since 2026-11-03),
runtime version, EAS update id and channel, whether the embedded bundle is
running, reducer and protocol versions. Feedback carries the same.

Every report line about a phone names its build the way support asks it
(`buildLabel`, `scripts/diagSignals.ts`): `build 48 (2026.1030.1319) · OTA
update 01a1827 (production)`, or `no OTA update` when it runs the store
build's own code. The update is cut to the seven characters the app shows
under Sync, Details, so it matches what a person reads out. A phone from
before the store build was sent shows `build ? (runtime fede04f0)`: its
runtime names the store builds it can be, and only EAS's build list says
which.

**Web builds:** a browser has no expo-updates, so a record's
`runtimeVersion` is the commit the web build was made from (its
`/version.json`) and its `channel` is `web`. Web stack frames are from a
minified bundle; the source maps are written to `apps/mobile/dist-sourcemaps/`
and never served, so rebuild that commit with `npm run export:web` to read
one.

**Never recorded:** audio or blob bytes, event payloads, anything typed
(titles, notes, comments, transcripts), names, emails, phone numbers, invite
codes, tokens, IP addresses, location, screenshots, file names or hashes,
and on a shared phone the other person's id. Error messages are not
recorded, because they can quote what someone typed; only the class name
and the stack frames, with the message line removed and file paths cut to
file names.

This is enforced as an allowlist, twice: `sanitizeDiag` on the phone before
a record is written, and `diag.clean` on the server before it is stored.
Tag values are either from a fixed set or short code-like tokens. A field
added on one side only fails `scripts/diagSchema.test.ts`.

## Who a record is about

Records are keyed by the **install id**, which is the event envelope's
`deviceId`: random, one per install, already on every event the phone has
pushed. The server also stores the **profile id** of the account that
delivered the records (from the session, never from the phone). No name or
email is stored with diagnostics. Support finds "a translator in this
language" through membership (`diag.members`), which lists profile ids and
roles only.

That is pseudonymous, not anonymous: we can link a record to an account, so
under GDPR-style rules it is still personal data. What keeps it proportionate:

- only operational measurements, no content (above);
- a record may name an org only if the delivering account belongs to it;
- kept 90 days after arrival (`diag.prune`, run on every ingest), installs
  forgotten after 180 days without a delivery;
- readable only by the `diag_reader` role and the database owner, never by
  the app's API roles;
- the person can turn it off in Settings › App › Send diagnostics
  (`setDiagnosticsEnabled(false)` in `apps/mobile/src/diagnostics/diagnostics.ts`),
  which stops recording and sending and deletes what is waiting. The choice
  is kept on the phone (`diag:off`) and survives a restart.

The privacy policy (`https://next.langquest.org/privacy`, from
`apps/mobile/public/privacy.html`; decisions.md 46) describes this: what
is sent, that it can be turned off, and the 90 and 180 day retention. Change
it with any change to what is recorded or how long it is kept.

## Delivery

- Records wait in their own SQLite file (`langquest-diagnostics.db`), so a
  diagnostics write never holds a lock an event commit needs. At most 3000
  are kept; past that the oldest go first and errors go last.
- They are sent once the phone's own work has had its turn: after a
  language sync that reached the server, left the outbox empty and has no
  upload that has not yet been tried (an upload that keeps failing does not
  hold them: it is exactly what support needs to hear about), after a
  refused or "app too old" sync (such a phone never empties its outbox),
  when the organization stream settles, and on sign-in, so a
  phone that never opens a language still reports. At most one attempt
  every 10 minutes, 3 batches of 100.
- A batch is deleted on the phone only after the server accepted it; the
  server ignores ids it already has, so a resend is harmless.
- Recording never throws and never blocks the caller.

## The server

`supabase/migrations/20260929180000_field_diagnostics.sql`:

- schema `diag`, not exposed by PostgREST (`supabase/config.toml` `[api]
  schemas`; the hosted project's "exposed schemas" must not include it);
- `diag.installs` (latest context per install) and `diag.records`;
- `public.diag_ingest(context, records)`: the one way in. Signed-in callers
  only, at most 200 records a call, 8 KB a record, 5000 records per install
  per day and 20000 per person per day, across installs;
- report functions for `diag_reader`: `diag.find`, `diag.language_health`
  (with when the language was last projected), `diag.members`,
  `diag.summary` (a language: the installs that recorded something about it,
  and every member's install that recorded anything, so a phone stuck on the
  organization stream is there too), `diag.org_summary` (every member's
  installs, and members never heard from), `diag.person` (one account's
  installs, for someone in no organization yet), `diag.timeline`,
  `diag.error`, `diag.rpc_stats` (server-side timings of the RPCs phones and
  jobs call, all orgs, from `pg_stat_statements`).

The second pass (decision 112) is
`supabase/migrations/20261016000000_diag_gaps.sql` (the new kinds and
reports) and `20261016010000_diag_jobs.sql`, the server's own jobs:

- `diag.job_runs`, one row per run of a server job: its outcome (`ok`,
  `partial`, `error`), ms, counts, an error's class or code (never its
  message) and, where it is about one, the organization and stream. Written
  only through `public.diag_job_ingest`, which only the service role may
  call (`server/jobRuns.ts`; writing never fails or slows the job). Kept 90
  days, like records.
- Writers: the projection pass (`projection`, every 5 minutes in the job
  container behind the app's Worker, decisions.md 141; every minute on
  a local stack's Edge Function; `projection_large` is retired; its numbers
  include `maxPeakRssMb` and `maxHeapLimitMb` (named `max…` so the totals keep
  the largest, not a sum), and a run stopped early by a deploy says `sigterm`
  and exits 75; a run without a failure
  names the language that raised its peak memory; it also samples what
  arrived since its last run, since `public.events` has no index on
  `received_at`: `newEvents`, `arrivalsSampled`, the upload delay
  `maxUploadDelayP50Ms`, `maxUploadDelayP95Ms` and `maxUploadDelayMs`
  (`received_at` against the HLC's wall clock), and `futureStamped` and
  `futureStampedInstalls`, events stamped over 5 minutes ahead of the
  server's clock, `server/arrivals.ts`), the nightly fold canary
  (`fold_canary`: three random languages, the largest on Sundays, folded
  afresh and compared with their stored snapshot and passage lines;
  `languages`, `events`, `mismatched`, and the database's sizes from
  `ops_sizes()`, `dbBytes`, `eventsBytes`, `eventsRows`, `snapshotsBytes`;
  `mismatch` names the first language that differs, `server/foldCanary.ts`),
  the nightly R2 check (`blob_reconcile`: `streams`, `objects`, `missing`,
  recordings the log holds and R2 lacks, `orphaned`, files R2 had that the
  log did not, `server/reconcileJob.ts`), the snapshot purge (`snapshot_purge`:
  `snapshots`, `rows` and `staged` removed, every 10 minutes in the database,
  `ops.purge_snapshots`, decision 203), each account deletion
  (`account_delete`, written by `_delete_account` with no id at all), the
  Worker's job tick (`job_starts`: jobs started, found running, switched
  off, or that could not start), push delivery
  (`push_delivery`, every minute: claimed, sent, no token, failed by cause,
  receipts), the v2 import (`v2_import`), the app's Worker's cron
  (`worker_cron`), webhook delivery per batch (`webhook_dispatch`), the
  Worker's requests by route and status class, at most once a minute per
  isolate (`worker_requests`: `<route>_<2xx…5xx>`, `<route>_429` for a rate
  limit's refusal, and the time taken as `<route>_lt100ms`, `_lt1s`,
  `_lt10s` or `_over10s`; routes include `device` and `links`, the two
  rate-limited ones, and `ops`, the ops dashboard), invitation email (`invite_email`, from
  `send-invite`, with the email service's code), and Forgot password email
  (`password_reset_email`, from `password-reset`, likewise).
- `diag.job_schedule` says how often each runs; `diag.jobs()` gives each
  job's runs, failures, failure streak, last success and `stale` (no run
  that was not an error for over twice its schedule); `diag.job_history`
  one job's runs.
- `diag.inbox_health(org)`: push delivery for an organization, counts and
  ages only (pending, oldest pending, attempts, the last errors by code,
  members with no push token). Notifications carry `push_attempts` and
  `push_last_error` (a fixed code), and `projection_marks` `projected_at`.
- `diag.v2_import_status()`: the v2 import per project, running, cut off,
  failed or done, with its counts; no messages, no names.
- The ops dashboard's report functions (migration
  `20261023100000_ops_dashboard.sql`, `docs/ops-dashboard-plan.md`):
  `diag.ops_people`, `ops_orgs`, `ops_org`, `ops_pipeline`, `ops_cron`,
  `ops_database`, `ops_push`, `ops_integrations`, `ops_support`,
  `ops_limits`, `ops_sizes`, `migrations_applied`, and `lookup_email`, which
  answers an email with the profile id only. Counts, ids, timings, codes,
  and organization and language names; never a person's name or email, a
  report's reporter or details, or a command's text
  (`server/opsDashboardSmoke.sql` holds them to it).

`server/diag-smoke.sql` covers ingest, the allowlist, refusals, the report
functions, the role boundaries, retention and job runs (`npm run db:test`).

## Reading it

Staff can see it all in one page at `https://next.langquest.org/ops-dashboard`
(`docs/admin.md`): the server's jobs, every install together, the
database's RPC timings, the v2 import, and a box for an error code, an
install id or a name. It reads as `diag_reader`, like the commands below.

```sh
npm run diag -- find "Dinka"                       # org and language ids by name
npm run diag -- report "LangQuest Sample" Dinka    # the report, signals first
npm run diag -- report <org> <lang> --days 30 --install <id> --json
npm run diag -- org "LangQuest Sample"            # every member's phones, whatever they opened
npm run diag -- person <profileId>                 # one account: no organization yet, a join request waiting
npm run diag -- jobs                               # the server's own jobs; --job <name> for its runs
npm run diag -- inbox "LangQuest Sample"          # push delivery for an organization
npm run diag -- v2                                 # the v2 import, per project
npm run diag -- error E-7K2Q01                     # the code a person read out
npm run diag -- timeline <installId> --days 3      # one phone and its build, then its records in order
```

Without `DIAG_DATABASE_URL` it reads the local database. For the hosted
database, someone with access to the linked project runs
`scripts/diag-access.sh` once, after this migration is deployed. It gives the role a
generated password and encrypts the connection string (Supavisor, user
`diag_reader.<project-ref>`) into the root `.env.production` with dotenvx,
printing nothing secret. It is a support credential, so never in
`apps/mobile/.env.*`, which EAS receives. Then `npm run diag -- --hosted
report …` reads the hosted records; running `diag-access.sh` again rotates
the password.

`diag_reader` can read the diag tables and run the report functions. It
cannot read the event log, profiles, storage or anything else, and cannot
delete.

The report leads with **signals** (`scripts/diagSignals.ts`), ranked
hypotheses drawn from the numbers:

- **No snapshot for the current reducer**, or one far behind: every new
  phone folds the log from the start. Check the snapshot worker.
- **A fill that fell back, started over or will not finish**: a first
  download that took the whole snapshot because the server had no cut or
  lines for the language (check the projection pass on the job host), a
  fill that started over because its cut went away, and one still running a
  day after it began by the phone's last delivery (decisions.md 147).
- **Slow link**: downloads under 20 KB/s on the network.
- **Phone-bound**: verifying downloads (read and hash in JS) takes longer
  than fetching them, or a sync spends more time folding and writing than
  waiting on the network.
- **Failures by cause**: link drops, sign-in refused (401/403), not on the
  server (404), too large to upload (413, retried for ever), the server
  saw a different file (422), other 4xx, 5xx, hash mismatch, gone from the
  device, disk; for the language's lists and each other source.
- **Sign-in that cannot be renewed** (`unrenewed`), and sync errors by
  phase and code (`pull:57014`, a statement timeout).
- **Work refused** for membership, as invalid, or for a clock ahead.
- **Low disk**, **clock ahead**, **refused** or **too old** syncs, errors
  with their codes and ids, several app updates in the window.
- **Lost files** and unsent recordings among them, recordings that could not
  be recovered, a recording waiting over a day to upload, a download wanted
  over a day, and records dropped on the phone (the history is incomplete).
- **Recording**: the microphone refused, takes that failed to start, stop
  or save, compression failures, many takes too short; playback failures.
- **Sign-in**: signed out by the server with work unsent, invites refused,
  the organization list failing, the app landing somewhere other than home,
  hand-over that cannot deliver, account changes refused or retried for a
  day; any `expected` failure seen ten times or more.
- **Updates**: a checkpoint dropped after a reducer update (decision 110),
  folds repeated after rejections, slow checkpoints, a slow first open.
- **Organization stream**: its syncs refused, failing or slow, and a
  member's phone that syncs the organization but never opened the language.
- **Members with no diagnostics**: the phone never synced since installing a
  build that has this, or has it turned off. Their last pushed event is
  shown as a fallback.
- **Server**: RPCs averaging over 500 ms; jobs that stopped, failed three
  times running or often, push delivery that sends little of what it
  claims.

Server-side request logs (API gateway, storage, Postgres) are in Supabase's
log explorer for the hosted project, kept for the plan's log retention; use
the install's timeline to pick the time window.

## Feedback from help mode

What people choose to tell us is not a diagnostics record, and nothing above
changes for it (decisions.md 145). While help is on, Send feedback opens a
sheet for a problem or an idea, typed or said in a voice note (at most two
minutes); the report is an account change (it waits
offline and goes as its author, like a profile change) and arrives in
`diag.feedback` with the **install id** above, so its phone's records are
one lookup away. A screenshot and the person's name and email come only when
they turn those switches on, and a picture of their own only when they add
one (LAN-198). `public.feedback_submit` is the one way in
(signed in, 20 a day per account); `diag.feedback()` and
`diag.feedback_screenshot()`, `diag.feedback_picture()` and `diag.feedback_voice()` are for `diag_reader`:

```sh
npm run diag -- feedback --days 30                # newest first, with each install id
npm run diag -- feedback --install <installId>    # one phone's
npm run diag -- feedback --shot <feedbackId>      # saves its screenshot as feedback-<id>.jpg
npm run diag -- feedback --picture <feedbackId>   # saves the picture they chose as feedback-<id>-picture.jpg
npm run diag -- feedback --voice <feedbackId>     # saves its voice note as feedback-<id>.m4a (or .wav)
npm run diag -- timeline <installId> --days 2     # then what that phone recorded
```

Kept a year, and deleted with the account. Seen and done are set from the
admin page (`public.feedback_set_status`, service role).

## The watch for user issues

Nobody has to remember to look (decisions.md 202). Every 15 minutes
`.github/workflows/user-issues.yml` asks the app's Worker what is new
(`GET /api/user-issues`, which lets in only that workflow on main by its
GitHub OIDC token; `apps/web/worker/userIssues.ts`). The database
(`public.ops_user_issue_watch`, migration `*_user_issues.sql`) groups the
last 7 days into **kinds**, named by the records' code-like tags:

| Family | A kind, for example | From |
| --- | --- | --- |
| `error` | `error:TypeError@record:-` | an error record: name, where, code |
| `sync` | `sync:error:pull:57014:ServerError`, `sync:unrenewed` | syncs that failed, were refused, too old or could not renew |
| `transfer` | `transfer:down:source:failOther` | file transfers that failed, not offline |
| `auth` | `auth:redeem:expired:-` | sign-in, joining and account changes that ended badly |
| `expected` | `expected:<where>:<name>:<code>` | failures already shown to the person, from 10 |
| `audio` | `audio:saveFail` | recording and playback failures |
| `fill` | `fill:fallback:no_cut` | first downloads that fell back or started over |
| `device` | `device:lostRecordings`, `device:uploadWaitingOverADay` | work lost or stuck on a phone |
| `job` | `job:projection:failing` | a server job failing three times running, or stopped |
| `worker` | `worker:blobs_get:5xx` | a Worker route answering 5xx at least 5 times in a day |
| `feedback` | `feedback:<id>` | a problem sent from help mode (bugs, not ideas) |

Development builds and the accounts in `ops.watch_ignored` (the store
review account and Claude's production test account; an operator adds
others with SQL) are left out. A kind is
handed over when someone hit it in the last day and it was never looked at,
at most 20 at a time, problems from help mode first.

When something is new, Claude (`anthropics/claude-code-action`, the plan
token of the tutorial review) reads the kinds and the team's Linear issues,
follows the `user-issues` skill, and writes what it decided: a new problem,
one the team already has, noise, or already fixed. Already fixed means a
pull request merged into main after the reports fixes it (Claude reads
main's merges with `git log`, 600 commits deep): nothing is filed, and the
kind keeps the pull request's number and when it merged. `scripts/user-issues.mjs` then files
each new problem in Linear's LangQuest Next team with the label **User
issue**, assigned to the Linear user named in the workflow, and comments on
an issue that a known kind belongs to. Then it tells the Worker what was
done (`POST`), kept in `ops.user_issues`, so each kind is looked at once. A
kind comes back when at least twice as many people (and two more) hit it: a
filed one as a comment on its issue with the new numbers, noise to be
judged again. Server kinds come back after a week; noise is forgotten after
90 days.

**Closed in Linear stays closed.** Every run reads the state of each issue
the watch filed or commented on (180 days back) and sends what changed. An
issue closed in Linear (Live, Canceled or Duplicate; not Outage, which says
a deploy failed) closes its kinds too: they become already fixed, with the
pull request linked on the issue (the newest) or the merge on main that
names it, and a problem sent from help mode about it is marked done. An
issue opened again in Linear is open for the watch again. A fixed kind, by
Claude or by Linear, comes back only for people who hit it more than a day
after the fix (time for browsers to reload and phones to take the update),
at least twice as many as when it was last looked at and at least two.
Claude then compares the builds they ran with the fix: builds from before
it leave it closed; builds that have it mean the fix did not hold, and the
script comments on the issue and moves it back to Todo. A build is a
browser's commit (`web 4df4afdeaf0f`), a phone's update (`android update
1a2b3c4d`) or store build by its runtime (`ios store build 492c168b`); the
watch does not read the store build number phones send since 2026-11-03.

The ops dashboard's **User issues** section (`diag.ops_user_issues()`)
lists every issue the watch filed or commented on and every kind it found
already fixed, the last 90 days: its state in Linear, the pull request that
fixed it and when, and the last look.

**Claude sees what came with each problem** (decisions.md 202, amended
2026-11-04). Before Claude looks, the step before it asks the Worker for
two more things and keeps them in `.user-issues/evidence` on the runner:

| Asked for | Answered by | What it is |
| --- | --- | --- |
| `GET /api/user-issues?media=<feedback id>` | `public.ops_user_issue_media` | the screenshot and the chosen picture of a problem sent from help mode (bugs only, sent in the last 30 days or already judged), as JPEG files |
| `GET /api/user-issues?phone=<install>&at=<time>` | `public.ops_user_issue_phone` | that phone's build, model and OS, and its records from three days before the time to an hour after, newest first, at most 400, without organization or stream ids |

The phones are each problem's own and up to two of every other kind's, at
most 12 a run (`scripts/user-issues.mjs` `evidencePlan`). Claude opens the
pictures and the records before it judges, and says what they show. For a
problem sent from help mode the script also writes that phone's half hour
before the report into the issue, from the records alone (`phoneFacts`):
downloads and uploads with their count, size and seconds per file, plays and
recordings, opens and syncs, the disk. The draft fix job asks for the same
for the issue's problem and phones, by the ids in its Agent notes, with its
own OpenID Connect token before Claude runs. None of it goes into a log or
an artifact, and the patch step drops a draft fix that carries the
person's words (six in a row) or one of those ids, since the repository is
public; a draft fix may add no picture or recording.

An issue says what went wrong in plain words, what the watch counted
(people, installs, platforms, builds, first and last seen), the
person's own words for a problem from help mode (an email address taken
out) with that phone's numbers, and, in its Agent notes, the kinds' keys (how later runs find it),
a few install ids for `npm run diag -- --hosted timeline <installId>`, the
newest stack, and where Claude thinks it comes from in the code. The
repository is public, so the workflow's log says only counts, keys and
issue ids.

**A draft fix comes with each new issue** (at most three a run). After
filing, the workflow hands each new issue back to Claude in a fresh checkout
of main, following the skill's "Writing a draft fix": the smallest change
that fixes it, with a test, or a reason why there is none (the cause is
unclear, or it needs a person's decision, a store build or a dashboard).
What people wrote shapes that code, so three jobs trust each other less as
they go:

| Job | Holds | Does |
| --- | --- | --- |
| `fix` | the Linear key, in a step before Claude; the Claude token | Claude edits the checkout with no shell but `git log`, `show` and `diff`; the patch is taken with the script and the repository copied before Claude ran |
| `check` | no key; reads only | refuses a patch that changes `.github/`, hooks, packages, `.env*`, agents' instructions or the watch, then applies it, lets the git hooks rebuild what they rebuild, and runs typecheck and `vitest related` |
| `open` | the Linear key; writes branches and pull requests | runs nothing of the patch: pushes it to `user-issue/<issue>`, opens it as a draft pull request titled with the issue's id, and links it on the issue with a comment |

A pull request the built-in token opens starts no checks. Guardrails start
when a person, having read the change, marks it Ready for review
(`ready_for_review` in `guardrails.yml`); merging moves the issue on like any
change whose commit names it. When there is no fix, the issue says why.
Opening the pull request needs "Allow GitHub Actions to create and approve
pull requests" (`.github/actions-permissions.json`, `npm run github:rules
-- --apply`); without it the branch is pushed, the issue links it, and the
run says "Needs you".

The watch's runs are the ops dashboard's `user_issue_watch` job (it is
stale after an hour without one) and `user_issue_look`. Without
`CLAUDE_CODE_OAUTH_TOKEN`, or with one Claude refuses, a run fails with
"Needs you: Claude token". To run it by hand: Actions → user-issues → Run
workflow.

## Not built yet

- **A phone that never reaches the server** delivers nothing. A "send
  diagnostics" action that exports the waiting records as a file for the
  share sheet (WhatsApp, email) would cover it; it needs `expo-sharing`,
  which means a native build.
- **Native crashes** (out of memory, audio session, SQLite) are invisible to
  JS. If they turn out to matter, a native crash reporter is its own
  decision.
- **Failures before sign-in** are recorded but only delivered once someone
  signs in on that phone (they then go at once). Accepting records with the
  public key before sign-in was turned down (decision 112).
- **Native recorder codes**: the microphone module's errors are mapped to
  codes from their text in JS (`recording/recorderFaultModel.ts`); a code
  sent by the module itself needs a native build.
- **Request ids**: records carry times, not the gateway's request id, so
  matching a record to a server log line is by install and time window.
