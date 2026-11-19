# 132. An organization's Durable Object keeps under half its isolate, folds languages of unknown size one at a time, and a capped-heap test holds it there

Date: 2026-10-16 · By: Ryder Wishart · Status: accepted

Reason: on 2026-10-16 `/connect` answered 502 for people in a large
organization. The Worker log said "Durable Object's isolate exceeded its
memory limit and was reset": answering `session/orgs` asks each of the
person's organizations for their access, which on a cold object folds
every language, and one object went past Cloudflare's 128 MB. Two things
let it: the folder kept 40 MB of folds (`STATE_BUDGET_BYTES`, PR #150), and
a parsed fold takes about 1.8 times its serialized size, so a full budget
held about 72 MB before any request's own work; and a language with no
recorded size (a cold object, or a summary written before sizes were
recorded) counted as small, so four large languages were folded at once.
- `STATE_BUDGET_BYTES` is 12 MB (about 22 MB once parsed), and a language
  of unknown size is folded alone (`isLarge`). Once its summary records a
  size, small languages run four at a time again.
- `apps/web/test/memory/orgFolderMemory.test.ts` runs the real `OrgFolder`
  over two large organizations (twelve languages of about 5 MB of fold,
  and six of about 12 MB) in a Node heap capped at 112 MB, below the
  isolate's 128 MB for what it spends outside V8's old space. Events come
  a page at a time and folds are saved to disk, as Postgres and SQLite do
  in production, so the heap holds only what the folder keeps. It fails if
  the folder runs out of memory or keeps 48 MB or more between requests.
  It runs in `npm test`, so in the checks job on every pull request. With
  the 40 MB budget and parallel unknowns it fails both ways.
- Memory is now a property tests hold, like order-independence (102's
  lowest layer that can hold the check: a unit test with a capped heap,
  not a deployed canary).
Reverse if: Cloudflare raises the isolate limit, folds move out of the
heap (then the budget can grow), or production shows an organization the
test's shapes do not cover (then add that shape to the test).

Amended (2026-10-19, Ryder Wishart): the test now holds every memory user
in the object, not only the folder, and its shapes are known not to cover
the largest real organization.
- What `OrgSnapshot` keeps per organization: the folder's org fold,
  per-language summaries and saved cursors (grow with the number of
  languages, small) and its held folds (the 12 MB budget); the folds'
  derived indexes (core's WeakMaps, alive as long as a fold is held and
  outside the budget's count: about 11 MB more on the API path at
  60 × 300); the webhook dispatcher only a promise chain, with digests,
  the feed and the outbox in SQLite, and while scanning one language's
  fold and two digests at a time; `AgentOrg`'s write and upload counters,
  at most an hour of timestamps per key (600 writes, 100 uploads) but one
  key for every token and link that wrote since the object woke, never
  forgotten; and nothing else (no response or link caches). A partner API
  answer is at most 500 passages (0.7 MB of JSON at 5,000 passages a
  language).
- `orgFolderHeap.ts` runs one path per child process (fold, webhooks, api,
  reports, writes) over 12 × 2,000, 6 × 5,000 and 60 × 300 (many small
  languages). Each path also runs against the regression its bound stops
  (no fold budget; a dispatcher that keeps what it compared; a response
  cache; counters that keep every timestamp) and must fail there, so a
  check that can no longer fail fails.
- The budget is not enough on its own. After this decision was deployed,
  `/connect` still failed for Every Language (decision 140): 37 languages,
  ten over 89,000 events, the largest 230,430. In the harness one
  language of that shape no longer fits in 112 MB somewhere between about
  100,000 and 130,000 events (8,000 passages fit, 10,000 do not), however
  few are held. The test's shapes stop at 65,000 events a language, so
  they show the budget and the paths work for organizations up to that
  size, not that every real organization fits. Decision 140 took access
  checks off the full pass; reports, passage reads, writes and webhooks
  for a language past that size still do not fit, and need their own
  decision. When one exists, add a 1 × 18,000 shape (Every Language's
  largest) to the test.
- A post-deploy canary (`docs/routines/do-memory-canary.md`) is proposed
  beside the test, because Every Language showed what only production
  has: it reads a passage page of each of the largest real organizations
  once after each production deploy (every object is cold then) and reads
  the Worker log for "exceeded its memory limit". It is not running; it
  needs per-organization read tokens and a read-only Cloudflare token.

Amended (2026-10-20, Carl Sauder): the budget is now kept before a fold
is made, not only after. `keep` let go of older folds once the new one
was folded, so a fold of about the budget stayed held while the next
language was read from the cache or folded from its events: two folds,
the second's events and its measuring text at once. The fold path at
6 × 5,000 then ran out of its 112 MB heap on 4 runs in 10, on main as on
any branch, and failed pull requests at random. `stateOf` now makes room
for the language's recorded size first (`makeRoom`), counting a size not
recorded yet as large, as `isLarge` does; 16 runs in 16 passed. A unit
test in `worker.test.ts` holds the order: nothing the budget cannot hold
beside the next fold is held while it is folded.
