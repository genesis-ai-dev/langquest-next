# A resolved line of the ops dashboard comes back when its problem comes back

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: the dashboard works out each line again at every load. On 2026-11-23
the line "R2 class A operations this month are past what the plan includes"
(`capacityAlerts` in `apps/admin/src/sources/storage.ts`) stayed on the
Overview after Caleb had looked at it, and it would stay until the month
ended. He asked for a way to say a problem is resolved, "but not in a way that
would ignore future issues". Now each Overview row and each line's card has a
Resolved button (`apps/admin/src/pageResolve.ts`, migration
`20261124013000_ops_line_resolves.sql`, `docs/admin.md`).

- **A resolve hides one line as it is now, never a kind.** The resolve keeps
  the line's id, its level and its measure at the time. A new line (a new job
  that stopped, a new subject) shows at once.
- **The line comes back by rules the page can prove from what it reads.** It
  shows again with the tag "Came back" when it is more serious, its measure
  doubled (usage past the plan: the cost), its count starts again (a new
  month for a monthly count; a check that counts the last hours, once those
  hours are all after the resolve; a daily check's next run), or 7 days went.
  The kind's own `recheck` (`apps/admin/src/alertKinds.ts`) says which count
  applies, so no list of rules per kind is kept by hand. A kind whose size
  grows under one line can add `measure` to its alert.
- **A line that goes ends its resolve.** The watch for user issues already
  asks the dashboard for its lines every 15 minutes, as a server step. It now
  also asks which lines are there and which parts answered
  (`OpsLines.present()`) and ends each resolve whose line went from a part
  that answered (`ops_line_resolves_seen`). The next time the problem comes,
  it shows at once. The page itself writes nothing when it loads.
- **Only the page hides it.** The watch for user issues and
  `/ops/api/attention` still see every line, so a resolved problem still gets
  its Linear issue and its fix.
- **Who resolved it shows.** The Overview's Resolved list names the admin
  (display name only) and when, with Show again, as every tap's record does
  (`docs/decisions/2026-11-21-every-dashboard-tap-shows-its-state.md`).

Not chosen: a snooze for a time the admin picks (it hides a new problem in
that time); hiding a kind of line (it would ignore the next problem of that
kind); one rule per kind written by hand (more than 100 kinds, and the rules
go stale as kinds change); the page writing "the line went" when it loads (a
write on every view, and a page nobody opens would never end a resolve).

Reverse if: resolved lines come back so often that admins stop using the
button, or a problem stays hidden that a person should have seen. Then change
the rules in `resolveBack`, or the 7 days.
