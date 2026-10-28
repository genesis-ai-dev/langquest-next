# Each new decision is a file of its own in docs/decisions, named by its date and a few words; entries 1 to 178 keep their numbers in decisions.md

Date: 2026-10-27 · By: Caleb Koster · Status: accepted

Reason: every decision took the next number at the end of
`docs/decisions.md`, so two branches started from the same `main` took the
same number and wrote at the same place in the file. Of the 80 merges of
`main` into a branch from 2026-10-01 to 2026-10-27, 54 conflicted, and 51 of
those conflicted in `docs/decisions.md` (41 in it alone). Each one meant a
renumbering, another merge and every check run again. With many cloud
threads at once (`docs/decisions/2026-10-27-coding-threads-run-in-the-cloud.md`)
that would happen on most pull requests. Caleb chose (2026-10-27) to give
each new decision a file of its own:

- The file is named by its date and a few words of its title
  (`docs/decisions/README.md`). A thread knows the name when it writes the
  decision, before any pull request exists, and two branches never pick the
  same one. Naming the file by its pull request's number, as Rust and Ember
  name their RFCs, was the other choice; it needs a rename once the pull
  request opens.
- Entries 1 to 178 stay in `docs/decisions.md` with their numbers, since
  code and docs cite them about 3,000 times. They still take a new status or
  a dated amendment; no entry is added there.
- `scripts/decisions.test.ts` checks each file's name, title and
  `Date · By · Status` line, that the date matches the name, that a status
  names a decision that exists, that `docs/decisions.md` gains no entry, and
  that every decision cited by its path exists.
- This partly supersedes decision 35: the log is no longer one file, and a
  new decision has no number. 35 kept one numbered file because code cited
  numbers and one file read as a history; the old entries keep both, and the
  folder in name order reads as the history from here on.

Reverse if: reading decisions across many files proves harder than the
conflicts were. Then add a page generated from the files in date order,
rather than go back to numbers taken from one file.
