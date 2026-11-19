# 49. What we told the app stores is kept in the repository and held to the code

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play's data safety form, content rating, target audience and
app access answers are commitments Google enforces, and they were entered
by hand in Play Console, where nobody working on the code sees them. A
change that adds a permission, an SDK or a field to diagnostics could make
them untrue without anyone noticing. `docs/play-store-declarations.md`
records every answer and why; `scripts/playDeclarations.test.ts` fails when
the Android permissions, Expo plugins, mobile dependencies or diagnostics
allowlist change without that file's facts block being updated; AGENTS.md
("Store declarations") tells agents to update the file in the same change
and tell the developer which Play Console answers to change. The test
cannot see everything (a new event field with personal data, a new kind of
content), so the instruction to agents carries the rest.
Reverse if: Google offers an API for these declarations (then apply them
from the file, as infrastructure as code), or the guard fails so often on
dependency changes that it is ignored (then narrow it to SDKs that can
collect data).
