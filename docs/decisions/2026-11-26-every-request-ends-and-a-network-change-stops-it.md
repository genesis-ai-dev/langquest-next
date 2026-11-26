# Every request to the server ends, and a network change stops the ones still out

Date: 2026-11-26 · By: Caleb Koster · Status: accepted

Reason: on 2026-11-25 an Android phone's network dropped while a sync's
request to the database was out (LAN-339). React Native's fetch on Android
sets no time limit, so the request never answered and never failed. The
sync holds its language's turn while its request is out, and nothing else
ends a sync, so that language sent and fetched nothing more until the app
was closed: a part recorded later waited to upload, leaving the language and
opening it again would have hung, and the screen still said online. Caleb
asked how well-established sync engines handle this and where our approach
falls short. They put a limit on every wait (PowerSync stops each try;
Firestore says offline after 10 seconds; Zero checks the connection every 5
seconds) and start again when the network changes (Firestore, Realm). Caleb
chose to put all of the following in one pull request (PR 716).

- **Every request has a limit of 2 minutes, body included**
  (`apps/mobile/src/server/sessionSafeFetch.ts`, `answerWithin`): the
  Supabase clients, and the app's calls to its Worker (`limitedFetch`:
  nearby attest and relay, file links). Expo's fetch answers when the
  headers come, so the limit holds until the body is read. A failed request
  says "Network request failed", so it reads as offline and the next sync
  sends it again; every call is safe to repeat (appends are idempotent by
  event id). Two minutes is long enough for the largest answer, a
  snapshot's 256 KB piece, on a slow link.
- **A file the web sends whole gets time for its size**: 2 minutes and 1
  second per 4 KB (`transferLimitMs`), so a weak link still finishes and a
  dead one ends. A phone's file transfers already end by themselves: Expo's
  native upload and download have their own limits. A web download keeps no
  limit: its size is not known before it starts.
- **When the network goes or comes back, every request still out is
  stopped** and sync is woken (`apps/mobile/src/sync/wake.ts`,
  `stopRequestsInFlight`): a request sent before the change waits on a
  connection that is gone. Only the first listener of a change stops them,
  so none stops what another one's sync just sent. **A sign-in renewal is
  never stopped this way**: Supabase Auth may have used its refresh token
  already, and a token sent again more than 10 seconds later ends the
  sign-in (`refresh_token_reuse_interval`), which "never signed out" does
  not allow. It keeps its limit, which only ends a wait on a dead link.
- **The sync package has a backup limit of 150 seconds per call**
  (`packages/sync/src/requestLimit.ts`, `SyncClientOptions.requestLimitMs`),
  longer than the app's, so it fires only when that limit did not: a
  request that goes around it, or another platform's transport. It cannot
  stop the request, only the wait; this is safe only because the app's
  limit stops requests on the phone, since Android's network layer runs at
  most 5 requests to one server at once, and requests left hung would fill
  those places and stop every database call.
- **Diagnostics count the limit**, on the existing `expected` tally (tokens,
  no migration): `request stopped` / `TypeError` / `no_answer` when the
  app's limit fires, and `sync request` / the call / `no_answer` when the
  backup does. A stop for a network change is not counted: it is the
  field's ordinary day, and the watch for user issues would file it.
- The 2026-11-25 incident is a lasting test
  (`packages/sync/test/requestLimit.test.ts`): a pull with no answer, a part
  recorded after, the language opened again. It fails without the limit.

Not chosen: a sync that uploads files apart from the pull ("stop while
pulling", `docs/blobs.md` rule 7, stays: it ended a runaway upload loop),
and uploads in the background. Each would be its own decision.

Reverse if: field diagnostics show the 2-minute stop on requests that would
have answered (many `no_answer` counts on good links, or a snapshot piece
that never finishes on a slow one), or a network change stopping requests
costs more syncs than it saves.
