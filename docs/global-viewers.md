# Global Viewers

A Global Viewer is a LangQuest support person who can open any organization
and see what a Viewer there sees. Nothing they do changes an organization.
Their access works only after they enter a code from an authenticator app
when signing in. Why it works this way: `docs/decisions.md` 158.

An operator is anyone who can run SQL on the hosted project (`npx supabase
link` to it). Operators grant, revoke and reset; nothing in the app can.
Every command takes `--hosted` for the hosted project; without it, it works
on the local database.

## Making a Global Viewer

Do it on a call (voice or video) with the person, someone you know. Emails
are on any domain and signing up proves nothing about owning the address, so
the call is the check.

1. **They make a new account of its own**, not the one they use in any
   organization, with an email they read, for example
   `carl+viewer@example.org`. The web app is easiest. Use a long password.
2. **You grant it**, while they wait:

   ```bash
   npm run global-viewer -- grant carl+viewer@example.org --note "LAN-123, support for the Dinka team" --hosted
   ```

   It refuses, saying why, an account more than 24 hours old, one that
   already has an authenticator, one that belongs to an organization or has
   asked to join one, a looked-after account and a suspended one.
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

Each time they sign in, the app asks for a code from the authenticator.
Without it ("Not now") the account sees nothing. Me → Global Viewer → All
organizations finds an organization by its name or a language's name.
Opening one downloads its organization stream, and each language only when
it is opened.

## Ending it

```bash
npm run global-viewer -- revoke carl+viewer@example.org --hosted
```

Access is off at once, and every sign-in of the account ends at its next
request. For up to a minute the Worker may still serve a file it had already
allowed (decisions.md 121). The account stays marked as a former Global
Viewer and can't be granted again; if they come back, they make a new
account. When someone leaves LangQuest, revoke, then delete the account
(`delete_account_for_email`, decisions.md 46).

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
