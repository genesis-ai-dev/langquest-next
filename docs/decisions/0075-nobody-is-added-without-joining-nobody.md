# 75. Nobody is added without joining, nobody grants more than they hold, and one id names one event

Date: 2026-10-09 · By: Carl Sauder · Status: accepted

Reason: a security audit of who may post and read events (2026-10-09) found
that the write path trusted too much of what a phone sends. Anyone who
signed up could make an organization, add any profile id to it, and then,
being an Invite holder who shares an organization with them, issue that
person a sign-in code: a takeover of any looked-after account whose id they
had seen. A Coordinator, who holds Invite but not Manage roles, could make
themselves Owner or remove the Owner. Event ids are chosen by phones and
the server's own are predictable (`removed:<event>`,
`accountdeleted:<person>:<scope>`, `invitemember:<invite>`, the v2
import's), and an id already in the log made the server skip its own
event, so a content author could make a moderator's removal do nothing. A
second `v1.TakeComposed` with a take's id replaced its audio under the
reviews it had, and a backdated clock let a member replace someone else's
review, note or request. Carl chose that the grantor may only grant scopes
and roles they currently hold. Migration
`20261009130000_event_integrity_and_grants.sql`:
- A person's `v1.MemberAdded` may name only themselves or someone who has
  held a membership in that organization; newcomers come in by invite or
  join request, whose memberships the server appends. Sign-in help reads
  only memberships the person joined themselves (`_joined_by_consent`) and
  needs the helper to cover all of them (59).
- `_grant_refusal`: a role given, invited to or admitted to carries no
  privilege the grantor lacks at that scope; a role changed or removed, or
  defined or retired, is one they could have granted. An invite redeems
  only while its issuer could still issue it. Core `mayGrantRole` and
  `mayChangeMembership` say the same, and the role pickers offer only
  those roles.
- An event id names one event: a resend is a duplicate, the same id on
  anything else is refused (`event id already used`), and the server's id
  prefixes are refused from people (`_server_event_id`).
- One create, one entity: a recording, take, response, review, departure,
  request, note, key-term rendering or adjustment id is used by one event in
  its stream (`_entity_key`, core `entityKeyOf`, held together by the
  parity script). The fold keeps the earliest of each in every order, so
  logs that already hold a duplicate fold the same everywhere (reducer
  version 12). The translation guide's material and key terms keep sharing
  ids by design, as do units (two phones applying one template) and a
  take's link to a key term; for those the fold keeps the earliest too, a
  tie settled by author and content, instead of whichever arrived first.
  Submissions, materials, invites and join decisions settle a same-clock
  tie the same way (`ties.ts`).
- A redaction is never redacted (16, amended).
- An organization is bootstrapped only while nobody else has written to it,
  so ids the library seed or an import used cannot be claimed, and the v2
  import refuses an organization someone else created (`--existing-org`).
- Review links and tokens: 72, amended.
The service role (imports, seeds, the Worker) still writes as the actor it
names, as 64 said; these checks are for people. A translator may still log
a check from outside the app (29), which completes ordinary steps; that is
the design, not a gap. SQL tests: `server/grantsSmoke.sql`, and the
takeover in `server/joinSmoke.sql`.
Reverse if: teams need to place people they have not invited (then a
consent step on the person's side, not a direct add), or a partner's
custom roles need someone to grant more than they hold (then a privilege
that says so, held by owners only).

Amended (2026-10-09, Carl Sauder): the audit's low findings that were cheap
to close (migration `20261009140000_audit_low_findings.sql`). `may_emit` is
service-role only, like `org_privileges`, since it answers for any profile.
Writing a file needs more than reading its stream (`blob_access`): a
language's files are written by whoever holds more than View there, once it
is listed; the organization's guide files by whoever manages its library;
a person's stream by nobody, so no upload makes a stream nobody listed. The
language tables hide `creator_id` from everyone but the service role. In
the Worker, a voice note must be stored no more than six hours before it is
attached, since a redaction drops the event but not the file, so a hash
seen before a removal cannot bring the audio back; a closed review link
answers only that it closed; and files are served with `nosniff`.

Amended (2026-10-13, Carl Sauder): the app now offers a write only where
the server will take it. Library events go in the organization's stream,
so they need the privilege at organization scope (`languageOfOrgEvent`,
`may_emit`). A language lead's role in one language does not cover them,
but the screens asked `session.can`, which counts it. So the screens
offered template edits and updates, breaking up a book, new or followed
flows, guides, library material and "Add a Bible", and the server then
refused them, some after a success toast. Those controls are now hidden
from anyone without the privilege at organization scope (`mayWriteLibrary`
in `library/model.ts`, `lib.canWrite`). Choosing one of the organization's
own templates or flows for the language, its own checks, and recommending
or hiding a Bible are the language's own events, and stay available to the
lead. The UI test suite holds this (SETUP-061 to 066, MAP-023).

Amended (2026-10-13, Carl Sauder): nobody may leave the organization
without someone who can manage roles (98).

Amended (2026-10-15, Carl Sauder): a resend is a duplicate even while the
first push is still being inserted. A push that timed out on a weak link
is retried with the first still in flight (the client no longer overlaps
its own pushes, `SyncClient.exclusive`, but a lost response still races on
the server). `append_events` checked the id before it took the stream's
lock, so the retry passed that check, waited on the lock, and found the
entity id taken: it refused the event, and the phone folded out work the
server holds; an event with no entity id failed the whole batch on the
primary key. Every event now takes its stream's lock once it is authorized
and valid (`_next_seq` took it anyway, so nothing waits longer) and checks
the id again under it, answering a stored event of the same organization,
stream, actor and type as `duplicate` with its seq. The lock comes after
authorization so nobody makes or holds a stream they may not write. The
same id pushed to two different streams at once still fails one batch on
the primary key; the retry is then refused (`event id already used`), as
it should be. Migration `20261015180000_append_duplicate_under_lock.sql`;
SQL test `server/concurrentAppendSmoke.sql`, two sessions over dblink.

Amended (2026-10-15, Carl Sauder): the server's own events race the same
way. `_append_event_as` (blob verdicts, invites redeemed, join decisions,
redactions, account deletions, library pins) checked the id before
`_next_seq` locked the stream, so two Worker or projection passes
appending the same id at once failed the second on the primary key and
aborted its caller's transaction. It now takes the stream's lock and
checks the id again under it, returning null as it says it does.
Migration `20261015190000_append_event_as_under_lock.sql`; cases 4 and 5
of `server/concurrentAppendSmoke.sql` (`record_blob` twice at once).

Amended (2026-11-08, Carl Sauder): proof of a key can now sign someone in to
an account made from a chain, until that key's first session, which
`install_keys.first_session_at` records (Carl's answer 10; 244). It signs in
only an account whose `app_metadata.chain_key` is that key, that is looked
after, with the key's row unrevoked and no first session yet, so an ordinary
account's certified key gets nothing. `nearby_certificate_facts` closes the
window on all of the person's rows, as does either `take_sign_in_code`
function, so a helper's code on another phone ends it too. After that, a
helper's code as for anyone. "Nobody is added without joining" still holds:
a newcomer joins by redeeming a pass whose stops the server checks (240),
and the id they come in with follows from their key, so it cannot name a
member, an imported person or a deleted account (241, 245).
