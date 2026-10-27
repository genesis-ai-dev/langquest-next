# Global Viewers

A Global Viewer is a LangQuest support person who can open any organization
and see it as its admins do: its work, members and setup. Nothing they do
changes an organization. Their access works only after they enter a code
from an authenticator app when signing in. Why it works this way:
`docs/decisions.md` 158. How it is built: "How it works" at the end.

An operator is anyone who can run SQL on the hosted project (`npx supabase
link` to it). Operators grant, revoke and reset; nothing in the app can.
Every command takes `--hosted` for the hosted project; without it, it works
on the local database.

## Making a Global Viewer

Do it on a call (voice or video) with the person, someone you know. Emails
are on any domain and signing up proves nothing about owning the address, so
the call is the check.

1. **They have an account**: the one they already use, or a new one. An
   everyday account works (a Global Viewer may belong to organizations), but
   it is then signed in on more devices; a separate one, such as
   `carl+viewer@example.org`, keeps Global Viewer access to one or two.
   Either way, a long password.
2. **You grant it**, while they wait:

   ```bash
   npm run global-viewer -- grant carl+viewer@example.org --note "LAN-123, support for the Dinka team" --hosted
   ```

   It refuses, saying why, an account that already has an authenticator,
   a looked-after account and a suspended one. A revoked account can be
   granted again: its old authenticators and sign-ins are cleared first.
3. **They set up their authenticator**: in the app, Me → Global Viewer →
   Set up authenticator. They scan the code (or, on a phone, open it in
   their authenticator app), then type the 6-digit code it shows.
4. **You check**:

   ```bash
   npm run global-viewer -- list --hosted
   ```

   It must show one authenticator, verified a minute ago. If it was
   verified before you watched it happen, someone else may have set it up:
   run `revoke`, and they start again with a new account.

## Day to day

After signing in, an account in no organization lands on "What brings you
here?", with Global Viewer first; one in an organization lands in it, and
the eye in the header opens Global Viewer. There they type the code their
authenticator shows; until they do, they see only what their own
memberships show. Global Viewer then finds an
organization by its name or a language's name. Inside one, the eye in every
header opens Global Viewer again: the organization they are in, and the
search for another. The code is asked for once per sign-in.
Opening an organization downloads its organization stream, and each language only when
it is opened.

On the web, Global Viewer also links to the ops dashboard
(`/ops-dashboard`, decisions.md 160), which lets in the same accounts. It
opens in a new tab and takes the web app's verified session, so the code
is not asked for again. Phones do not show the link: a phone's browser
would not share the app's session.

## Ending it

```bash
npm run global-viewer -- revoke carl+viewer@example.org --hosted
```

Access is off at once, and every sign-in of the account ends at its next
request. For up to a minute the Worker may still serve a file it had already
allowed (decisions.md 121). The account is then an ordinary one: signing in
shows "Global Viewer access has ended" and the usual ways to join an
organization. To make it a Global Viewer again, `grant` it on a call as at
first; its old authenticators are cleared. When someone leaves LangQuest,
revoke, then delete the account (`delete_account_for_email`, decisions.md
46) or suspend it (`npm run moderation -- suspend`).

## A lost authenticator

Check who they are on a call, never by email alone. Then:

```bash
npm run global-viewer -- reset-mfa carl+viewer@example.org --hosted
```

This removes their authenticators and signs them out everywhere. Still on
the call, they sign in, set up a new one (step 3 above), and you check
`list` (step 4).

## Before the first Global Viewer on a hosted project

Authenticator codes have to be on there. They are set in
`supabase/config.toml` (`[auth.mfa.totp]`), but merging doesn't apply Auth
settings: run `npx supabase config push` for that project
(`docs/environments.md`, Auth settings).

## How it works

| Rule | Where it holds |
| --- | --- |
| Access needs an active row in `public.global_viewers` and an `aal2` session (a code entered this sign-in) | `_gv_on`, checked on every request |
| Every stream but people's own, every file, the library and members' names may be read | `can_read_stream` (`_can_read_stream_at`), `blob_access` (`p_aal` from the Worker), `_library_member`, `global_viewer_directory`, `profile_visible` |
| Nothing may be written | `may_emit` never asks about Global Viewers; the app's read-only session refuses every append (`src/shell/readOnly.ts`) |
| A Global Viewer may belong to organizations, with their own role there | nobody signs them in for them (`may_help_sign_in`); a revoked account is an ordinary one |
| A file check said without the session's level refuses | `blob_access` with no `p_aal`: a path that forgets it keeps Global Viewers out |

In the app:

- `get_user_state` says `globalViewer`: `needs_setup`, `needs_code`, `on`
  or `revoked` (`src/account/useGlobalViewer.ts`). The Global Viewer screen
  (`src/screens/globalViewer.tsx`) sets up the authenticator, takes the
  code, and lists organizations (`global_viewer_organizations`).
- In an organization they are not in, the session is read-only
  (`deriveSession`): it has an Organization Admin's management privileges
  but not those for doing the work (Translate, Review, Fill reference, Send
  to reviewers), so Manage looks as its admins see it and a passage offers
  no Edit, Record, review or note. `readOnly` wraps the organization's and
  the language's handles so nothing is appended, and the recorder refuses
  to open the microphone (`isReadOnlySession`). The two hooks that
  write by themselves (`useLibraryFollow`, `useTranslatorReview`) skip a
  read-only session, and a server refusing a write says so in words
  (`readOnlyRefusal` in `failureMessage`). Controls that go by the
  organization's own roles, such as renaming it, stay hidden.
- An eye in every header ("Global Viewer" beside it on a wide window,
  `src/account/GlobalViewerLink.tsx`, through `src/ui/headerExtra.ts`), in
  any organization, theirs too, until access is revoked. It opens the
  Global Viewer screen: the code if it is still needed, the organization
  they are viewing, then every other one. Their tabs are an admin's without Work and the Inbox, where
  nothing arrives for them (decision 71, amended).

Not built, on purpose (Carl Sauder, 2026-10-21): support changing anything
in an organization. Support talks an admin through a change instead; if
hands-on help is ever needed, the admin invites the support person's
ordinary account, not their Global Viewer account, and removes it after.
Granting support a membership that ends by itself was planned and dropped
for its size (a new versioned event, a clock in every privilege check).
