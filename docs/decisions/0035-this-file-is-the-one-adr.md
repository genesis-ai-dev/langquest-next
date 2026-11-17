# 35. This file is the one ADR log, and agents keep it for every developer

Date: 2026-09-29 · By: Caleb Koster · Status: partly superseded by 2026-11-17-one-file-per-decision

Reason: several developers, each working through their own agent sessions,
were making design decisions, and only some of them reached this file. So
every entry now says when it was made, by whom and whether it still holds,
backfilled from git history for 1 to 34. The rule that keeps the file current
lives in AGENTS.md, which every agent reads whoever is driving it. The format
is checked by `scripts/decisions.test.ts`, not just described. We kept one
numbered file rather than a `docs/adr/` folder because code and docs already
cite entries by number, and one file reads as a history. Reverse if: the file
grows too long to scan; then split it into one file per entry and keep the
numbers.
