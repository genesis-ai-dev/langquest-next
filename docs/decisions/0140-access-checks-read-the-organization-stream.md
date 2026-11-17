# 140. Access checks read the organization stream alone, never a pass over its languages

Date: 2026-10-19 · By: Ryder Wishart · Status: accepted

Reason: after decision 132 was deployed, `/connect` still answered 502 for
people in Every Language (`org-v2-everylanguage`, reported 2026-10-18 and
2026-10-19; reproduced 2026-10-19 with the Worker log: "Durable Object's
isolate exceeded its memory limit and was reset" on `agentAccess`). That
organization has 1.75 million events in 37 languages, ten of them over
89,000 events and the largest 230,430. In the memory harness a single
language of that shape stops fitting in 112 MB between about 100,000 and
130,000 events, so no fold budget helps: one language alone is too big.
`/connect` asks only who may see what, which the organization stream
answers, but `AgentOrg.access` read `OrgFolder.orgState()`, which first runs
a full pass that folds every language.
- `OrgFolder.orgOnly()` catches up the organization stream alone (restored
  from the cache, then the log past it when its head moved, at most once a
  minute like a pass) and folds no language.
- `AgentOrg.access` (`/connect`'s `session/orgs`), the `languages` read
  (a token's `/me` and `GET /languages`), `linkOpen` and `mayRevokeLink`
  use it. Reports, passage reads, writes and the webhook dispatcher still
  need language folds and still use the pass.
- `apps/web/test/memory/orgAccess.test.ts` runs those checks over Every
  Language's real shape (its 37 languages' sizes) with a source that fails
  on any read of a language stream. Against the code before this change it
  fails.
This fixes `/connect` and token management only. Every Language's reports,
partner API passage reads and webhooks still fold languages too big for
the isolate; that needs its own decision (fold large languages outside the
object, or keep a smaller fold).
Reverse if: an access check needs something only a language fold has; then
that piece belongs in the organization stream or a summary, not a pass.
