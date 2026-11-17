# 120. Passage views are patched per published copy from a change log kept outside the state

Date: 2026-10-15 · By: Carl Sauder · Status: accepted

Reason: the app publishes a shallow copy of the live state after each fold
change (`stateCopier`), and the derived views were cached by state identity
and revision, so every copy re-sorted every take, request and note and
re-derived every passage: 41 ms at 5,000 passages on a laptop, several
hundred ms on a slow phone, after each recording (performance-audit.md item
10, performance-audit-app.md C1). Now, while a view is watching a live
state, the reducer records what each event may change
(`packages/core/src/changes.ts`, `touchedBy`): specific takes, reviews,
departures, requests, notes and passages, nothing, or `all`. The app
publishes with `publishedCopy`, and `recordIndexes` and `indexesOf` build a
copy's views from the previous copy's, re-deriving only touched passages.
The log lives in `WeakMap`s beside the state, never in it or in a snapshot,
and holds at most 1,000 entries; past that, or after any `all`, the next
view rebuilds in full. Any event type not checked against the views is
`all`, the default for new types. `packages/core/test/incrementalViews.test.ts`
holds patched views equal to a full rebuild for every fixture event in
random order. One new take: 2.0 to 2.6 ms instead of 43 at 5,000 passages
(`npm run bench:core`). Equal clocks in `highlightsFor` and `updatesFor`
are now ordered by id. Turned down: maintaining every view per event (too
much to keep correct) and caching passages by a hash of their inputs (about
as costly as deriving them). Reverse if: the views start reading state the
touch rules do not follow (a passage view that reads `recordings`, say)
and keeping `touchedBy` in step costs more than the rebuild it saves.
