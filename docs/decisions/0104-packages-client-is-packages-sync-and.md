# 104. `packages/client` is `packages/sync`, and it owns anything a device queues for the server

Date: 2026-10-14 · By: Carl Sauder · Status: accepted

Reason: the package began as the client half of the sync protocol (the
first scaffold, PLAN.md section 10), and the name was never written down
or revisited. It since took on jobs that run on servers (`snapshotWorker`,
`blobReconciler`, `workerBlobs`, `v2import`), and is imported by the Worker,
`server/`, the scripts and the tests as well as the phone, while most
readers take "client" to mean "the app". That made its boundary hard to
explain, and two outbound queues had grown up in `apps/mobile` beside it:
the account outbox (`durableOutbox.ts`) and the uploads of a shared phone's
hand-over (`handOverCore.ts`, 60). Carl chose (2026-10-14):

- Three layers, by the question each answers. `core`: what does the data
  mean? `sync`: is it kept, sent, received and current? The apps: what does
  a person do and see, and what runs it on this platform?
- `sync`'s scope is anything queued for the server, not only events and
  their files, so the account outbox, a hand-over's delivery attempt and
  the per-language session (the `SyncClient`, both `TransferWorker`s, the
  scheduler and storage reclaim, formerly built inside `useLanguage`) move
  into it. Each takes its platform pieces as arguments.
- The boundary is held by what a file imports: core, supabase-js and its
  own files, plus Node built-ins under `src/testing`
  (`packages/sync/test/boundary.test.ts`). Drivers, file stores,
  `AsyncStorage` and configured clients stay in the app that uses them.
- The reasons: every runtime that keeps or moves data runs the same queuing
  and transfer code, so none copies it and gets it subtly wrong; everything
  a device queues for the server goes through one tested place; and the
  name now says what the package does. `sync` rather than `eventsync`,
  since not all of it is events, and `core` keeps its name: its contents
  still match it and the no-I/O rule stops it collecting everything shared.

Older entries and records that say `packages/client` mean this package.

Reverse if: a second app needs a different outbound policy than the phone
(the queues would split back into the apps behind a shared interface), or
the server-side jobs grow their own dependencies that the phone must not
carry, which would argue for a separate server package.

Amended (2026-10-26, Carl Sauder): sync has a second entry,
`@langquest-next/sync/server` (`packages/sync/src/server.ts`), for what only
servers run: the snapshot worker, the blob reconciler, the Worker's R2
files, the stream list, the per-unit cut and `foldStream`. The phone and
the web app import `@langquest-next/sync` and no longer carry them. A
separation-of-concerns audit found the single entry had pushed server code
to copy sync instead of importing it: `server/reconcileJob.ts` kept its own
`foldStream`, reconciler wiring and a "missing" count by a different rule
than the reconciler repairs by, so as not to grow the web app's first
visit, and three server jobs imported `packages/sync/src/*` by path. The
reconciler now counts what is missing with core's `isStored` and can stop
early, and the job only builds its deps. ESLint now also reads `server/`,
`apps/web/worker`, `apps/web/jobs`, `apps/admin/src` and
`packages/v2-import/src`, with one rule: packages by their entry, and
nothing from `apps/mobile/src` (shared code goes in core). This is still
one package, not the separate server package the reverse-if names: the
server entry imports only what sync already may.

Amended (2026-11-07, Carl Sauder): sync has a third entry,
`@langquest-next/sync/nearby` (`packages/sync/src/nearby.ts`), for sharing
between phones: the room, the session, the link and radio contract, the wire
and what a page needs at the door (`docs/nearby-sync-plan.md` 5.12). It is
absent from `index.ts`, so the web app, which has no Share nearby (58), does
not carry it. It imports only what sync already may; a platform's crypto,
radio and files come in as arguments (`NearbyCrypto`, `NearbyRadio`,
`NearbyFileMoves`). The lint rule that keeps the app on package entries
(`noDeepPackage` in `eslint.config.mjs`) names it as the one subpath the app
may import. Its test doubles are in `src/testing` with the rest
(`memoryNearbyLink.ts`, and `fleet/nearby.ts` for the fleet).
A `SyncClient` takes the nearby half (`nearbyClient(platform)`,
`packages/sync/src/nearbyClient.ts`) as an optional constructor argument,
`nearby`, which reaches the client's private state through a narrow port
(`NearbyPort`); only the Android app passes it, and `syncClient.ts` keeps
what every client needs. Core is split the same way:
`@langquest-next/core/nearby` (`packages/core/src/nearby.ts`) names core's
`nearby*` files, which core's `index.ts` does not, because Metro carries
every module an entry names into the web bundle, used or not. Sync's own
files may import it.

Amended (2026-11-07, Carl Sauder): only `.android` files in
`apps/mobile/src` import `@langquest-next/sync/nearby` or
`@langquest-next/core/nearby` (`nearbyOnAndroid` in `eslint.config.mjs`,
`docs/nearby-sync-plan.md` 5.12), each with a plain stub beside it where a
file on every platform needs it, so the web and iPhone bundles carry
neither: a `.web` stub would ship on iPhones. The phone's crypto is built in
the app (`src/nearby/nearbyCryptoModel.ts`, `@noble/curves` and
`@noble/hashes`) and reaches sync as `NearbyCrypto` and as the platform of
`nearbyClient`, and `LanguageSession`'s `client` option passes `nearby` on
to its `SyncClient`.

Amended (2026-11-16, Carl Sauder): iPhones share nearby too (256), so a
phone's own file imports the nearby entries: `.native` (Android and
iPhones), `.android` or `.ios` (`nearbyOnPhones` in `eslint.config.mjs`), each
with a plain stub beside it, which only the web bundle takes. What a phone
offers only on Android (joining offline, the install file, the disguise)
stays in `.android` files, so an iPhone gets their plain stubs, and no
`.native` file names a `.android` one (`apps/mobile/test/nearbyIphone.test.ts`).
An iPhone's permission prompt is `src/nearby/nearbyPermissions.ios.ts`,
beside Android's.
