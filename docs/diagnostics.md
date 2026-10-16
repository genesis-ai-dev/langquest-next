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
| `transfer` | Blob uploads or downloads, tallied per minute or 50 files, per source | files, bytes, ms, slowest; download split into signing, network and verifying on the phone; failures by cause (link, sign-in refused 401/403, not found 404, too large 413, bad digest 422, other 4xx, 5xx, hash, gone from the device, disk, other); source (`lang`, `guide`, `handover`, `stream`, `source`, `help`, `study`) |
| `device` | Each delivery | free and total disk (not on the web), audio cache size, files still wanted; files lost behind the app's back and unsent recordings among them (decision 92); takes mid-save and recoveries that failed; uploads waiting and the oldest unsent recording's age; the oldest wanted download's age; streams, events and database size held; diagnostics queued, and dropped past the 3000 bound |
| `error` | A fault reaches `reportError` (`apps/mobile/src/diagnostics/report.ts`) | error class, where, the id shown to the person, fatal or not, a fixed code (a recorder's `nospace`, a SQLSTATE), stack frames |
| `expected` | A failure already shown to the person (`noteExpected`), tallied per hour | where, error class, code; how many |
| `audio` | Recording and playback, tallied per hour per language | takes and their total length, takes too short to keep, microphone refused, start, stop, save and compression failures, WAV kept, interruptions; plays, playback failures, taps on audio not yet on the phone, stream failures |
| `auth` | Signing in and staying in | what was tried (`sign_in`, `sign_up`, `code`, `v2`, `redeem`, `join`, `renew`, `ended`, `courier`, `outbox`, `route`, `delete`, `org_list`), how it ended, an Auth error code, SQLSTATE or our own code; ms, HTTP status, attempt, ages; for a hand-over, how much another person's sign-in left to send, never who |

Every delivery also sends the phone's context: install id, OS and version,
model (Android), runtime version, EAS update id and channel, whether the
embedded bundle is running, reducer and protocol versions.

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
- Writers: the projection pass (`projection`, every 5 minutes on the Edge;
  `projection_large`, every 10 in the job container behind the dashboard
  Worker, decisions.md 134), push delivery
  (`push_delivery`, every minute: claimed, sent, no token, failed by cause,
  receipts), the v2 import (`v2_import`), the dashboard Worker's cron
  (`worker_cron`), webhook delivery per batch (`webhook_dispatch`), the
  Worker's requests by route and status class, at most once a minute per
  isolate (`worker_requests`), and invitation email (`invite_email`, from
  `send-invite`, with the email service's code).
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

`server/diag-smoke.sql` covers ingest, the allowlist, refusals, the report
functions, the role boundaries, retention and job runs (`npm run db:test`).

## Reading it

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
npm run diag -- timeline <installId> --days 3      # one phone, in order
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
