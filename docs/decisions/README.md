# Decisions

The architecture decision record (ADR) log for this app, one file per
decision. It is the only one: every architecture or design decision, from any
developer or agent, gets a file here as it is made, so the files in name order
read as the history of how the design got to where it is. Each one has the
reason and what would change our mind.

- Decisions 1 to 256 are `NNNN-few-words.md`, by number
  (`0034-….md` is decision 34). Code and docs cite them by number:
  "decisions.md 34" or "decision 34".
- Each later decision is `YYYY-MM-DD-few-words.md`, by its date and a few
  words of its title. It has no number. Cite it by its path:
  `docs/decisions/2026-11-17-one-file-per-decision.md`.

Two branches never write the same file, so a new decision never conflicts
with another branch's, and nothing is renumbered when they merge
([2026-11-17-one-file-per-decision](./2026-11-17-one-file-per-decision.md)).

## How to write one

Write one when a change is hard to reverse, would surprise a reader without
context, and came from a real trade-off. Typical triggers: a new merge shape,
partition, deployable, worker, queue or storage table; a dependency that
carries lock-in; a change to authorization, sync, or what the app keeps
offline; a deliberate departure from PLAN.md, the partner demo or an earlier
decision. A bug fix, a refactor that keeps behaviour, or a new event that
fits an existing merge shape does not need one.

Name the file by today's date and a few words of its title, in lowercase
with hyphens, such as `2026-11-17-one-file-per-decision.md`. Pick words that
another branch is not likely to pick on the same day.

~~~md
# The decision, stated as a sentence

Date: YYYY-MM-DD · By: Full Name · Status: accepted

Reason: the context, what was chosen and why, naming the code that holds it.
Reverse if: the evidence that would change our mind.
~~~

- `Date` is the date in the file name. `By` is the developer who made the
  decision, not the agent that typed it.
- `Status` is `accepted`, `superseded by <id>` or `partly superseded by <id>`.
  `<id>` is a later decision's number (`superseded by 150`) or its file name
  without `.md` (`superseded by 2026-11-17-one-file-per-decision`).
- Never rewrite a past decision's reasoning. If a decision changes, write a
  new one that says "Supersedes 35" (or the file name) and set the old one's
  status. If it only narrows or extends, append a dated paragraph to its
  file: `Amended (YYYY-MM-DD, Full Name): what changed and why.`
- Never add a numbered file. Decision 256 is the last number.
- Land the decision in the same commit or pull request as the change it
  explains. `scripts/decisions.test.ts` checks the format, and that every
  decision cited by its path or by "decisions.md N" exists.
