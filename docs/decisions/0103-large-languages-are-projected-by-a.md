# 103. Large languages are projected by a scheduled GitHub job; the Edge pass leaves them out

Date: 2026-10-14 · By: Caleb Koster · Status: superseded by 141

Reason: the projection pass (decisions.md 68) runs in the
`stream-projections` Edge Function, and a run there gets 256 MB and 2 s of
CPU (Supabase's limits). The v2 transfer brought languages far past that:
folding Santhali omt bible (225,000 events, a 61 MB state) took about
850 MB in Node. From 15:30 on 2026-10-14 most passes ended with
`WORKER_RESOURCE_LIMIT` (546), so six of the largest languages had no
server snapshot, and every language the pass reached after them waited for
its Inbox rows and snapshot. Chosen:
- A language is large when its newest snapshot is 10 MB or more, or 25,000
  events or more have arrived since it (its whole log when it has none):
  `isLarge` and `LARGE` in `server/projectionWorker.ts`. Koro Miyan's
  40 MB snapshot did pass in the Edge Function at times; 10 MB leaves room
  for the tail, the indexes and the Inbox rows.
- The Edge pass projects only the small ones (`runProjections(service,
  'small')`) and visits languages smallest first, so a language too big for
  one run holds up only bigger ones.
- `.github/workflows/projections.yml` runs the same pass for the large ones
  every ten minutes with Node's memory (`server/projections.ts`), using the
  service-role secret the v2 import already has. The repository is public,
  so Actions minutes cost nothing, and the log prints counts only.
- Inbox rows in a large language can arrive about ten minutes later than in
  a small one (GitHub can start scheduled runs late). Pushes still go every
  minute once a row exists.
- The service role's requests get two minutes instead of the 8 s they
  inherit from `authenticator` (migration
  `20261014180000_service_role_timeout.sql`): `put_snapshot` for Kuturmi,
  Halbi and Santhali (35 to 61 MB) was cancelled at 8 s. Only the server's
  own jobs use that role; people's requests keep 3 s (anon) and 8 s
  (authenticated). Caleb chose this over writing a snapshot in several calls.
- The large pass goes on past a language that fails and lists it by id, so
  one failure holds up no other language.

Not chosen: a bigger Edge Function (the limit is fixed per run); folding page
by page in the Edge Function (the state alone outgrows 256 MB); a Worker or
server of our own (another deployable to run for what is meant to be
temporary). The lasting fix is loading per unit, so no single fold holds a
whole language (the report "Big languages on phones: what to change").

Reverse if: per-unit state makes every language fit the Edge Function, or
GitHub's schedule lags enough that people in large languages notice late
Inbox updates. Then the pass moves to a host with a steady schedule.
