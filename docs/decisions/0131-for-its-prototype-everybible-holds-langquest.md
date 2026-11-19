# 131. For its prototype, EveryBible holds LangQuest tokens on the phone: a reviewer's code is a review token, and listeners hear approved versions

Date: 2026-10-16 · By: Ryder Wishart · Status: accepted

Reason: Ryder wants the Every Language organization linked to EveryBible,
its review and listening app, with no bridge between them, while it is a
prototype. Partly supersedes 109's listening side: EveryBible no longer
goes through its bridge Worker.
- **A reviewer's code is a token.** An Every Language admin makes a token
  with `read` and `review` at `/connect` and shares it with reviewers. The
  phone checks it with `/me` (it must read drafts and review in some
  language), keeps it in the keychain and calls `/api/v1` itself. Revoking
  the token on `/connect` closes it for everyone who holds it. This departs
  from `docs/agent-api.md` ("`review` … tokens belong on a server") on
  purpose: anyone who holds the code can record listener reviews and, where
  a step takes links, reviews that count, as the admin who made it. That is
  acceptable while the code goes only to known reviewers.
- **Listeners use the app's own `read:published` token**, which the docs
  allow in an app: it hears approved versions only. Approved in LangQuest is
  published in EveryBible; no studio step. That token cannot write, so a
  listener without a code cannot send feedback; feedback after approval
  comes from phones with a reviewer code.
- **Freshness without webhooks.** A reviewer's phone reads each language's
  change feed every 4 s while the screen is open and then only the passages
  it names; a listener's token cannot read the feed, so it asks for passages
  changed since its newest `updatedAt` every 30 s, which folds the whole
  language list on LangQuest's side.
- `server/listeningDemo.ts` answers `/me` as LangQuest does and adds a
  `read:published` token (`.listening-demo/listener-token`) for testing.
Reverse if: codes reach people the team does not know, or listeners
without a code must send feedback (then a server holds the review token, as
109's bridge did, or LangQuest issues per-reviewer tokens by the device
flow); or listener polling shows up in LangQuest's load (then a cheaper
published change feed).
