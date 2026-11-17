# 158. Global Viewers read every organization, read-only, and only on a session verified with an authenticator

Date: 2026-10-22 · By: Carl Sauder · Status: accepted

Reason: LangQuest's support people need to see any organization to help
it, and until now saw one only by being invited into it (Carl Sauder,
2026-10-14). A Global Viewer may open every organization and read what a
Viewer there would: every stream but people's own, member names, files.
Who is one is the server's own state, not an event: a row in
`public.global_viewers` (migration `20261022210000_global_viewers.sql`),
like a suspension, since a role in every organization's stream would be
pulled by every member's phone and an organization stream holds only that
organization (decision 63). The one read gate, `can_read_stream`, takes it
(`_can_read_stream_at`), so pulls, snapshots and their pieces follow; the
Worker passes the token's `aal` to `blob_access` for files (an unsaid level
refuses a Global Viewer, so a path that forgets it keeps them out), and
`global_viewer_organizations` and `global_viewer_directory` list
organizations and names. Read-only, not a Global Admin: `may_emit` never
asks about Global Viewers, so every write is still explained by the
organization's own log (invariant 9) and decision 98 stays as it is.
Support changing an organization is not part of this (see the amendment).
Named Global Viewer, not admin, because in
this app admin means someone who can change things (Carl, 2026-10-15).
Access works only on an aal2 session (Carl, 2026-10-14): TOTP is switched
on for the project (`[auth.mfa.totp]`), only Global Viewers are shown how
to set it up, and a password alone, a sign-in code or a hand-over gives an
aal1 session that sees nothing; `may_help_sign_in` refuses a Global Viewer
target anyway. A Global Viewer may belong to organizations, where their
own role applies, so support and Frontier staff use their own accounts
(Carl, 2026-10-21); it costs Global Viewer access riding on an everyday
account, signed in on more devices. Accounts are granted on a call
(`npm run global-viewer`, docs/global-viewers.md): emails are on any
domain (Carl, 2026-10-20) and sign-up proves nothing about owning one, so
what counts is that the person, known to the operator, signs in on the
call and sets up an authenticator while the operator watches `list`.
`grant` takes any account with no authenticator, however old (Carl,
2026-10-21: the call, not the account's age, shows whose it is). `revoke`
keeps the row and ends every sign-in, and the account is then an ordinary
one; granting it again clears its old authenticators and sign-ins first,
so nothing from before is trusted. `reset-mfa`, for a lost authenticator,
is run after a call with the person, never on an email. No log of what a Global Viewer opens (Carl, 2026-10-14): the
protection is few accounts, the authenticator and revoking at once.
`supabase config push` brings the auth setting to hosted projects and is
run by hand (Carl, 2026-10-20; docs/environments.md). The Worker may still
answer a file check from its one-minute cache after a revoke (decision
121). No new event type.
Reverse if: a partner or a privacy review needs every look logged (then
log `global_viewer_*` reads and opens of an organization); more than a
handful of people need it (then a staff screen with its own checks, not a
script); or an authenticator proves too weak for the reach (then passkeys,
or a fresh code before each organization).

Amended (2026-10-21, Carl Sauder): a Global Viewer reads an organization as
its admins see it, not only as a Viewer: support questions are mostly about
setup (roles, members, templates, review flows), which a Viewer never sees.
The session shows an Organization Admin's privileges and is read-only: the
organization's and the language's handles refuse every append
(`src/shell/readOnly.ts`), the hooks that write by themselves skip it, and
a server refusing a write says so (Carl chose this over hiding each edit
control screen by screen: one guard covers every screen, including later
ones, at the cost of controls that look live and say nothing can change).
The library's read check, `_library_member`, lets a Global Viewer whose
access is on pass (migration `20261022220000_global_viewers_manage.sql`);
its one write, `library_adopt`, still needs a privilege they never hold.
Letting support change things in an organization, as a membership that ends
by itself, was planned and is not built (Carl, 2026-10-21): it needed a new
versioned event and a clock in every privilege check. Support talks an admin
through a change, and the admin can invite the support person's ordinary
account if hands-on help is ever needed. Reverse if: support often needs to change
things themselves (then a membership with an end, from a join request and a
server timer that removes it, rather than a new event).

Amended (2026-10-23, Carl Sauder): a read-only session no longer gets the
privileges for doing the work (Translate, Review, Fill reference, Send to
reviewers), only an admin's management ones, so a passage offers a Global
Viewer no Edit, Record, review or note. Carl's reason: the one write guard
kept nothing that was recorded, but letting someone record a take that is
then thrown away is bad. The recorder also refuses to open the microphone
in a read-only session (`isReadOnlySession` in `src/shell/readOnly.ts`,
read by `useRecorder`), for any record control left elsewhere. That guard
loads with the recorder, so a first visit's web budget rose to 5.75 MB
(`apps/mobile/scripts/export-web.mjs`).

Amended (2026-10-23, Carl Sauder): a passage's record offers a read-only
session nothing at all (`recordCan` in `src/passage/recordModel.ts`), though
an admin's management privileges still hold Assign work and Override
checkpoints. So a Global Viewer gets no check's sheet (ask someone, already
happened, not now, move past), no Undo or Withdraw in the history, no "Something
else?" way forward beyond what helps and keeping it offline, and no report flag
(`ReportFlag`). Carl's reason: the review screens should not give the
impression that a Global Viewer can take review actions. Manage keeps its
controls under the one write guard, as decided on 2026-10-21.
