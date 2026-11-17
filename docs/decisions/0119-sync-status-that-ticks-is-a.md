# 119. Sync status that ticks is a store of its own, read where it is shown, not part of `ctx`

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: every screen gets `ctx` (`apps/mobile/App.tsx`), and the native
stack keeps every screen under the top one mounted. `ctx` was a new object
on every render of `OrgWork`, and `OrgWork` rendered whenever a sync or
transfer counter moved, so one file arriving redrew every mounted screen and
re-ran their derived views. Each arrival also copied the set of files on the
phone (61,000 for a big language) to publish it (performance-audit-app.md
R1, R2). Now the counters that tick while syncing (`pending`, `lastSync`,
`pendingUp`, `pendingDown`, `peakUp`, `peakDown`, `present`, the
organization's `pending`) live in a `StatusStore` per session
(`src/sync/syncStatusStore.ts`), read with `useSyncStatus()` by the
components that show them. `ctx`, the language and organization handles and
`blobs` are memoized. Fields that change rarely (`online`, `refused`,
`pulled`, `live`, `revision`, `keptUnits`) stay on `ctx.language`. The
stack freezes blurred screens (`freezeOnBlur`), so audio stops on the
navigation `blur` event rather than on a render. The session reads the file
set in place, tells screens about it at most every 500 ms
(`FILE_NEWS_MS`, `packages/sync/src/languageSession.ts`), reclaims storage
at most that often, and keeps one offline-scope `Set` per fold revision,
which core's plan cache finds by identity. A scope `Set` is never changed
after it is handed to core. Turned down: `React.memo` on every screen (each
needs stable props from callers, and a new `ctx` defeats it anyway).
Reverse if: a screen needs a ticking value to decide what to draw on every
change; read it with `useSyncStatus()` there, rather than putting it back
on `ctx`.

Amended (2026-11-12, Carl Sauder): on React 19.1 and later the freeze that
`freezeOnBlur` uses (react-freeze 1.0.4) can re-commit frozen screens
without end; the stack keeps freezing them, with a mended `Freeze` (251).
