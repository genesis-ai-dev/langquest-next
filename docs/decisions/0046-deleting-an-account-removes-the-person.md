# 46. Deleting an account removes the person and keeps the organization's work

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: Google Play and the App Store require that anyone who can create an
account in the app can delete it, from inside the app and by a request from
the web, and Play requires a privacy policy at a public address.
`_delete_account` (migration `20260930200000_delete_account.sql`) deletes the
sign-in and everything that names the person: `auth.users`, the profile
name, push tokens and receipts, inbox rows, join requests, the email on
invites, field diagnostics (decision 39) and the uploader mark on stored
audio. It ends every membership with the same `v1.OrgMemberRemoved` and
`v1.MemberRemoved` events an administrator would append, so every phone's
fold drops them, and erases the one name the log held (decision 47). The
events they authored and the audio those name are kept: recordings are the
organization's work under its license (decision 38), and without the
account the actor id on them is a random id that leads to no one. LangQuest
v2 kept contributions on deletion too. The person deletes from the app
(`delete_my_account`; Settings, and the screen for someone with no
organization yet), which waits for unsent work as sign-out does (decision
12). From the web they email a request, and staff run
`delete_account_for_email` in the Supabase SQL editor; the app cannot call
it. The app's Delete Account screen is app-only, beside the demo's
(`test/specParity.test.ts` drift log). The privacy policy and the request
page live on the LangQuest v2 website (langquest-website repository,
`/en/next/privacy` and `/en/next/delete-account`) beside v2's own, because
this repository's web app is not ready to be published; the app links there
(`apps/mobile/src/legal.ts`), and the text must change with what the code
keeps.
Reverse if: a partner, a privacy review or a regulator requires erasing a
person's recordings or words (then the log needs payload erasure beyond
names); or this repository's web app is published (then the policy and a
signed-in deletion page move there, and `legal.ts` and the store listings
follow).

Amended (2026-09-30, Caleb Koster): deletion also removes the person's
blocks, blocks of them, and the reporter mark on reports they sent
(decision 48). The reports themselves stay, for staff.

Amended (2026-10-05, Carl Sauder): the web app is published (58), so the
privacy policy and the deletion page move here, as the reverse condition
said: static pages served beside it, `https://next.langquest.org/privacy`
and `/delete-account` (`apps/mobile/public`), plain HTML that opens without
signing in. Signed-in deletion on the web is the app's own Settings, Delete
account, which the deletion page links to (`/settings`). The policy now
covers the web app, what a browser keeps and that sign-out removes it (11,
amended), and Cloudflare in place of Vercel; `legal.ts` and the store
listings follow. The old langquest.org pages should redirect here.
