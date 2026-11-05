---
name: architecture-tradeoffs
description: 'Architecture decisions in the style of Mark Richards and Neal Ford (Fundamentals of Software Architecture, Software Architecture: The Hard Parts). Use when choosing or questioning an architecture style, adding a service, worker, queue, cache or new deployable, splitting or merging modules, weighing a design trade-off, writing an entry in docs/decisions.md, or proposing a fitness function. Also use when someone asks "should this be a microservice / separate worker / separate database".'
license: MIT
---

# Architecture trade-offs for LangQuest Next

Richards and Ford's two laws frame everything here:

1. **Everything in software architecture is a trade-off.** If you think you found
   one that isn't, you haven't found the trade-off yet.
2. **Why is more important than how.** Record the reasoning, not just the choice.

The style for this app is already chosen (PLAN.md sections 3 to 5, docs/decisions.md).
Use this skill to keep new work consistent with it, and to reopen a decision only
with evidence against the characteristics that drove it.

## Step 1: name the characteristics at stake

Architecture characteristics ("-ilities") are the non-domain qualities the
design must support. Richards' advice: pick the **few that drive** the design
(aim for three to seven), not every desirable one, because each adds cost and
they pull against each other.

Driving characteristics for this app, in priority order:

| Characteristic | What it means here | Evidence in the design |
| --- | --- | --- |
| Partition tolerance / offline availability | A translator works for a month with no link and loses nothing | Local log, fold on append, outbox (invariants 1, 7) |
| Data integrity | No event lost or silently dropped; every device converges | Append-only log, idempotent commutative events (invariants 1 to 3) |
| Evolvability | Old clients live for months; schemas and rules change | Versioned events, reducer-version snapshots, `CLIENT_PROTOCOL_VERSION` |
| Testability / determinism | Logic is provable without devices or servers | Pure reducer in `packages/core` (invariant 8), property tests |
| Simplicity (support cost) | The failure modes of v2 and Codex must not return | One schema, no merge engine, no trigger rollups (PLAN.md section 2) |
| Elasticity per tenant (later) | A mid-size org arrives without a rewrite | Tenant on every row, bounded pages, async folds (PLAN.md section 5) |

Implicit characteristics (security, usability, cost) always matter; do not trade
them away silently. When a change touches one of these, say which one, and
whether it strengthens or weakens it.

Classify any new requirement as **operational** (availability, performance,
recoverability, scalability), **structural** (evolvability, deployability,
testability, maintainability) or **cross-cutting** (security, privacy,
accessibility, legal). That tells you whether the answer lives in
infrastructure, code structure, or policy.

## Step 2: know the architecture quantum

A quantum is an independently deployable piece with high functional cohesion
whose parts are bound together synchronously. Characteristics are measured per
quantum, which is why a single app can have different answers in different
places.

This system has two quanta, joined only by **asynchronous** sync:

- **Device quantum**: Expo app with its SQLite event store, local fold, and outbox. It
  must be fully available offline, so it can never make a synchronous call to the server
  on the path of a user action.
- **Server quantum**: Postgres `append_events` / `pull_events`, validation, and
  membership fold on the write path, with workers (snapshots, projections, blob
  reconciliation) consuming the log asynchronously.

Any proposal that makes a user action wait for the server synchronously merges
the two quanta. It breaks the top characteristic. Reject it unless the action is
inherently online (sign-in, invitation acceptance), and say so explicitly.

## Step 3: place the change in a style

Richards and Ford compare styles by how they rate on each characteristic. They
publish the comparison in their styles worksheet (linked below); use their
ratings as the reference, not memory. In outline:

- **Layered** is cheap and simple, but its evolvability and testability are
  weak once it grows. Not suitable as the organizing idea here.
- **Modular monolith** puts domain partitions in one deployable. It is simple and
  cheap, but its boundaries need discipline. This is how `packages/core` and
  `apps/mobile` are organized internally, by domain module (passage, workflow, org,
  materials), not by technical layer.
- **Microkernel** is a core system plus plug-ins, which suits product lines and
  customization. Organization-defined review flows, content templates and catalogs
  are configuration data interpreted by the core, which is close to this idea.
  Prefer adding configuration over adding code paths per partner.
- **Event-driven** (broker topology) is highly scalable, responsive and fault
  tolerant, but it is harder to test and reason about end to end. The server side
  is this: one append, then independent consumers of the log.
- **Space-based** is for extreme, spiky concurrency. It does not apply here.
- **Service-based** means a few coarse services sharing a database. It is the
  sensible first step if the server ever splits.
- **Microservices** give maximum independent deployability and scale, at the
  highest cost and complexity. Only consider them with a concrete, measured need
  that a worker cannot meet.

The app's architecture: **event sourcing on a modular monolith per quantum,
with ports and adapters** (`EventStore`, `Transport`) at the infrastructure
seam and **event-driven async workers** on the server. New work should fit one
of those shapes. A new consumer of the log is cheap and consistent. A new
synchronous service, a second database of record, or a mutable table beside the
log is a style change, and needs a decision record.

## Step 4: analyse the trade-off honestly

For any non-trivial choice:

1. State the question in one sentence.
2. List two or more real options (include "do nothing").
3. For each option, name which driving characteristics it helps and hurts. Use
   the table from step 1, not generic pros and cons.
4. Check coupling. What becomes **statically** coupled (shared types,
   shared schema)? What becomes **dynamically** coupled (synchronous calls,
   ordering, shared transactions)? Dynamic coupling across the two quanta is
   the expensive kind here.
5. Pick one, and say what evidence would reverse it.

Beware of the "out of context" trap: a pattern that is best practice elsewhere
(expected-version optimistic concurrency, ordered projections, last-writer-wins
rows, sagas) may be wrong for commutative, order-independent events. The
`event-sourced-sync` skill lists those.

## Step 5: record it

Record decisions in `docs/decisions.md`, **not** a new `docs/adr/` folder. Match its
format (see its header): a numbered heading, a `Date: · By: · Status:` line,
`Reason:`, and `Reverse if:`. `By` is the developer, not the agent. Supersede or
amend past entries; never rewrite them. Write one only when the
choice is hard to reverse, surprising without context, and the result of a real
trade-off. When code and PLAN.md disagree, fix the code, then update PLAN.md in
the same change.

## Step 6: guard it with a fitness function

A fitness function is an automated check that an architecture characteristic
still holds. This repo already has several; keep them green and extend them rather
than adding prose rules:

| Characteristic | Fitness function |
| --- | --- |
| Order independence, idempotence | `packages/core/test/reducer.test.ts` permutation and doubling tests (fixtures in `packages/core/test/fixtures.ts`) |
| Validation parity, core vs SQL | `scripts/record-parity-sql.ts` |
| UX flow parity with the partner demo | `apps/mobile/test/flow.test.ts` against `spec-flow.json` |
| Pure core, no I/O | `packages/core/package.json` has no `dependencies`; `npm run typecheck` |
| Small requests | Page size 200 client-side, 500 server cap (invariant 12) |

When proposing a new rule, ask "what test would fail if someone broke it?" If
there is no answer, add one (for example, a test that `packages/core/src`
imports nothing outside itself).

## Sources

- Richards and Ford, *Fundamentals of Software Architecture*, 2nd ed. (O'Reilly, 2025)
- Ford, Richards, Sadalage and Dehghani, *Software Architecture: The Hard Parts* (O'Reilly, 2021)
- Architecture styles worksheet: https://www.developertoarchitect.com/downloads/architecture-styles-worksheet.pdf
- Architecture characteristics worksheet: https://www.developertoarchitect.com/downloads/architecture-characteristics-worksheet.pdf
- Software Architecture Monday lessons (identifying characteristics, trade-offs,
  ADRs, fitness functions): https://www.developertoarchitect.com/lessons/
- Ford, Parsons, Kua and Sadalage, *Building Evolutionary Architectures* (fitness functions): https://evolutionaryarchitecture.com/
