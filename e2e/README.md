# End-to-end tests

Browser tests that run against the web export and the local Supabase stack.

- `ui/` is the web UI suite (Playwright, `npm run test:ui:web`, config in
  `ui.config.ts`). See `docs/ui-test-suite/README.md`.
- `web-smoke/` is the release web build in three browser engines
  (`npm run test:web-smoke`, config in `web-smoke.config.ts`).
- `fixtures/` holds the shared voice clip. `env.sh` reads the local stack's URL
  and keys from `supabase status`; `web.sh` and `web-smoke.sh` start the servers.
- `results/` is output and is not committed.

How the layers fit together: `docs/testing.md`. Jev, the model-driven journey
harness that used to live here, was shelved on 2026-10-14 (decision 102) and
lives in git history.
