---
name: error-tracking
description: Error handling, crash reporting and observability practices for this offline-first Expo app, its sync client, the Supabase server and workers. Use when adding try/catch, error classes, error boundaries, global handlers, logging, breadcrumbs, crash or error reporting (Sentry, BugSnag, Crashlytics, Datadog), release health, source maps for EAS Build or EAS Update, or when deciding what a user sees when something fails.
license: MIT
---

# Error tracking for LangQuest Next

Field teams are offline for weeks on low-end Android phones, and what they
record is unpublished scripture translation from real communities. So: capture
everything, deliver it later, keep it small, and never let a report carry their
content or identity.

There is no third-party tracker. Faults and field behaviour are recorded as
content-free diagnostics in our own database (`docs/diagnostics.md`,
decisions.md 39; `reportError` in `apps/mobile/src/report.ts` feeds it), and
the `field-diagnosis` skill reads them. Adding a tracker, for native crashes
for example, is a new `docs/decisions.md` entry (see "Adopting a tracker"
below). Everything else in this skill applies now.

## 1. Classify before you catch

| Kind | Examples | Handling |
| --- | --- | --- |
| **Expected outcome** | Offline, server rejected an event, not a member, clock ahead, blob missing | Typed result or typed error. Show the user in plain language. Count it; do not report it as an exception. |
| **Invalid input at a boundary** | Malformed event, bad invite code, stale snapshot version | Validate at the door (`validateEvent`, `validate_payload`). The fold records it in `state.invalidEvents` and moves on. Report a **count**, not a crash. |
| **Fault (bug)** | Unexpected `undefined`, invariant broken, native module crash | Let it reach a boundary, report it with context, show a recoverable screen. |

Rejected events are **data, not errors** (PLAN.md invariant 1): they stay in the
local log with a reason and are shown to the user. A tracker may count them by
`RejectCode`; it must not be the only place they are visible.

## 2. Errors in code

- **Typed errors with a `name`**, as `OfflineError` and `NotAuthorizedError` in
  `packages/client/src/types.ts` do. Callers branch on type, not on message
  text. Wrap with `new Error(msg, { cause })` so the chain survives.
- **Expected failures across module boundaries are return values** (a
  discriminated union such as `{ ok: true, value } | { ok: false, reason }`).
  Throw only for bugs and for failures the caller cannot handle locally.
- **`packages/core` never throws from the fold** and has no logging or I/O. It
  reports problems as data (`invalidEvents`, validation results) and the caller
  decides what to do.
- **Catch at boundaries, not everywhere.** Legitimate boundaries: the React
  error boundary, the global JS handler, the sync scheduler loop, background
  tasks, native module calls, worker entry points. Never `catch {}` silently;
  never log and rethrow at every level (one report per failure).
- **Retry only the retriable.** Network failures back off with jitter.
  `INVALID` rejections never retry. A retry reuses the same event id.

## 3. Boundaries in the app

- **React error boundaries**: one at the root (`App.tsx` has one; it shows a
  screen a tester can read out over a call) **and** one around each major
  screen, so a crash in a study guide never takes down the recorder. The recorder
  must flush audio cards to disk before anything else can fail.
- **Global JS handler** (`ErrorUtils.setGlobalHandler`) and **unhandled promise
  rejections**: route both to the same reporter as the boundary.
- **Native crashes** (OOM, audio session, SQLite) are invisible to JS; only a
  native SDK sees them, and it sends them on the next launch.
- **Show the user an error id**: a short id they can read to support, which also
  appears in the report. Say what was kept ("Your recordings are safe on this
  phone") before saying what went wrong.

## 4. Privacy: scrub at the source

Treat these as never-send: audio, blob bytes, transcripts, note or comment text,
names, emails, phone numbers, invite codes, auth tokens, precise location,
screenshots, view hierarchies and session replay.

- **Allowlist, not denylist.** Reports carry only fields you chose: error type,
  message, stack, release, OS/device model, screen name, sync phase, counts,
  `RejectCode`, reducer and protocol versions.
- **Identifiers are opaque.** Use a random per-install id. Do not use profile id,
  email or display name. Ask before tagging org or partition ids.
- **Scrub in the client before it is queued** (a `beforeSend` /
  `beforeBreadcrumb` hook), then add server-side scrubbing rules as a backstop.
  JS hooks do not see native crash reports; configure native scrubbing
  separately.
- **Error messages must not interpolate user content.** Write
  `new Error('invite code rejected')`, not `` `code ${code} rejected` ``.
- Get consent where partner organizations or local law require it, and make the
  setting visible.

## 5. Offline delivery

- Reports queue **on disk**, bounded (by count and bytes), oldest dropped first,
  and are sent on reconnect. Size the queue for weeks offline, not minutes.
- **The event outbox has priority.** Error delivery must never delay or compete
  with pushing translation events or audio on a weak link.
- Keep each report small (no attachments, trimmed breadcrumbs). Sample
  high-volume, low-value events. Crashes are never sampled.
- Record the local time and the HLC at capture, because arrival can be weeks later.

## 6. Context that makes a report actionable

- **Release** is the app version plus build number, and the **EAS Update id,
  channel and runtime version** (`expo-updates`). Most JS fixes ship
  over the air, so crash rates must be sliced per update, not just per binary.
- **Source maps for every JS bundle you ship**, including each `eas update`
  publish, not only `eas build`. Without them, OTA crashes are unreadable.
- **Breadcrumbs** (content-free): screen changes, sync phases (push page n of m,
  pulled k, rejected counts by code), recorder state transitions, app
  foreground/background, connectivity changes.
- Versions: `CLIENT_PROTOCOL_VERSION`, reducer version, catalog version.

## 7. Watching it

- **Release health**: crash-free sessions per release and per update. A spike
  after an update means roll back with EAS Update first, investigate second.
- Alert on **new issues in the latest release** and on **rates**, not on every
  event. Group by stack fingerprint.
- Track product-health counters alongside errors: rejected events by code,
  `invalidEvents` count after fold, outbox depth and age, blob reconciler
  mismatches, snapshot load failures.
- **Server**: Postgres functions raise specific SQLSTATE codes (for example `LQ001`
  for "client too old"), and clients map codes, not message text. Workers
  (`server/*Worker.ts`) and the Cloudflare email worker report to the same
  project with a `component` tag.

## Adopting a tracker

Sentry is the most common choice for Expo, which documents it officially; BugSnag and Datadog also
support Expo. Whichever is chosen, record it in `docs/decisions.md`, then check
these, because vendor setup wizards get several wrong for this app:

- Turn off default PII (Sentry's wizard sets `sendDefaultPii: true`; set it
  `false`), screenshots, view-hierarchy capture and session replay.
- Add `beforeSend` and `beforeBreadcrumb` scrubbers per section 4, and disable
  console breadcrumbs that could contain payloads.
- Raise the offline cache limit (Sentry's React Native default keeps about 30
  envelopes) to suit weeks offline.
- Wire source-map upload into the `ship` scripts for `eas update`, not only into
  EAS Build.
- Tag `updateId`, `channel` and `runtimeVersion` on every event.
- Keep the native SDK (native crashes need it), and verify a native crash from a
  preview build reaches the dashboard symbolicated.

## Related skills

`systematic-debugging` for root-causing a report, `security-review` for data
exposure in logging, `event-sourced-sync` for rejected-event handling.
