# Decisions

The decision log is now [decisions/](./decisions/), one file per decision
([2026-11-17-one-file-per-decision](./decisions/2026-11-17-one-file-per-decision.md)).
[decisions/README.md](./decisions/README.md) says how to write one.

Code and docs cite decisions 1 to 256 as "decisions.md N". Decision N is the
file `decisions/NNNN-….md`: "decisions.md 34" is
[decisions/0034-an-organization-holds-its-languages-directly.md](./decisions/0034-an-organization-holds-its-languages-directly.md),
for example.

Add nothing to this file. `scripts/decisions.test.ts` fails if it gets an
entry.
