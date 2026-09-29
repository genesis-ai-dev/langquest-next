# Brief: getting in, the welcome, Inbox and Settings

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/entry.tsx`: `SignIn`, `TermsPrivacy`, `ExploreHome`, `CreateAccount`, `ScanQr`, `Vision`, `IntentChooser`, `CreateOrg`, `RequestAccess` (already exists on the old spec; rework to the demo's flow and look, keep the working auth/invite/RPC logic)
- `apps/mobile/src/screens/onboarding.tsx`: `Welcome` (`welcome`)
- `apps/mobile/src/screens/account.tsx`: `InboxHome`, `SettingsHome`, `ProfileEdit`, `OrgSwitcher`, `SignOutConfirm`, `SyncStatus` (exists; rework)
- `apps/mobile/src/DevMenu.tsx` (the demo-team seed only, see below)

## Demo sources
`src/screens/entry.tsx`, `src/screens/onboarding.tsx`, `src/screens/account.tsx`. Requirements AUTH-1..8, ONB-1, ONB-2, ONB-6 (creating an organization), INBOX-1, INBOX-2, NAV-2. ADR-022, ADR-028.

## Build
- SignIn: email and password; the terms line under Sign In ("By signing in you accept the Terms of Use and Privacy Policy", tappable to `terms_privacy`); on sign-in call `ctx.acceptTerms()`. Routing after sign-in is App's job (first sign-in goes to `welcome`).
- CreateAccount, ScanQr (the invite summary "Invite for {name} · {role} · {org} · from {inviter}" once decoded), ExploreHome, IntentChooser ("What brings you here?"), CreateOrg (then `my_work`, with a celebration message via `ctx.toast`), RequestAccess ("Waiting for {org}"). Keep the existing working logic; restyle with kit.tsx; follow the demo's edges.
- Vision: three cards of one sentence each. No Listen buttons (no text-to-speech is installed; the real app will play recorded prompts).
- Welcome: who invited you (org invites in `ctx.org.state`, when known), your role on which team, two or three plain lines for your role (translator, reviewer, admin, viewer), "Show me how" and "Skip for now" both call `ctx.markWelcomed()` then `ctx.go('my_work')` via the home_hub edge (practice tours are not ported; say so in the report), "What is LangQuest?" -> `vision`.
- InboxHome: `ctx.inbox.updates` grouped Unread / Earlier with the demo's wording (requests, reviews of your versions, answers to your feedback, requests done); tapping one opens the passage (`ctx.openPassage`) and `ctx.inbox.markRead`. Join requests from the existing server notifications / join_requests with "Assign role & accept" (-> `edit_member`) and "Decline" (existing RPC). Keep the saved account-changes section.
- SettingsHome: account and app rows only: Edit Profile, Switch Organization, Getting started (-> `my_work` with `{ showGettingStarted: '1' }`), What is LangQuest? (-> `vision`), notifications, Sync (-> `sync_status`), the dev menu when allowed, Sign Out.
- ProfileEdit, OrgSwitcher, SignOutConfirm, SyncStatus: keep their logic, restyle.
- DevMenu "Seed demo team": after seeding, also give the lane a name (`v1.LaneNamed`) and a flow via core `commands(...).useFlow({ laneId, flowId: 'standard_bible' })`, so the Map and record have something to show.
