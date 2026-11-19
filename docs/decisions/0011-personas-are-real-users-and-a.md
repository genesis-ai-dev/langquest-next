# 11. Personas are real users, and a shared device pushes only its actor's events

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: a dev persona that only fakes session facets would emit events the
server rejects (actorId must match the caller). So switching persona is a
real sign-in as a seeded account, and "seed demo team" creates those
accounts and their memberships through the same events a coordinator would
use. Consequence for production: a shared phone can hold several users'
queued events; the client pushes only the current actor's, so nobody's
work is refused under someone else's session.

Amended (2026-10-03, Carl Sauder): on the web a browser may be a shared or
library computer, where the next person could read what the last one left.
So there, signing out (or deleting the account) deletes the databases, the
recordings and library documents, and every saved key, then reloads
(`forgetBrowser.ts`); it runs only after the unsent-work check of 12.
Phones keep the log as before.

Amended (2026-11-08, Carl Sauder): an event comes from its author, or from a
phone holding the author's valid signature, unless it is a redaction
(docs/nearby-sync-plan.md section 6, decision 236). A phone that reaches the
server sends teammates' signed work through the Worker's `POST /api/relay`,
which appends it as each author through `append_events`, so a shared phone
still pushes only its actor's own pending work, and nobody's work is sent
under the carrier's account: the relay checks the author's signature and
chain, and the server takes the author, not the caller, as the actor.
