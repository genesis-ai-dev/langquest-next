# Each document answers one question, and each fact has one home: PLAN.md the design, docs/ how each part works or what is planned, decisions why, CONTRIBUTING.md how a change lands, AGENTS.md only what agents do on top

Date: 2026-11-19 · By: Carl Sauder · Status: accepted

Reason: Carl found that PLAN.md, AGENTS.md, README.md and the decision log
had no clear separation of concerns. Reading every Markdown file the project
wrote (2026-11-10 to 2026-11-19) showed what that cost:

- PLAN.md said it was kept current, but it held a build log that still named
  lanes, partitions and `LaneCountrySet`, dated amendments in sections 9 and
  14, a 70-row event catalog that most features change, and section 14, a
  subsystem's spec and the most cited section.
- AGENTS.md, which every agent session loads, opened with an architecture
  primer and restated invariants 5, 7 and 8 and decisions 44, 58, 104 and
  105. Its guardrails, store and v2 sections were headed "whoever you are
  working for": rules for every contributor, not agent instructions.
- Built plans served as the reference. `docs/nearby-sync-plan.md`, cited by
  over 300 files, said "Nothing is built" after it merged;
  `docs/ops-dashboard-plan.md` said both "built" and "Nothing here is built
  yet"; the first-download wait rules shipped into the ops plan and not into
  `docs/admin.md`. Their status lines went stale three times in a week
  (pull request 550 fixes the last of them).
- `docs/README.md` listed about half of `docs/`, and a test count in it went
  stale twice.
- The decision log doubles as a running spec: 355 amendments, and 6 of the
  first 17 date-named decisions amended within two days of being written.

So:

- `README.md` says what this is, how to run it, the repository layout, and
  which file answers which question.
- `PLAN.md` holds the design that must hold: what we build, what we learned,
  the design in one paragraph, the invariants, the scale rules, the envelope
  and the conflict rules. It keeps its name and its section numbers, since
  about 160 citations name them ("PLAN.md section 14 rule 2", one in a
  shipped migration); a section that moved is a one-line pointer. The event
  catalog is `docs/events.md`, the protocol `docs/sync-protocol.md`, the
  file rules `docs/blobs.md` (their numbers kept), the design language
  `docs/ux/principles.md`, the spec's domain a section of
  `docs/ux/demo-parity.md`, the layout `README.md`. The build log and the
  open questions are gone: git and this log hold that history.
- Every doc in `docs/` says its kind on the line under its title: reference
  (how a part works now, edited in place in the same pull request as the
  code), plan (what is next, with a status of draft, accepted, in progress,
  built or dropped), report (dated, not kept current) or history.
  `docs/README.md` lists each one under its kind, and `scripts/docs.test.ts`
  holds both. When a plan's phase merges, that pull request updates its
  status and moves how the built part works into a reference doc.
- `CONTRIBUTING.md` holds how a change lands, for people and agents: where
  code goes, the guardrails (their table moved here, decision 150 amended),
  commit messages, secrets, store declarations, decisions, docs and v2
  records.
- `AGENTS.md` holds only what an agent does on top: what to read first, what
  to ask the developer first, the steps before a push, what to say about
  store answers and decisions (decisions 35 and 49 keep those there), and the
  skills. A folder's own rules are in its README (`packages/core`,
  `packages/sync`, `packages/v2-import`) or, for the app, `apps/mobile/AGENTS.md`,
  which agents load when they work there. AGENTS.md went from 253 lines to
  134 with no rule dropped.
- A decision records the choice and its reason; what was built goes in the
  reference doc it names (`docs/decisions/README.md`).

Reverse if: an agent breaks a rule that the old AGENTS.md stated and the new
one only points to. Then put that rule back in AGENTS.md as one line, not
the whole section. If `scripts/docs.test.ts` makes adding a doc a chore that
people skip, keep the index test and drop the kind line.
