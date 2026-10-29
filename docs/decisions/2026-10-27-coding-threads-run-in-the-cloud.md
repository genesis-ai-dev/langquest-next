# Coding threads run on Claude Code's cloud machines, which scripts/cloud-setup.sh makes ready for `npm run guardrails -- --all`; what only a phone shows goes to one thread on the Mac

Date: 2026-10-27 · By: Caleb Koster · Status: accepted

Reason: coding threads ran through Remote Control on Caleb's Mac. Past three
or four at once, mostly through their iPhone simulators and Android
emulators, the Mac overheated and could crash, so asks waited for a free
slot. Claude Code's cloud machines (Linux, 4 CPUs, 16 GB, Docker; no charge
beyond the plan's usage) run as many threads as are asked for, but they
lacked what the guardrails need: Node 22 first on PATH where CI has 24, a
shallow clone that `npm run server-calls` cannot read, Docker not running,
Docker Hub refusing pulls (429 Too Many Requests on `node:24-slim`), and Edge
Functions in the local stack that could not load their npm packages,
because the machine's outbound HTTPS is re-signed by a proxy whose authority
containers do not trust, so every P0 UI test that signs someone in failed.
Caleb chose (2026-10-27) to move coding to cloud threads:

- `scripts/cloud-setup.sh` makes a cloud machine ready: Node 24, the full
  history, `npm ci`, Docker pulling Docker Hub's images through Google's copy
  (mirror.gcr.io), the stack's images and the job container's, an edge
  runtime image that trusts the machine's authorities (under its own name,
  so the Supabase CLI runs it), and Playwright's three browsers. The
  project's cloud environment runs it as its setup script (`--snapshot`), so
  threads start from a machine that has all of it; a thread runs it again
  first (AGENTS.md, Cloud threads), which then takes seconds.
- `npm run guardrails` fetches the full history in a shallow clone. `--all`
  starts the stack as CI does, on a Mac too: without the services the tests
  do not use, and without the language list, which SETUP-074 expects to be
  empty. On 4 cores or fewer it runs the P0 UI tests two browsers at a
  time, as each CI shard does; with four, pages loaded past the tests'
  waits.
- Cloud threads check screens in the web build. A check that needs a phone
  (native modules, gestures, the keyboard, permissions, audio, a store
  build) goes to one phone-check thread on the Mac, one simulator at a time.
- A cloud machine has no `.env.keys`, so decrypting env files, EAS, secrets
  and hosted databases stay on the Mac.

Reverse if: cloud threads use more of the plan than the time they save is
worth; the cloud machines lose Docker or the hosts they reach; or phone
checks queue behind the one Mac thread, when they move to GitHub Actions
(an Android emulator on Linux runners, the iPhone simulator on macOS
runners) or a hosted simulator service.
