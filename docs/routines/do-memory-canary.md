# Durable Object memory canary (proposed, not running)

Runs: after each production deploy of the app's Worker
(`langquest-next`), found the way `post-deploy-smoke.md` finds Live
issues: every 15 minutes, for a deployment it has not checked yet.
Tools: `wrangler` (deployments, tail), `curl`, `npm run diag -- --hosted`
(read-only). Writes: one comment per deployment on the digest issue (LAN-33),
and an issue when it fails. Never rolls back by itself.

Status: a proposal (decisions.md 132, amended 2026-10-16). Nothing here is
deployed or scheduled. It needs the credentials below and a person's yes.

## Why

`apps/web/test/memory/orgFolderMemory.test.ts` holds each path of an
organization's Durable Object inside a 112 MB heap over synthetic
organizations. It cannot see what only production has: a real
organization's shape (a language bigger or stranger than the test's), the
isolate's memory outside V8's heap, or a runtime change on Cloudflare's side.
On 2026-10-16 the first sign was people's `/connect` answering 502, and on
2026-10-19 it was still failing for Every Language, whose largest language
is past what any fold budget can fit (decisions.md 140). A deploy
resets every object, so the first request after it is the coldest one an
object sees, and the canary can make that request itself, before people do.

## Prompt

Check that the largest organizations' Durable Objects still answer after a
deploy, and that none was reset for memory. Report; change nothing.

1. Find the newest production deployment
   (`npx wrangler deployments list --config apps/web/wrangler.jsonc`). If
   LAN-33 already has a line `DO canary <deployment id>`, stop.
2. Pick the organizations: the five with the most events, from
   `diag.largest_orgs(5)` (a content-free function to add: organization id,
   language count, summed stream heads, the largest language's head; see
   "Needed first"). Add any organization in `CANARY_ORG_IDS` that is not
   among them.
3. Start the log watch before any request:
   `npx wrangler tail langquest-next --format json` into a file,
   in the background. Then, for each organization, one at a time:
   - `GET https://next.langquest.org/api/v1/me` with that organization's
     canary token: what `/connect` asks. It reads the organization stream
     only (decisions.md 140), so it must answer quickly however large the
     languages are.
   - Then one page of the largest language:
     `GET /api/v1/languages/<id>/passages?include=audio&limit=500`. On a
     cold object this runs a full pass, folding every language, which is
     what a report or a partner app's first read does.
   Allow 60 seconds for each answer. Record status and time, never the body.
4. Stop the tail 30 seconds after the last answer. Search it for
   `exceeded its memory limit`, `exceededMemory` and `Durable Object reset`.
   Also query Workers Observability for the same strings since the
   deployment's time, which catches real requests the tail missed.
5. Pass: every answer 200, and no memory line. Comment
   `DO canary <deployment id> ok` with each organization's id, language count
   and time to answer.
6. Fail: any 5xx, a timeout, or a memory line. Comment
   `DO canary <deployment id> failed` with the organization ids, statuses and
   the log lines (they carry no content), and open an issue "Durable Object
   over its memory after deploy <id>" if none is open. Say in it which
   organization and which request, and add that organization's shape
   (languages, passages, takes per passage) to the memory test's shapes in
   `orgFolderMemory.test.ts`. A person decides whether to roll back
   (`npx wrangler rollback`); this routine has no write access to the Worker.

Never print a token, never keep an answer's body, never write to an
organization.

## Credentials

| What | For | Where it lives |
| --- | --- | --- |
| Cloudflare API token, Frontier R&D account (`6a80496d…`): Workers Scripts Read, Workers Tail Read, Workers Observability Read | steps 1, 3, 4 | the routine's environment as `CLOUDFLARE_API_TOKEN`; read-only, no Edit |
| One LangQuest access token per canary organization, scope `read:published` | step 3 | made on the connect page by an admin of that organization, who agrees to it; encrypted in `.env.production` as `CANARY_ORG_TOKENS` (`orgId=lq_…` pairs) with `npm run env:update -- production CANARY_ORG_TOKENS` |
| `DIAG_DATABASE_URL` (the `diag_reader` role) | step 2 | already in `.env.production`, read on the routine's machine as `deploy-watchdog.md` does |

`read:published` is the narrowest scope: `/me` answers the organization's
name and language list, and the passage page shows approved passages only.
It is enough, because what costs memory is the fold behind the answer, not
the answer. The tokens never write, so revoking one (on the connect page)
costs nothing but that organization's check.

A signed-in session (`/api/v1/session/orgs`) would check every organization
of one person in a single request, but it needs a person's account that is
a member of each large organization, and its password or refresh token on
the routine's machine. Per-organization tokens are narrower and each
organization's admin can see and revoke theirs, so this proposal uses them.

## Needed first

- `diag.largest_orgs(n)`: a migration adding a content-free function the
  `diag_reader` role may call (`stream_cursors` summed per organization).
  Until then, `CANARY_ORG_IDS` lists the organizations by hand.
- The canary tokens, from each organization's admin.
- A Cloudflare API token with the read permissions above.
- A routine in Claude made from this file, once a person has reviewed it.
- A fold for languages too big for the isolate (decisions.md 140). Until
  then Every Language's passage read fails on every deploy, which says
  nothing new; check only its `/me` until that decision lands.
