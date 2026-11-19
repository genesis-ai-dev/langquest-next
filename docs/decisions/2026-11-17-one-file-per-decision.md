# Each decision is a file of its own in docs/decisions; decisions 1 to 256 keep their numbers, and each later one is named by its date and a few words

Date: 2026-11-17 · By: Caleb Koster · Status: accepted

Reason: every decision took the next number at the end of
`docs/decisions.md`, so two branches started from the same `main` took the
same number and wrote at the same place in the file. An amendment to a busy
entry did the same. From 2026-10-28 to 2026-11-17, 93 merges of `main` into a
branch were made; 46 conflicted, 40 of them in `docs/decisions.md`, and 33
in that file alone. Each one meant a renumbering, another merge and every
check run again; PR 487 met it again on 2026-11-17. Caleb first chose
date-named files for new decisions on 2026-10-27 (PR 255), but that pull
request also held the cloud setup and never merged, while 58 more numbered
entries did. On 2026-11-17 he asked for the whole file to become one file per
decision:

- Decisions 1 to 256 are `docs/decisions/NNNN-few-words.md`. They keep their
  numbers and their text, since code and docs cite them by number about 3,000
  times ("decisions.md 34"). `docs/decisions.md` stays as a short page that
  says where decision N is, so those citations still lead somewhere. An
  amendment or a new status goes in that decision's own file, so two
  branches conflict only when both amend the same decision.
- Each later decision is `docs/decisions/YYYY-MM-DD-few-words.md` and has
  no number. A thread knows the name when it writes the decision, before any
  pull request exists, and two branches do not pick the same one. Numbers
  would need one place that hands them out; a test can only find two
  branches that took the same number after both are written, which is the
  renumbering this ends. Naming the file by its pull request's number, as
  Rust and Ember name their RFCs, was the other choice; it needs a rename
  once the pull request opens, and one pull request can hold many decisions
  (PR 403 held 41).
- `scripts/decisions.test.ts` checks every file's name, heading and
  `Date · By · Status` line; that numbered files run 1 to 256 with no gap and
  no new one; that a date-named file's date matches its name; that a status
  names a decision that exists; that `docs/decisions.md` gets no entry; and
  that every decision cited by its path, or as "decisions.md N", exists.
- This partly supersedes decision 35, as its own "Reverse if" foresaw: the log
  is no longer one file. Agents still keep it for every developer
  (AGENTS.md, Decision log).

Reverse if: reading decisions across many files proves harder than the
conflicts were. Then add a page generated from the files in name order,
rather than go back to numbers taken from one file.
