# 38. An organization's work has one license, and it only opens

Date: 2026-09-29 · By: Caleb Koster · Status: accepted

Reason: partners need to say who may use what their teams record and write,
and that decides what people outside an organization may see (Caleb,
2026-09-29). An organization chooses a license when it is created, starting
at All rights reserved, and may later move only to a more open one: work
that went out under open terms stays out for whoever copied it, so the app
must never offer to close it again. The licenses are a ladder where each rung
allows everything below it (All rights reserved, CC BY-NC-ND, CC BY-NC-SA,
CC BY-SA, CC BY, CC0; `packages/core/src/license.ts`). `v1.OrgLicenseSet`
lives in the org partition and folds as a ratchet, a new merge shape: the
most open license ever set wins, and the earliest event that set it is kept.
It is commutative and idempotent like a register, but a late, more closed
choice from an offline admin changes nothing, so the server accepts it
rather than refusing what a phone could not have known. Only Manage Roles at
organization scope may set it (Organization Admin by default). Outsiders may
look inside an organization's work under any Creative Commons rung and never
under All rights reserved; they read a safe projection, never the log, and
never the record (reviews, notes, names). The demo has no license screen, so
this adds a sheet to Create Organization and Organization Home without new
flow nodes. `REDUCER_VERSION` is 7 so no checkpoint that skipped the event
survives. Design and the plan for public access: `docs/licensing.md`.
Reverse if: partners need a language to be more open than its organization;
then add a per-language license whose floor is the organization's, not a way
to close this one. If they want outsiders to see only CC0 work, move
`outsidersMayView` in `LICENSE_INFO`; the ladder and the event stay.
