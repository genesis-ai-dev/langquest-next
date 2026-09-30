# Field diagnostics

When a translator somewhere without reliable signal says "downloading is
really slow", support should be able to answer from records instead of from
a phone call: which phone, which build, how long it spent on the network and
how long working on the phone, whether a snapshot existed, how many files
failed and why. This is how the app collects that without collecting the
people or their work. The decision behind it is `decisions.md` 39.

## What a phone records

Small, content-free records (`packages/client/src/diagnostics.ts`), each one
of these kinds, each with a fixed list of fields (`DIAG_SCHEMA`):

| Kind | When | Fields |
| --- | --- | --- |
| `sync` | A sync that moved events, took over 2 s, ended a spell offline, or changed outcome. A repeated offline or refused outcome at most once an hour. | total ms; network ms for push and pull; phone ms (fold and write); pushed, rejected, pulled; pages; outbox size; how long it was offline; outcome |
| `load` | A language (or the org) is opened and its log folded | ms, events folded, whether from a checkpoint |
| `snapshot` | A cold start looks for a server snapshot | fetch ms, pieces, pieces resumed after a dropped link, bytes, seq; `none` when there was none to use |
| `transfer` | Blob uploads or downloads, tallied per minute or 50 files | files, bytes, ms, slowest; download split into signing, network and verifying on the phone; failures by cause (link, 4xx, 5xx, hash, disk, other) |
| `device` | Each delivery | free and total disk, audio cache size, files still wanted |
| `error` | A fault reaches `reportError` (`apps/mobile/src/report.ts`) | error class, where, the id shown to the person, fatal or not, stack frames |

Every delivery also sends the phone's context: install id, OS and version,
model (Android), runtime version, EAS update id and channel, whether the
embedded bundle is running, reducer and protocol versions.

**Never recorded:** audio or blob bytes, event payloads, anything typed
(titles, notes, comments, transcripts), names, emails, phone numbers, invite
codes, tokens, IP addresses, location, screenshots. Error messages are not
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
- the person can turn it off (`setDiagnosticsEnabled(false)` in
  `apps/mobile/src/diagnostics.ts`), which stops recording and sending and
  deletes what is waiting.

Before launch: the privacy notice must describe this, and the settings
screen needs the switch (see "Not built yet").

## Delivery

- Records wait in their own SQLite file (`langquest-diagnostics.db`), so a
  diagnostics write never holds a lock an event commit needs. At most 3000
  are kept; past that the oldest go first and errors go last.
- They are sent after a sync that reached the server, left the outbox empty
  and found no uploads waiting: translation work always goes first. Not after
  downloads, because a stuck download is exactly what support needs to hear
  about. At most one attempt every 10 minutes, 3 batches of 100.
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
  per day;
- report functions for `diag_reader`: `diag.find`, `diag.partition_health`,
  `diag.members`, `diag.summary`, `diag.timeline`, `diag.error`,
  `diag.rpc_stats` (server-side timings of the sync RPCs, all orgs, from
  `pg_stat_statements`).

`server/diag-smoke.sql` covers ingest, the allowlist, refusals, the report
functions, the role boundaries and retention (`npm run db:test`).

## Reading it

```sh
npm run diag -- find "Dinka"                       # org and language ids by name
npm run diag -- report "LangQuest Sample" Dinka    # the report, signals first
npm run diag -- report <org> <lang> --days 30 --install <id> --json
npm run diag -- error E-7K2Q01                     # the code a person read out
npm run diag -- timeline <installId> --days 3      # one phone, in order
```

Without `DIAG_DATABASE_URL` it reads the local database. For the hosted
database, someone with access to the linked project runs `npm run
diag:access` once, after this migration is deployed. It gives the role a
generated password and encrypts the connection string (Supavisor, user
`diag_reader.<project-ref>`) into `supabase/.env.production` with dotenvx,
printing nothing secret. It is a support credential, so never in
`apps/mobile/.env.*`, which EAS receives. Then `npm run diag:hosted --
report …` reads the hosted records; running `diag:access` again rotates
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
- **Failures by cause**: link drops, 4xx (session or signing), 5xx, hash
  mismatch, disk.
- **Low disk**, **clock ahead**, **refused** or **too old** syncs, errors
  with their ids, several app updates in the window.
- **Members with no diagnostics**: the phone never synced since installing a
  build that has this, or has it turned off. Their last pushed event is
  shown as a fallback.
- **Server**: sync RPCs averaging over 500 ms.

Server-side request logs (API gateway, storage, Postgres) are in Supabase's
log explorer for the hosted project, kept for the plan's log retention; use
the install's timeline to pick the time window.

## Not built yet

- **The switch and the disclosure** in the app's settings, following the
  partner demo (PLAN.md section 12). The code path exists
  (`setDiagnosticsEnabled`); the screen does not.
- **A phone that never reaches the server** delivers nothing. A "send
  diagnostics" action that exports the waiting records as a file for the
  share sheet (WhatsApp, email) would cover it; it needs `expo-sharing`,
  which means a native build.
- **Native crashes** (out of memory, audio session, SQLite) are invisible to
  JS. If they turn out to matter, a native crash reporter is its own
  decision.
- **Failures before sign-in** are recorded but only delivered once someone
  signs in on that phone.
- **Request ids**: records carry times, not the gateway's request id, so
  matching a record to a server log line is by install and time window.
