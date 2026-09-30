---
name: field-diagnosis
description: Diagnose a problem someone in the field is having with LangQuest (slow downloads, sync that never finishes, crashes, a screen that will not open, missing work) from field diagnostics and server records, without asking them to describe it. Use when a report names an org, a language, a person's role, or an error code like "E-7K2Q01", or asks why the app is slow or failing for someone. Also use when changing what diagnostics record or how they are read (packages/client/src/diagnostics.ts, the diag schema, scripts/diag.ts).
license: MIT
---

# Diagnosing a field report

Phones keep content-free records of sync, snapshots, blob transfers and
faults and deliver them to schema `diag` (docs/diagnostics.md, decisions.md
38). Read them with `npm run diag`, which goes through the `diag_reader`
role on a hosted database (`DIAG_DATABASE_URL`) or the local database.

## Rules

- **Read only through `diag`.** Use `npm run diag` or the `diag.*`
  functions. Do not query `events` payloads, `profiles`, storage objects or
  audio to diagnose a performance or crash report: they hold people's work
  and identity, and the diagnostics were built so you do not need them. If
  you believe you do, stop and ask the developer.
- **Refer to people by role and profile id,** never by looking up a name or
  email. If the person reporting names someone, ask which role and language
  instead.
- **Say how sure you are.** A signal is a hypothesis. State what the numbers
  show, what else would explain them, and what would confirm it.
- **Absence is a finding.** No records from a member usually means the phone
  never reached the server with a build that records, or diagnostics are
  off. Report the last event they pushed (`diag.members`) and say so.
- **Never change hosted data or settings to test a theory** without the
  developer's go-ahead (infrastructure-as-code). Reproduce locally.

## Steps

1. **Resolve** the org and language: `npm run diag -- find "<name>"`.
   Several matches: ask which, do not guess.
2. **Report**: `npm run diag -- report <org> <language> --days 14`. Widen
   `--days` if the problem is older. Read the signals first, then the
   install sections for the role in question.
3. **Narrow** to one phone: `--install <id>` on the report, then
   `npm run diag -- timeline <id> --days 3` to see the order of events
   around when it went wrong (sync outcomes, snapshot, transfer tallies,
   errors, app update ids).
4. **An error code** someone read out: `npm run diag -- error <code>` gives
   the frames, the build and the 30 records before it. Map frames to source
   with the update id's source maps.
5. **Server side**: `diag.rpc_stats()` is in the report. For a specific
   window, the hosted project's API and storage logs, filtered by time.
6. **Cross-check with code**: sync is `packages/client/src/syncClient.ts`
   (`pullSlice`, `adoptServerSnapshot`), transfers are
   `apps/mobile/src/blobTransport.ts` and `transferWorker.ts`, snapshots
   `server/snapshotWorker.ts`. Use `systematic-debugging` before proposing
   a fix.
7. **Answer** with: what the person is experiencing, the cause with the
   numbers behind it, what to tell them now (keep the app open on Wi-Fi,
   free space, update), and the fix, if any, as a change for review.

## Reading the numbers

| Seen | Likely cause | Check |
| --- | --- | --- |
| `snapshot` outcome `none`, or partition has no snapshot for the current reducer | Cold phone folds the whole log | `partition_health.snapshots`; run the snapshot worker |
| Download `verifyMs` > `fetchMs` | The phone reading and hashing files in JS is the bottleneck, not the link | Model and OS in context; file sizes (`blobs.maxBytes`) |
| Download KB/s low, `failOffline` high | Weak or dropping link | Time of day in the timeline; other members on the same language |
| Sync `applyMs` well above network ms | Folding and writing on the phone | `load` p95, events folded, free disk |
| `failHttp4xx` | Session expired or signing refused | Sync outcomes `refused`; membership |
| `failHash` | Corrupt or truncated downloads | Storage object sizes vs `v1.BlobStored` (blob reconciler) |
| `too_old` outcomes | Build below `server_config.min_client_version` | Context `runtimeVersion`, `updateId` |
| Problems begin at a new `updateId` | Regression in an over-the-air update | Roll back the update first (error-tracking section 7) |
| `clockAheadS` large | Phone clock ahead; events refused `clock ahead` and re-stamped | Sync `rejected` |
| `freeDiskMb` < 500 | Recording and downloads constrained | `blobCacheMb`, `blobsWanted` |

## Changing what is recorded

Add a field to `DIAG_SCHEMA` and to the JSON in `diag.schema()` in a new
migration (never edit a shipped one); `scripts/diagSchema.test.ts` fails
until both agree. A new field must be a measurement or a code-written tag,
never something a person typed or said. Add a signal and a test in
`scripts/diagSignals.ts` if the field answers a question. Anything that
would identify a person, or record content, is a new decision
(`docs/decisions.md`), not a field.
