# Decisions, one file each

The architecture decision record (ADR) log for this app, after entry 178.
Entries 1 to 178 came before and are in [../decisions.md](../decisions.md),
where they keep their numbers. Every architecture or design decision, from
any developer or agent, gets a file here as it is made, so the files in name
order read as the history of how the design got to where it is. Each one has
the reason and what would change our mind.

## How to write one

Write one when a change is hard to reverse, would surprise a reader without
context, and came from a real trade-off. Typical triggers: a new merge shape,
partition, deployable, worker, queue or storage table; a dependency that
carries lock-in; a change to authorization, sync, or what the app keeps
offline; a deliberate departure from PLAN.md, the partner demo or an earlier
decision. A bug fix, a refactor that keeps behaviour, or a new event that
fits an existing merge shape does not need one.

Name the file by today's date and a few words of its title, in lowercase with
hyphens, such as `2026-10-27-one-file-per-decision.md`. A thread knows the
name before any pull request exists, and two branches never pick the same
one, so nothing is renumbered when they merge.

~~~md
# The decision, stated as a sentence

Date: YYYY-MM-DD · By: Full Name · Status: accepted

Reason: the context, what was chosen and why, naming the code that holds it.
Reverse if: the evidence that would change our mind.
~~~

- `Date` is the date in the file name. `By` is the developer who made the
  decision, not the agent that typed it.
- `Status` is `accepted`, `superseded by <name>` or
  `partly superseded by <name>`, where `<name>` is the later decision's file
  name without `.md`.
- Cite a decision by its path: `docs/decisions/2026-10-27-one-file-per-decision.md`.
  Entries 1 to 178 are still cited by number ("decisions.md 34").
- Never rewrite a past decision's reasoning. If a decision changes, write a
  new one that says "Supersedes <name>" (or "Supersedes 35") and set the old
  one's status. If it only narrows or extends, append a dated paragraph to
  it: `Amended (YYYY-MM-DD, Full Name): what changed and why.`
- Land the decision in the same commit or pull request as the change it
  explains. `scripts/decisions.test.ts` checks the format, and that every
  decision cited by its path exists.
