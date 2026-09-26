# Gap analysis: entry, onboarding, account, settings, inbox, role homes, tab bar

Scope: journeys that start at sign-in and end on a role home, plus the account side (Inbox, Settings, Profile, Switch org, Sign out) and the shell (tab bar, home routing, toast + Undo, notifications).

- Reference: `ux/` = branch `caleb-spoken-mobbin-overhaul` at `52a3933`. File refs are relative to the `ux/` root.
- Ours: paths are relative to `langquest-next/`.
- Read only. Nothing in either repo was changed.

## 0. Findings that apply to every journey

1. **The reference branch changed very few entry and account journeys.** `git diff origin/main...HEAD` shows these kinds of change in entry, onboarding and account:
   - Visual changes: dark gradients became light screens (ADR-010), and targets grew to 48px or more (ADR-008).
   - Persona cards on sign-in.
   - A pending "Waiting for {org}" state on `intent_chooser`.
   - Inbox rows that open the passage record, with per-type icons and an empty state.

   The **large** changes are structural:
   - Home routing: everyone who does or asks for work lands on `my_work` (ADR-017).
   - A new tab set: My Work, Map, Manage, Inbox, Settings.
   - `notify()` / `markHandled()`, and a toast with Undo.
2. **The reference `src/imports/*.flow.md` files are stale.** They were not changed on the branch (last commit `bca4d70`). For example, `app-entry.flow.md` still says create_org "lands on Org Home" and describes a "View UX flowchart (Dev only)" screen. `notifications-inbox.flow.md` still says "Go to related item". **Use `src/flow.ts` and the screen files as the source of truth, not the `.flow.md` files.**
3. **Our flow-parity test pins the OLD spec.** `apps/mobile/test/spec-flow.json` has 55 screens, including `assignments_home`, `language_status` and `translate_passage`. It was vendored from `ux` main by `scripts/extractSpecFlow.ts`. The first mechanical step of the port is:
   - Run `npx tsx scripts/extractSpecFlow.ts <ux checkout on the branch>`.
   - Commit the new JSON.
   - Rework `APP_ONLY` and `SPEC_RETIRED` in `apps/mobile/test/specParity.test.ts:18-72`, and `SPEC_SCREENS` in `apps/mobile/test/flow.test.ts:4-17`.

   Some specParity assertions are hard-coded to the old homes, for example `specParity.test.ts:136-138`: `for (const h of ['intent_chooser','assignments_home','org_home','project_home','language_home','status_home'])`. That list must become `['intent_chooser','my_work','status_home']`, and `org_home`, `project_home` and `language_home` must be asserted via `manageHomeFor` instead.
4. **Gate vocabulary differs.**
   - Reference `EdgeGate` (`src/flow.ts:120-123`): `guest | home | translator | reviewer | contributor | asker | assigner | manageTemplates | manageReference | manageFlows`.
   - Ours (`apps/mobile/src/flow.ts:74-77`) has `fillReference` and lacks `contributor` and `asker`.
   - Map them in `edgeAllowed` (`apps/mobile/src/session.ts:90-103`):
     - `contributor` = `can('translate') || can('review')`
     - `asker` = `can('send_to_reviewers') || can('assign_work')`

     Our `send_to_reviewers` is the reference's "Ask for Reviews".
   - The reference also has `Override Checkpoints` (`src/data.ts:167-171`). We have no such privilege (`packages/core/src/org.ts:24-38`). That gap is outside this domain, but the Manage-tab test in `manageHomeFor` uses `MANAGE_PRIVILEGES`, so flag it to the record/flow analysis.
5. **Persona cards on sign-in are demo scaffolding.** They sign in without a password. The equivalent in our app is `DevMenu` "Switch persona" (`apps/mobile/src/screens/entry.tsx:65-69`). **Do not port them to production sign-in.**

---

## 1. Journey checklist

### [ ] J-ENTRY-1: A returning member signs in and lands on their home

**Personas:** translator (Akol), reviewer (Mary), org, project and language admin (Sarah, Priya, Deng), viewer (Grace).

**Reference:**
1. `sign_in` (`src/screens/entry.tsx:38-129`) has, from the top:
   - Logo tile, **"LangQuest"**, and the subtitle **"Coordinating Bible translation — draft to approval"**.
   - A demo block: **"Try it as someone on the team"**, persona cards (`PersonaCard`, `:15-36`) and **"More roles (N)"** / **"Fewer roles"**.
   - A divider: **"or sign in with email"**.
   - A card with the Email and Password inputs and a **"Sign In"** button (disabled until email is non-empty, `:99`), then **"Don't have an account? Create Account"**.
   - A text button **"Browse public projects"** and **"Show or hide the guide & screen map"** (demo).
2. Tapping Sign In calls `go(postSignInScreen(email))` (`src/App.tsx:1244-1248`):
   - First-time → `terms_privacy` (edge `sign_in→terms_privacy` replace, `src/flow.ts:132`). See J-ENTRY-2.
   - Otherwise → `home_hub` (replace, `:133`), which fans out (`:153-155`):
     - `intent_chooser` (no org)
     - `my_work` (translator, reviewer, and **all admins**)
     - `status_home` (viewers)
3. `homeScreenFor` (`src/domain/session.ts:118-124`): hasNoOrg → `intent_chooser`; isViewer → `status_home`; admin or worker → `my_work`.

**Ours today:**
- `SignIn` (`apps/mobile/src/screens/entry.tsx:28-72`): title "LangQuest", email and password inputs, **"Sign in"** `ActionButton`, "Create account", **"Forgot password?"** (app-only, keep), and "Switch persona" in dev.
- Routing is an invariant, not an edge: `App.tsx:298-313` resets to `postSignInScreen(session)` once both folds load, or to `cachedHome` before that (`:284-297`).
- `homeScreenFor` (`apps/mobile/src/session.ts:106-113`): hasNoOrg → `intent_chooser`; org admin → `org_home`; project admin → `project_home`; lane admin → `language_home`; viewer → `status_home`; else `assignments_home`.

**Gaps:**
- Admins land on their Manage home, not on My Work (ADR-017, `docs/decisions.md` ADR-017).
- Our worker home is `assignments_home` (a To Do / Doing / Done task list). The reference's is `my_work` (For you / Recent / Waiting on others). See J-HOME-1.
- The subtitle copy is missing. "Sign in" is lowercase; the reference says "Sign In". Sign-in stays a text-fallback U screen, so copy is allowed.
- The reference has no "Forgot password?". Ours is real auth, so keep it as an app-only affordance. There is no edge because it stays on the screen.
- Our cached-home logic (`App.tsx:284-297`) caches whatever `homeScreenFor` returns. After the change, most caches become `my_work`. **An existing cache of `org_home` sends an admin to the wrong place on the first launch after the update.** The `home !== cachedHome` branch at `:292-296` fixes it once the folds load, which is acceptable, but test it.

**Changes:**
- `apps/mobile/src/session.ts`:
  - Rewrite `homeScreenFor`: `hasNoOrg → 'intent_chooser'`; `isViewer → 'status_home'`; `isAdmin || isWorker → 'my_work'`; fallback `'intent_chooser'`. Match the reference fallback at `session.ts:123`.
  - Add `manageHomeFor(s)`: `adminScope.level` org, project or lane → `org_home`, `project_home` or `language_home`, else undefined.
  - Add `mapScreenFor(s)`: `isWorker && !isAdmin` → `map_home` (our `language_status` until renamed), else `status_home`.
- `apps/mobile/src/flow.ts:119-125`:
  - Replace the six hub fan-out edges with three: `home_hub→intent_chooser`, `home_hub→my_work` and `home_hub→status_home`, all `replace` with gate `home`.
  - Delete `home_hub→org_home`, `project_home` and `language_home`, and `home_hub→assignments_home`.
- Rename or replace `assignments_home` with `my_work`. See J-HOME-1 and the mapping table.
- `entry.tsx` SignIn: add the subtitle; change the label to "Sign In"; keep the yellow `ActionButton` as the one action; keep "Create account" and "Forgot password?" as muted text links.
- `App.tsx:395` `home` and every `ctx.home` caller now go to `my_work` for admins. Grep for `ctx.home()` callers and check that none assume `org_home`. The `Walkthrough` and `Vision` screens call `ctx.home`.

**Data or events:** none. Home is derived from privileges we already have.

### [ ] J-ENTRY-2: A first-time user accepts the terms, reads the vision, then lands home

**Persona:** any role, first session on this device or account.

**Reference:**
1. `terms_privacy` (`src/screens/entry.tsx:142-183`):
   - Back (→ `sign_in`, reset, `flow.ts:144`) and the title **"Terms & Privacy"**.
   - Intro: **"Before you use LangQuest, please review and accept our Terms of Use and Privacy Policy."**
   - Card **"Terms of Use"** with body copy, and card **"Privacy Policy"** with body copy.
   - A checkbox row **"I accept the Terms of Use and Privacy Policy"**.
   - **"Continue"**, disabled until checked, → `vision` (replace, `flow.ts:143`).
2. `vision` (`:187-213`) has 5 steps from `VISION_STEPS` (`src/data.ts:1133-1139`):
   1. "Scripture in every language"
   2. "Every passage keeps a record"
   3. "Your method is advice"
   4. "Do it yourself, or ask someone"
   5. "Progress the whole team can see"

   Each step has an emoji, title, body and a 💡 tip. There is a Stepper, and Back goes to the previous step (step 0 → `terms_privacy`, replace). The button reads **"Continue"** on steps 1-4 and **"Get started"** on the last. Get started → `home_hub` (replace, `flow.ts:145`), which resolves as J-ENTRY-1.

   The last step's body teaches the new IA: *"Everyone lands on My Work — what's waiting for you, and what you're waiting on. The Map shows every passage and how far it's come."* Tip: *"Replay the Organization Walkthrough anytime from Settings."*

**Ours today:**
- `TermsPrivacy` (`apps/mobile/src/screens/entry.tsx:95-121`): two cards with our own privacy copy, a `Switch` labelled "I accept", and "Continue", which records `v1.TermsAccepted` and then goes to `vision`. Back is `ctx.back`.
- `Vision` (`:123-163`): 5 **icon** steps (Headphones "Listen to the passage.", Mic "Speak it in your language.", Users, Eye, Send). The footer reads "Next" / "Get started", with a secondary "Back". Get started records `v1.VisionSeen` via `markVisionSeen`, then `ctx.home`.
- `App.tsx:244-257` loads `seenVision` and the terms version.

**Gaps:**
- The vision **content** differs. The reference's five ideas are: the passage record, method-as-advice, ask someone, and My Work / Map. Ours are an oral workflow tour. The reference copy is the new IA explained. Ours is still accurate for avatar U but does not introduce My Work or Map.
- The terms screen has no "Terms of Use" / "Privacy Policy" headings and no intro line. It uses a Switch instead of a checkbox row. Functionally equivalent.
- Button copy differs: our "Next" versus the reference's "Continue".
- Back from terms: the reference edge resets to `sign_in`. Our screen calls `ctx.back`. That is fine on a signed-in session, but a signed-in session on `sign_in` is bounced by the auth invariant (`App.tsx:310-311`). **So Back from terms loops.** Recommendation: hide Back on `terms_privacy`, or make it offer sign-out.

**Changes:**
- `entry.tsx` Vision:
  - Replace the `VISION` array (`:123-129`) with five steps that follow the reference titles.
  - Keep **Lucide icons, not emoji**, to fit our visual rules. Suggested icons, in order: Globe, BookOpen, Compass, Users/Handshake, ListChecks (the My Work icon).
  - Show the title as the step's one text line. The body is optional and muted. Drop the 💡 tip box, or show it as one muted line.
  - Rename the footer "Next" to "Continue".
- `entry.tsx` TermsPrivacy: keep our legal copy. It is real and the reference's is placeholder. Add the two card headings, the intro line, and a checkbox-row style for "I accept the Terms of Use and Privacy Policy". The `Switch` is acceptable if we keep it.
- Keep the app-only edge `create_account→terms_privacy` in the drift log. The reference still sends `create_account` straight to `home_hub` (`flow.ts:137`) and never shows terms to a new account.

**Data or events:** none new. `v1.TermsAccepted` and `v1.VisionSeen` already exist (`apps/mobile/src/screenContracts.ts:17-18`).

### [ ] J-ENTRY-3: A new user creates an account, optionally joining through an org request or a scanned invite

**Personas:** new field worker, or a new partner staff member.

**Reference:**
1. `sign_in` → **"Create Account"** → `create_account` (`flow.ts:134`, gate guest).
2. `create_account` (`src/screens/onboarding.tsx:176-328`):
   - Title **"Create Account"**.
   - Intro: *"Create an email account, then join an organization — pick one below to request access, or scan an invite QR for immediate access."*
   - **Email**, **Password**, **Confirm password** (shows "Passwords do not match.").
   - Either:
     - an **"Invite scanned"** card with Organization, Role and Scope, *"Creating the account gives you this access immediately."*, and **"Remove invite"**; or
     - an **Organization** select (**"None — join later"** or an org), with *"Choosing an org sends a join request to its admins. They assign a role before you get access."*
   - A card **"Scan org invite"** / **"Scan a different invite"** with sub *"QR includes org, role, and scope — you join immediately"* → `scan_qr` (`flow.ts:136`). The typed draft is kept (`App.tsx:1265`).
   - Footer **"Create Account"**, disabled until the email and matching passwords are valid.
     - With an org picked: an in-place "Account created" confirmation, *"Your request to join {org} is with an admin. Until they assign a role, this account is anonymous."*, then after 1.8s → `home_hub` → `intent_chooser` with the pending banner (J-ONB-3).
     - With an invite: → `home_hub` → the role's home (`App.tsx:1137-1156`).
     - With neither: → `intent_chooser`.
3. `scan_qr` (`src/screens/entry.tsx:248-330`):
   - Dark camera. Title **"Scan QR code"**.
   - Subtitle *"Invite includes organization, role, and scope"*, or *"No email needed — this creates your account"* when the scanner has no account.
   - A hint that changes from *"Point the camera at the invite code"* to *"QR in frame — tap Capture"*.
   - Primary **"Capture"**, and a footer line "{role} · {org}".
   - Capture from signup → back to `create_account` (popTo) with the invite attached. From elsewhere → `home_hub` (`flow.ts:139-140`).
   - **QR-only accounts** (identity `qr:<memberId>`, `session.ts:75-86`) have no email. Settings then shows "No email linked" and "Link email".

**Ours today:**
- `CreateAccount` (`apps/mobile/src/screens/entry.tsx:74-93`): email, password (length ≥ 6), a Footer "Create account" that calls `supabase.auth.signUp`, and a Section "Have an invite?" with the row "Scan org invite" → `scan_qr`.
- The auth invariant then routes to `terms_privacy` (`App.tsx:310-311`).
- `ScanQr` (`:327-395`): header "Join with an invite", a real camera toggle row "Scan QR code" / "Stop camera", a note "Scan a QR code or paste the invite code or link.", a paste field and a Footer "Join".
  - As a guest it stores the invite and goes to `sign_in` (`:345-349`, app-only edge `scan_qr→sign_in`).
  - Signed in, it calls `redeemInvite` and then `openOrganization`.
- Deep links store `pending-invite` and reopen `scan_qr` after sign-in (`App.tsx:352-371`).

**Gaps:**
- No confirm-password field.
- No org picker to request access at signup.
- No "Invite scanned" preview card with Organization / Role / Scope and "Remove invite". Ours sends the guest back to sign-in instead of attaching the invite to the draft.
- The guest round trip `create_account → scan_qr → create_account` (popTo, `flow.ts:139`) exists in our `EDGES` (`apps/mobile/src/flow.ts:112`) but `ScanQr` never takes it.
- No "Account created" confirmation state.
- The intro copy is missing.
- Title copy differs ("Join with an invite" versus "Scan QR code"), and so does the primary button ("Join" versus "Capture"). Our real camera auto-captures, so the reference's "Capture" maps to our Join.
- QR-only (email-less) accounts do not exist.

**Changes:**
- `entry.tsx` CreateAccount:
  - Add Confirm password with a mismatch line.
  - Add an optional "Organization" chooser with "None — join later". It needs an org list pre-auth (see data). Alternatively keep our "organization code" text field from RequestAccess.
  - When an invite is attached (`ctx.params.invite` or the stored `pending-invite`), show the "Invite scanned" card and a "Remove invite" link.
  - After signUp: when an org was chosen, queue a `join_request` account action (as RequestAccess does, `:293`).
  - Rename the section row to "Scan org invite" / "Scan a different invite", with the reference sub-line.
- `entry.tsx` ScanQr:
  - When `ctx.session.isGuest` and the previous screen was `create_account`, `rememberInvite(code)` then `ctx.go('create_account')` (popTo edge, already declared) instead of `ctx.go('sign_in')`.
  - Keep `scan_qr→sign_in` (app-only) for the deep-link-then-sign-in case.
  - Title "Scan QR code". Subtitle per the reference, depending on `isGuest`.
- **Decision needed:** QR-only, email-less accounts. Supabase anonymous sign-in plus linking an email later would be new auth plumbing. Recommend **deferring**, and recording it in the drift log. Our invite flow already avoids the need for an email for the *invite*, but not for the account.

**Data or events:**
- (a) Invite **preview** before redemption (org name, role name, scope) needs a read-only RPC such as `peek_invite(token)`. `redeem_invite_v2` exists (`screenContracts.ts:22`). A peek does not. **Flag.**
- (b) An org picker before sign-in needs a public org list RPC, or keep code entry. **Flag.** This is a privacy question: listing orgs to anyone conflicts with the "joining uses invitations" retirement of explore (`specParity.test.ts:94`).
- (c) Email-less QR accounts need anonymous auth. **Flag and defer.**

### [ ] J-ENTRY-4: A guest browses public projects (Explore)

**Personas:** a signed-out visitor, or a no-org user.

**Reference:**
- `sign_in` → **"Browse public projects"** → `explore_home` (`flow.ts:135`, guest).
- `intent_chooser` → **"Explore projects"** (`flow.ts:168`).
- `explore_home` (`src/screens/entry.tsx:217-244`):
  - Header **"Explore Projects"** and a **"Sign In"** header button (guests only).
  - Section **"Public projects"**: cards with name, description, a progress bar, "{n} languages" and "{p}%".
  - Sign In → `sign_in` (reset, `flow.ts:147`).

**Ours today:** retired on purpose. `explore_home` is not in `SCREEN_IDS`. `specParity.test.ts:88,94` filters it out: *"Public discovery is intentionally retired; joining uses invitations."* `docs/ux/follow-ups.md:69,143` says "Hide for now".

**Gap:** the whole journey.

**Decision needed (surface to the user, do not average):**
- Option A: keep it retired. It is a deliberate product decision in our drift log, and the reference did not change Explore on the branch.
- Option B: port it. That needs a public read of org and project progress (RLS and an RPC), which conflicts with the privacy tension in reference design-principles "Visibility".

**Recommend A.** Keep the retirement and list both edges in `SPEC_RETIRED` explicitly rather than a filter. Also drop the "Explore projects" row from `intent_chooser` in our port.

**Data or events:** if ported, a public projects RPC. **Flag.**

### [ ] J-ONB-1: A no-org user sees "What brings you here?" and picks a path

**Persona:** a signed-in person with no membership (Sam Taylor, `no-org`).

**Reference:**
- `home_hub` → `intent_chooser` (`src/screens/onboarding.tsx:8-59`).
- Header **"What brings you here?"** with Back (→ `sign_in`, reset, `flow.ts:169`).
- Four equal option cards, each with an icon tile, label, sub and chevron:
  1. building **"Create an organization"**, *"Start a new translation org"* → `create_org`
  2. people **"Join an existing org"**, *"Accept an invitation or request access"* → `request_access`
  3. qr **"Join with QR code"**, *"Scan an invite — keeps your email and name"* → `scan_qr`
  4. globe **"Explore projects"**, *"Browse public translation projects"* → `explore_home`
- **No tab bar** while on the no-org home (`App.tsx:293`: `showNav` needs `sessionHome !== "intent_chooser"`).

**Ours today:**
- `IntentChooser` (`apps/mobile/src/screens/entry.tsx:165-192`): one big `IconCircleButton` QR (180px, "Join with QR code") → `scan_qr`.
- The footer button "More options" / "Hide options" reveals the Section "Advanced": "Create an organization" (sub "You become its admin") and "Join an existing org" (sub "Ask an admin for access").
- Tabs show: `TAB_SCREENS` includes `intent_chooser` (`flow.ts:276-279`), and `tabsFor` returns intent_chooser, [inbox] and settings (`session.ts:136-143`).
- There is no header or title.

**Gaps:**
- The reference gives four equal choices. Ours makes QR the one yellow action and hides the rest. This is a deliberate avatar U simplification (comment at `entry.tsx:166-168`).
- No title.
- No Explore row (see J-ENTRY-4).
- Sub copy differs.
- The tab bar is shown; the reference hides it.

**Changes and recommendation:**
- Keep our one-yellow QR circle as the primary action; that reconciles the conflict.
- Show the reference's other options **without** a "More options" toggle, because ADR-014 in the reference forbids hiding choices behind "More options". Render them as three neutral `Row`s under the QR circle (Create an organization, Join an existing org, and optionally Explore), using the reference labels and sub-lines verbatim.
- Add the Header title "What brings you here?". Our `TITLES` says "What do you want to do?" (`flow.ts:289`); change it.
- Tab bar: follow the reference and hide it. But **keep a sign-out path**. The reference's Back → `sign_in` does not end our Supabase session, and the auth invariant would bounce it. Add a Header right action or a muted Row "Sign out" → `sign_out_confirm`. That is a new app-only edge `intent_chooser→sign_out_confirm`; log it in `APP_ONLY` with the reason "real auth needs sign-out without tabs". Alternatively keep Settings reachable. Remove `intent_chooser` from `TAB_SCREENS`.
- Remove `intent_chooser → sign_in` (reset) if Back is not offered, or keep it and route it through sign-out.

**Data or events:** none.

### [ ] J-ONB-2: A no-org user creates an organization, sees the walkthrough, then lands on My Work as an admin

**Persona:** a new coordinator.

**Reference:**
1. `intent_chooser` → `create_org` (`src/screens/onboarding.tsx:332-364`):
   - Title **"Create Organization"**.
   - A tinted note: *"Creating an org presets standard roles, a Bible content template, and an A→B→C→D review flow. You become the organization admin."*
   - Fields **Organization Name**, **Region / Location** and **Description** (the last two are placeholders that are not saved).
   - Footer **"Create Organization"**.
2. → `walkthrough` (replace, `flow.ts:170`). App sets `adminOverride("org")`, so the session is org admin (`App.tsx:1306-1314`).
3. `walkthrough` (`onboarding.tsx:63-106`) has 6 steps from `WALKTHROUGH_STEPS` (`src/data.ts:1141-1148`):
   1. "Welcome to LangQuest"
   2. "How Organizations Work"
   3. "Permissions Say Who May Act"
   4. "Content and Context"
   5. "Review Flows Are Advice"
   6. "Ask Someone"

   Header label **"ORGANIZATION WALKTHROUGH"**, a Stepper, and a **"Skip"** text button at the top right. Some steps have a **"Try: …"** button that does nothing. The primary reads **"Continue"**, then **"Done — Let's Go!"**. Done or Skip → `home_hub` (replace, `flow.ts:174`) → **`my_work`**, with a Manage tab → `org_home`.

**Ours today:**
- `CreateOrg` (`apps/mobile/src/screens/entry.tsx:218-277`): title "Create a new organization", a Note, and the field "Organization name".
- It writes the org partition and the project partition, then `openOrganization(orgId, projectId, 'walkthrough')`. That remounts the Workspace, lands on the home (**org_home**), then pushes `walkthrough` via the landing effect (`App.tsx:316-323`, app-only edge `org_home→walkthrough`, `flow.ts:133`).
- `Walkthrough` (`:397-429`): 7 one-line text steps in a Card. Footer "Next" / "Done" with secondary "Skip". Done records `v1.WalkthroughDone` and then `ctx.home`.

**Gaps:**
- After the walkthrough the reference lands on **My Work**. Ours lands on org_home.
- The walkthrough copy is stale. Our "Assign passages, then watch Status." contradicts the reference's "Asking creates a request that shows on their My Work" and ADR-007.
- 7 steps versus 6.
- No Region or Description fields. Correctly omitted: the reference doesn't save them either.
- Title copy differs: "Create a new organization" versus "Create Organization".
- The note copy differs. **Ours is accurate** about what our seed creates: "a one-step community review flow". Keep ours.

**Changes:**
- After the `homeScreenFor` change, the landing target is `my_work`. Replace the app-only edge `org_home→walkthrough` with `my_work→walkthrough` (app-only, same reason), or change the landing effect (`App.tsx:317-323`) to `nav.reset` to `[my_work, walkthrough]`. **Recommendation: the edge swap.** It is the smaller change.
- Walkthrough:
  - Replace `WALK` (`entry.tsx:397-405`) with the reference's six titles.
  - Keep one short line each, with an icon per step. The screen is P-ish, but ours is marked U in `AVATAR` (`flow.ts:47`).
  - Rename "Next" → "Continue" and "Done" → "Done — Let's Go!", or keep "Done". **Skip the "Try:" buttons**: they are non-functional in the reference.
  - Put Skip in the header's right side as in the reference, so the footer keeps one action.
- `TITLES.create_org` → "Create Organization".

**Data or events:** none new. The events are listed in `screenContracts.ts:20-21`.

### [ ] J-ONB-3: A no-org user requests access and waits

**Persona:** a new member who knows which org to join.

**Reference:**
1. `intent_chooser` → **"Join an existing org"** → `request_access` (`src/screens/onboarding.tsx:110-172`):
   - Title **"Request access"**, intro *"Ask to join an existing organization. An admin will review your request."*
   - The **Organization** list: select a card showing name and "{region} · {n} projects".
   - **Message**, placeholder "Why you want to join".
   - Footer **"Send request"**.
2. It sends, then shows an in-place **"Request sent"** confirmation: *"Your request to join {org} is on its way. An admin will review it."* After 1.8s → `intent_chooser` (replace, `flow.ts:172`).
3. The app creates a pending member and calls `notifyJoinRequest` (`App.tsx:1040-1051`, `1315-1324`), which gives admins an inbox item titled "Join request".
4. `intent_chooser` now has the header **"Request sent"** and a highlighted card: clock icon, **"Waiting for {org}"**, *"An admin will give you a role. Once they do, sign in again and you'll land on your work."*, *"There's nothing else you need to do."* Then the label **"Meanwhile"** and the four options (`onboarding.tsx:21-40`).

**Ours today:**
- `RequestAccess` (`apps/mobile/src/screens/entry.tsx:279-321`): the Note "Ask an organization to let you in. Until someone accepts, you see nothing of theirs.", fields "organization code" and "message (optional)", and a Footer "Send request".
- After sending, a Note shows the status ("Request sent. An admin can now review it." / failed / "Request saved on this device. It sends when you have a connection.") with a Footer **"Back"** → `intent_chooser`.
- `intent_chooser` shows **no** pending state.

**Gaps:**
- No org list: ours uses a code. See data flag (b) in J-ENTRY-3.
- No persistent "Waiting for {org}" state on `intent_chooser`.
- No automatic return. Ours needs a "Back" tap. That is fine, and arguably better offline, because our request may still be queued.

**Changes:**
- `IntentChooser`: read the pending `join_request` from `useAccountActions(actorId)` (already used by RequestAccess, `entry.tsx:283`). If present, show the reference's pending card with the clock icon and "Waiting for {org}". Map the org name from the code, or show the code. Use our queued / sent / failed status for the sub-line: offline, "It sends when you have a connection". Title "Request sent". Then "Meanwhile" and the options.
- `RequestAccess`: keep the code entry. Adopt the reference intro and sent copy. Keep the Footer "Back". The reference returns automatically; we keep a tap because the offline state matters. Log it as a deliberate difference.

**Data or events:**
- The org **name** for the pending card: a local account action only has `orgId`, so the name needs a lookup RPC, or show the code. **Flag, minor.**
- Server-side pending state across devices (`join_requests` table, read by `members_list` per `screenContracts.ts:25`) would need a `my_join_requests` RPC. **Flag.**

### [ ] J-ONB-4: An admin accepts a join request from the Inbox

**Persona:** an admin with `Invite Members`, which is our `invite_members`.

**Reference:**
1. `inbox_home`. The "Join request" row (people icon, body *"{name} asked to join {org}. Assign a role to give them access."*) opens an in-place detail with **"Assign role & accept"** (primary) and **"Decline"** (ghost) (`src/screens/account.tsx:19-44`).
2. Accept → `edit_member` (`flow.ts:279`, gate `assigner`), with the member preloaded and the notification marked read (`App.tsx:1600-1607`).
3. `edit_member` **"Assign Role"** → back to `inbox_home` (`flow.ts:280`, mode back).
4. Decline removes the notification.

**Ours today:** tapping a `join_request` remote row calls `ctx.go('members_list')` (`apps/mobile/src/screens/account.tsx:46`, app-only edge `inbox_home→members_list`). There the admin finds and decides the request (`decide_join_request`). An `inbox_home→edit_member` edge exists (`flow.ts:237`) but is unused.

**Gaps:** there is no in-place detail, no direct "Assign role & accept" / "Decline", and no return to the inbox.

**Changes:**
- `InboxHome`: for a `join_request` row, open an in-place detail (state, as in the reference) with the primary (yellow) "Assign role & accept" → `ctx.go('edit_member', { joinRequestId, profileId })`, and the outline "Decline" → `decide_join_request(decline)`.
- `EditMember` (`org.tsx`, another domain): accept a `joinRequestId` param. On save, call `decide_join_request(accept)` plus `v1.OrgMemberAdded`, then `ctx.back()` to the inbox.
- Drop the app-only `inbox_home→members_list` once this lands, or keep it as a fallback with its reason.

**Data or events:** the remote notification must carry the join-request id and the requester's profile id. Today `RemoteNotification` has only `id, seq, org_id, project_id, kind, title, task_id` (`apps/mobile/src/notifications.ts:26-30`). **Flag:** add a `ref_id` or payload column to the `notifications` rows, or look it up by the requester.

### [ ] J-HOME-1: A worker opens My Work and acts on "For you"

**Personas:** translator, reviewer, and admins, who also land here.

**Reference:**
- `my_work` (`src/screens/work.tsx:26-114`; App wiring `src/App.tsx:1352-1366`).
- Header **"My Work"**, sub "{name} · {org}".
- Section **"For you"** with a count: highlights from `highlightsFor` (`src/domain/record.ts:182+`):
  - feedback on your latest version ("Feedback on {passage}", "{kind} · from {who}")
  - requests to you (record, review, back-translate)
  - your unsaved drafts

  It caps at 5, then **"Show all N"** / **"Show fewer"**. Empty state: **"Nothing is waiting on you"**, then either *"Set up people, projects and review flows under Manage, or find any passage on the Map."* (admins) or *"Find any passage on the Map to keep going."*
- Section **"Recent"**: passages this person opened (`recentByPerson`), minus those already listed.
- Section **"Waiting on others"** with a count: open requests you sent, most overdue first (`waitingOn`, `record.ts:233-245`), capped at 3.
- A language label appears only when the lists span several languages.
- Edges (`flow.ts:158-162`):
  - `my_work→workspace` ("Record / Continue", translator)
  - `my_work→review_capture` (reviewer)
  - `my_work→back_translation` (reviewer)
  - `my_work→passage_record` ("Respond / waiting / recent passage")

**Ours today:**
- `AssignmentsHome` (`apps/mobile/src/screens/work.tsx:47-230`) has, from the top:
  - A sync chip → `sync_status`, plus Inbox and Menu icons at the top right.
  - A project card with a role badge, a progress bar and an arrow → `status_home`.
  - A "Bible" row for dynamic lanes.
  - Todo / doing / done filter chips with counts.
  - A FlatList of `TodoRow`s → `translate_passage`, `review_passage` or `obt_passage`. A long press → `assignment_progress_detail`.
  - A "Browse open work" footer → `pickup_home`.
  - A **yellow** `ActionButton` for the next undone task.

**Gaps:**
- Different structure: status filters instead of For you / Recent / Waiting on others.
- No Recent.
- No Waiting on others: an asker cannot see their outstanding requests.
- The admin empty state is missing, because admins never land here today.
- Pickup ("Browse open work") and "Bible" have no reference counterpart. In the reference, finding work is the Map's job.

**Changes:**
- Rename the screen id `assignments_home` → `my_work`, or keep the internal id and change the title. **Recommend the rename**, so spec parity is edge-for-edge. Update `SCREEN_IDS`, `AVATAR`, `TITLES`, `TAB_SCREENS`, `SCREENS` in `App.tsx:61`, `screenContracts.ts:48` and every `ctx.go('assignments_home')`.
- Rebuild `Work.AssignmentsHome` as `MyWork` with three sections. Keep our visual rules:
  - The first For-you item's action is the **one yellow action**. Keep the existing `next` footer pattern, bound to `forYou[0]`.
  - Rows are icon-first: the task-type icon plus the passage reference, with a tint per task colour.
  - "Show all N" is a neutral text button.
  - Section headings may be icons with text as an accessibility label for avatar U. For example, For you = the user icon, Recent = History, Waiting on others = Clock. The reference uses the clock icon for waiting rows too (`work.tsx:95`).
- Keep the sync chip. It is ours and it matters offline. Log it as app-only; it already is (`assignments_home->sync_status`). Rename it to `my_work->sync_status`.
- Remove the Inbox and Menu icons from the header. The tab bar now always has Inbox and Settings.
- Remove the project card's arrow → `status_home`. The Map tab does that job. The progress bar can stay, or move to Map.
- `pickup_home` and `dynamic_bible` entry points: the reference has neither; the Map does this job. **Decide with the map/record analysis.** Interim: keep them as app-only rows below the three sections, logged in `APP_ONLY`.
- New edges, replacing the `assignments_home→*` edges: `my_work→translate_passage` (translator), `my_work→review_passage` (reviewer), `my_work→piece_status`, or `passage_record` once renamed. Plus the `back` edges from those to `my_work`.

**Data or events:**
- **For you:** requests to me are derivable from `AssignmentMade` via `deriveTasks`. Feedback on my latest take is derivable from `ReviewSubmitted` (`suggest_changes`) with no later take of mine (`parentTakeId`). My unsaved drafts are derivable from `TakeComposed` without `TakeSubmitted`. **No new events.** It needs a new read-model query (`highlightsFor`) in `packages/core` or `client`.
- **Waiting on others:** needs `AssignmentMade` by `actorId = me`, not done. The asker is the envelope `actorId`, and `dueDate` is on `AssignmentMade` (PLAN §13). A new query, **no new events**.
- **Recent:** a per-person list of opened passages. It is device-local UI state (AsyncStorage). **Not an event**, and it must not be stored as status. **Flag** only to confirm it is acceptable for it not to sync across devices.
- The badge count for the My Work tab is `forYou.length`.

### [ ] J-HOME-2: An admin lands on My Work and reaches their org, project or language home through the Manage tab

**Persona:** org, project or language admin.

**Reference:** home is `my_work`. The tab bar gets **Manage** (icon "home"), which calls `nav(manageHomeFor(...))`: `org_home`, `project_home` or `language_home` (`src/App.tsx:271-288`; `session.ts:127-134`). The Manage tab stays active on any manage home (`activeNav` fallback "manage", `App.tsx:294-295`).

**Ours today:** admins land on the manage home itself (`session.ts:108-110`). The home tab icon is `Home` (`App.tsx:432`).

**Gap:** there is no Manage tab, and admins don't see My Work.

**Changes:**
- Add `manageHomeFor` (J-ENTRY-1).
- `tabsFor` (`session.ts:136-143`): rewrite, see §3.
- `TAB_SCREENS` must still include `org_home`, `project_home` and `language_home`.
- `org_home→walkthrough` → `my_work→walkthrough` (J-ONB-2).
- specParity's `homes` assertion: update it (see §0.3).

**Data or events:** none.

### [ ] J-HOME-3: A viewer lands on the progress overview

**Persona:** org, project or language viewer (Grace, the funding partner).

**Reference:** `home_hub→status_home` ("All Languages", `flow.ts:155`). Tabs: **Map** (active, `status_home`), Inbox, Settings. There is no My Work (`App.tsx:283`: only when `sessionHome === "my_work"`) and no Manage. `status_home → map_home` ("tap language").

**Ours today:** home is `status_home` ("Status"). Tabs: `status_home`, [inbox], settings.

**Gaps:**
- Title: "Status" versus "All Languages". The reference flow group title is "All Languages".
- The tab icon: ours `ListChecks` means "Status". The reference's is "map". Our `ListChecks` is also the review icon (PLAN §12), which is a clash.
- The downstream screen ids differ (`language_status` versus `map_home`). That belongs to another domain.

**Changes:**
- `TITLES.status_home` → "All languages".
- Tab icon `Map` (Lucide `Map`) for the Map tab.
- Tab identity is "map", with `mapScreenFor`.

**Data or events:** none.

### [ ] J-INBOX-1: A person opens the Inbox and taps an update about a passage

**Personas:** everyone signed in with an org.

**Reference:**
- Inbox is **always a tab**, with an unread badge (`App.tsx:286`).
- `inbox_home` (`src/screens/account.tsx:9-84`): Header **"Inbox"**; **"Unread (n)"**; **"Earlier"**, shown only when there are read items.
- Each row has an icon tile chosen by type (`NOTIF_ICON`: invite and join_request → people, request → assign, review → chat, done → check), a title, a body, a timestamp and an unread dot.
- A tap on a row with `passageId` marks it read and opens `passage_record` directly (`flow.ts:303`; `App.tsx:1609-1612`). Other rows open the in-place detail with **"Back to inbox"**.
- Empty state: *"Nothing yet. Requests and feedback about your passages show up here."*
- Notifications are pushed by `notify()` (`App.tsx:411-416`): addressed `to` named people, **never the actor**, filtered per persona (`App.tsx:273-275`). `markHandled(passageId, types)` (`:418-421`) marks a passage's request and review notifications read once the work is done.
- Notification titles (verbatim patterns, `App.tsx:525-701`):
  - "{first} recorded {passage}" (done, to the asker)
  - "{first} revised {passage}" (review, to the reviewer)
  - "{first} asked you to record / do a {kind}" (request)
  - "{kind}: looks good" / "Feedback on {passage}" (review)
  - "Back translation of {passage} is ready"
  - "{assignee} replied by link"
  - "{first} kept {passage} as is" with "Reason: …"

**Ours today:**
- `InboxHome` (`apps/mobile/src/screens/account.tsx:23-73`), with three sections:
  - "Saved account changes" (the local outbox)
  - "Your work" (`deriveInbox`: open tasks and decisions on my takes, with a badge = kind)
  - "Organization updates" (remote rows: join requests and other projects, with a "new" badge from AsyncStorage `inbox-read`)
- Tapping goes to `translate_passage` or `review_passage` by task id, `members_list`, `status_home` or `openOrganization`.
- The Inbox tab appears **only when** `deriveInboxCount > 0`, which counts reviews on my takes only (`session.ts:11-22`; `App.tsx:264-267,409`).
- Push responses open `inbox_home` (`App.tsx:375-386`).

**Gaps:**
- There is no Unread / Earlier split for derived items. "Your work" has no read state.
- The tab is hidden when the count is 0, and the count ignores open tasks.
- No per-type icons: the badge is a text kind.
- No empty-state copy: "Nothing waiting" versus the reference sentence.
- Inbox rows open the **task screen**. The reference opens the **passage record**. That follows from the record-centred IA.
- Missing notification kinds:
  - "recorded what you asked" (to the asker)
  - "revised after your feedback" (to the reviewer)
  - "kept as is, reason" (to the reviewer)
  - "back translation ready" (to the consultant)
  - "replied by link"
- There is no "never to the actor" rule to check. Derived items are about the actor, so that rule holds by construction.

**Changes:**
- Inbox tab always present (see §3). Badge = unread count.
- `InboxHome`:
  - Group into **Unread (n)** / **Earlier** across local and remote items.
  - Keep read ids per device in the existing `inbox-read:${me}` key (`account.tsx:33`), extended to derived item ids.
  - Keep "Saved account changes" as a top section. It is ours; offline honesty.
- Row = icon tile + title + time. Icon map, ours in Lucide:
  - request / assignment → `Mic` or `ListChecks` (the task type)
  - suggestions / feedback → `MessageSquare`
  - decision approved → `CheckCircle2`
  - join_request → `Users`
  - blocker → `AlertCircle`

  Kind carries meaning through icon plus colour, never colour alone.
- Tap target: `passage_record` once that screen exists (map/record domain). Until then keep `translate_passage` / `review_passage` and keep the app-only reasons.
- Empty state: the reference sentence, with a `CheckCircle2` icon.
- `deriveInboxCount` (`session.ts:11-22`): replace it with the unread count of `deriveInbox`, plus remote unread.

**Data or events:**
- "{first} recorded {passage}" to the asker: derivable (`AssignmentMade` by X, then `TakeSubmitted` on that unit by the assignee). Extend `deriveInbox` for askers. **No new events.**
- "revised after your feedback" to the reviewer: derivable (my `ReviewSubmitted` `suggest_changes`, then a later take with `parentTakeId`, or `ResponseRecorded`). **No new events.**
- "kept as is, with reason": needs a "keep after feedback" departure. That is a record-domain event (reference `keepAfterFeedback`, `App.tsx:701`). **Flag to the record analysis.** Do not design it here.
- "back translation ready", "replied by link": depend on back-translation and guest-review data in other domains. **Flag.**
- `markHandled`: in our derived model a task item disappears when the task is done, so it is automatic. Remote rows need `active=false` from the server when handled; that already exists (`notifications.ts:43`). The server's notification worker must use the same eligibility (`deriveInbox` comment in `packages/core/src/inbox.ts:14`).
- Read state is per device. The reference is per session. **Flag:** whether read state must sync across devices would need account-level storage (an RPC), not project events.

### [ ] J-ACCT-1: A person views Settings

**Personas:** all signed-in users.

**Reference:** `settings_home` (`src/screens/account.tsx:88-130`):
- A profile card: avatar initials, name, email in muted text or **"No email linked"** in amber, and "{role} · {org}" in the primary colour.
- **Account** section:
  - **"Edit Profile"** (user icon) → `profile_edit`
  - **"Link email"**, sub *"Sign in later on another device"*, only for email-less accounts
  - **"Switch Organization"**, sub "{org} (active)" → `org_switcher`
- **App** section:
  - **"Replay Organization Walkthrough"** (book icon) → `walkthrough`
  - **"Notification Settings"**, which goes nowhere
- A full-width destructive **"Sign Out"** button (red tint) → `sign_out_confirm`.

**Ours today:** `SettingsHome` (`apps/mobile/src/screens/account.tsx:75-107`):
- A card with the name and "{role} · {org}".
- Account: "Edit profile", "Switch organization" (sub = the org name).
- App: "Enable notifications" (a working push-permission request), "Sync" → `sync_status`, "Replay organization walkthrough", "Sign out".
- `AccountPrivacySettings`: Appearance, App language, Privacy and security (change password, disguise icon, entry PIN, lock now, delete account).
- Testing: "Switch persona".

**Gaps:**
- No avatar initials.
- No email shown.
- Sign out is a row, not a separate button at the bottom.
- The sub "{org} (active)" is missing.
- Capitalisation differs: "Edit profile" versus "Edit Profile". Keep our sentence case, which is our convention (Rule 11).
- Ours has more: sync, appearance, language, privacy, PIN, delete. Keep them all as app-only rows. Sync has an edge; the others are in-place.

**Changes:**
- Add an `Avatar`-style initials circle to the card, and the email line.
- Change the switch-org sub to "{org} · active". A badge is fine too.
- Move "Sign out" out of the App section into its own outline or destructive-styled button at the bottom, after the privacy sections (see §4 on colour).
- Rename "Enable notifications" to "Notification settings", or keep it. Ours works; the reference's is inert. **Keep ours.**

**Data or events:** none.

### [ ] J-ACCT-2: A person edits their profile

**Reference:**
- `profile_edit` (`src/screens/account.tsx:132-183`): title **"Edit Profile"**, avatar, and **"Change photo"** (non-functional).
- A note for QR accounts: *"You joined with a QR code and don't have an email yet. Add one to sign in on another device."*
- Fields **Full Name** and **Email**, plus **Bio** and **Location** (placeholders, not saved).
- Footer **"Save Profile"** saves the name and email, then returns (back, per `account-settings.flow.md` `profile_save`; `App.tsx:1616-1628`).

**Ours today:** `ProfileEdit` (`apps/mobile/src/screens/account.tsx:109-135`): title "Profile", one "Display name" input, and a Footer "Save profile". It queues a `profile` account action, shows "Saved on this device. Your profile syncs when connected." and **stays on the screen**.

**Gaps:**
- Title "Profile" versus "Edit Profile".
- There is no Email field.
- There is no avatar.
- The screen doesn't go back after saving.
- Bio, Location and photo are missing. They are non-functional in the reference, so **skip them**.

**Changes:**
- `TITLES.profile_edit` → "Edit profile".
- Add the avatar initials.
- After a successful queue, `ctx.back()` with a toast "Saved on this device…" (needs the toast, §3). Otherwise keep the in-place note.
- Email change: only if we support `supabase.auth.updateUser({ email })` with verification. **Flag.**

**Data or events:** an email change is an auth call, not an event. Bio, location and photo would be new profile fields. **Flag, recommend no.**

### [ ] J-ACCT-3: A person switches organization

**Reference:** `org_switcher` (`src/screens/account.tsx:185-214`): title **"Switch Organization"**. Cards show the building icon, the org name and "{role} · {region}", with a check on the active one. A tap selects in place; the demo stays on the screen.

**Ours today:** `OrgSwitcher` (`apps/mobile/src/screens/account.tsx:137-165`): title "Organizations", a Section "Your organizations" with rows (name, sub = project id, badge "active"). A tap calls `openOrganization`, which remounts to that org's home.

**Gaps:**
- The role is not shown per org.
- The sub shows a raw project id.
- Title copy differs.

**Changes:**
- `TITLES.org_switcher` → "Switch organization".
- Row icon `Building2`. Sub "{role}" (or "{role} · {project name}").
- Active mark: a `Check` icon, not text.

**Data or events:** the role name per org. `my_organizations` returns only `org_id`, `project_id` and `name` (`account.tsx:138`). **Flag:** extend the RPC with the role name and project name.

### [ ] J-ACCT-4: A person signs out

**Reference:** `sign_out_confirm` (`src/screens/account.tsx:216-233`): a red user icon tile, **"Sign out?"**, *"You can sign back in anytime."*, a red **"Sign Out"** button → `sign_in` (reset), and **"Cancel"** → back. The work in flight survives sign-out (`App.tsx:1632-1634`).

**Ours today:** `SignOutConfirm` (`apps/mobile/src/screens/account.tsx:179-214`) shows an icon state (CloudUpload with the pending count, CloudOff, or LogOut) and an explanatory line. The `LogOut` icon button is **disabled while events are queued** (invariant 1). "Cancel" is an outline button.

**Gaps:** there is no "Sign out?" heading, and the guard copy is longer. **The guard is ours and required. Keep it.**

**Changes:** add the heading "Sign out?". Use the sub *"You can sign back in anytime."* when not blocked (it replaces "Signed-in work is synced…"). Keep the blocked and refused copy.

**Data or events:** none.

### [ ] J-ACCT-5: A person replays the organization walkthrough

**Reference:** `settings_home` → **"Replay Organization Walkthrough"** → `walkthrough` (`flow.ts:306`). Done or Skip → `home_hub` → home.

**Ours:** the same edge (`flow.ts:264`). Done → `ctx.home`.

**Gap:** only the walkthrough content (J-ONB-2). After a replay, the reference returns to **home**, not Settings. Ours does the same.

**Changes:** none beyond J-ONB-2.

### [ ] J-SHELL-1: Every action ends with a toast, and sends can be undone

**Persona:** all.

**Reference:**
- A global `toastState` (`src/App.tsx:143-151`) shows 3.4s, or **7s** when it offers Undo.
- Render (`:1957-1975`): a dark pill, a green check circle, the text, and an optional **"Undo"** button. Tapping it dismisses the toast.
- `undoable()` (`:540-547`) snapshots the passages, requests and notifications. Undo restores them and says **"Undone — nothing was sent"**.
- Used for sends, added records, set-asides, and admin saves, for example "Invite sent to {email}" → Undo "Invite taken back" (`:1194`).
- Principle 10: "a confirmation after every action".

**Ours today:** no toast and no undo anywhere (grep of `apps/mobile/src` and `App.tsx`). Screens show in-place `Note`s.

**Gaps:** the whole mechanism.

**Changes:** add a `ctx.toast(text, undo?)` to `Ctx` (`apps/mobile/src/ctx.ts`), rendered by `Workspace` in `App.tsx` above the tab bar. Style: `colors.foreground` pill, the `CheckCircle2` icon in `colors.done`, text, and an outline "Undo".

**Data or events (flag, needs a decision):**
- An event log cannot un-append.
- Option 1: **hold** the append for about 7s client-side before it enters the outbox. Undo drops it. No new events, but the write is not durable during the window. That conflicts with invariant 1 if the app is killed.
- Option 2: append at once, and Undo appends a compensating event, for example a cancel or withdraw for `AssignmentMade`. That needs new versioned events.
- **Do not design here.** Raise it with the record/assignment analysis.

---

## 2. Screen-id mapping (this domain, plus homes that the tab bar depends on)

| Reference screen id | Our screen id(s) | Action | Notes |
|---|---|---|---|
| `sign_in` | `sign_in` | keep | Copy tweaks. Persona cards → DevMenu only. |
| `create_account` | `create_account` | keep | Add confirm, org request, invite preview. |
| `terms_privacy` | `terms_privacy` | keep | Headings and checkbox copy. |
| `vision` | `vision` | keep | Content → the reference's five ideas, icon-led. |
| `explore_home` | — | **remove (stay retired)**, decision | Put both edges in `SPEC_RETIRED` explicitly. |
| `scan_qr` | `scan_qr` | keep | Guest → popTo `create_account` with the invite. |
| `home_hub` | `home_hub` | keep | Fan-out reduced to intent_chooser, my_work and status_home. |
| `intent_chooser` | `intent_chooser` | keep | Title, pending state, visible options, no tabs. |
| `create_org` | `create_org` | keep | Title. |
| `request_access` | `request_access` | keep | Copy. The pending state moves to `intent_chooser`. |
| `walkthrough` | `walkthrough` | keep | Content → 6 reference steps. Landing edge from `my_work`. |
| `my_work` | `assignments_home` | **rename** | Rebuilt with For you / Recent / Waiting on others. |
| `status_home` ("All Languages") | `status_home` ("Status") | keep, retitle | The viewer home and the admin Map tab. |
| `map_home` | `language_status` | rename (map/record domain) | The worker Map tab target (`mapScreenFor`). |
| `book_map` | `book_status` | rename (map/record domain) | Keeps the tab bar, Map active. |
| `passage_record` | `piece_status` (+ `piece_stage`) | rename or merge (map/record domain) | The inbox tap target. Keeps the tab bar. |
| `org_home` / `project_home` / `language_home` | same | keep | No longer homes. Reached by the **Manage** tab. |
| `inbox_home` | `inbox_home` | keep | Unread / Earlier, icons, always a tab. |
| `settings_home` | `settings_home` | keep | Avatar, email, Sign out placement. |
| `profile_edit` | `profile_edit` | keep | Title, back-on-save. |
| `org_switcher` | `org_switcher` | keep | Title, role per org. |
| `sign_out_confirm` | `sign_out_confirm` | keep | Add "Sign out?". Keep the guard. |
| — | `sync_status` | keep (app-only) | Already in `APP_ONLY`. Rename the `assignments_home->sync_status` key to `my_work->sync_status`. |
| — | `pickup_home` | keep for now (app-only), decide with the map domain | The reference finds work on the Map, not in a pickup list. It is **in the old spec**, so after re-vendoring it becomes app-only. |
| — | `assignment_progress_detail`, `progress_home` | **remove** | Legacy. They are gone from the reference branch's `FLOW_GROUPS` (`src/flow.ts:19-85`). |
| — | `give_assignment` | remove or merge (map/record domain) | The reference replaced it with `ask_someone` from the passage record. |

Edge changes in this domain, in `apps/mobile/src/flow.ts`:

- **Remove:**
  - `home_hub→assignments_home`, `home_hub→org_home`, `home_hub→project_home`, `home_hub→language_home` (`:121-124`)
  - `org_home→walkthrough` (`:133`)
  - `assignments_home→assignment_progress_detail`, `assignment_progress_detail→progress_home`, `progress_home→status_home` (`:163-165`)
  - `inbox_home→members_list` (`:110`), once J-ONB-4 lands
  - `inbox_home→status_home` (`:111`), once blocker items open the passage or language
- **Add:**
  - `home_hub→my_work` (replace, home)
  - `my_work→walkthrough` (app-only: the post-create landing)
  - `my_work→translate_passage` (translator), `my_work→review_passage` (reviewer), `my_work→sync_status` (app-only)
  - `inbox_home→passage_record` once it exists (spec `flow.ts:303`)
  - `intent_chooser→sign_out_confirm` (app-only: real auth)
  - `profile_edit→settings_home` (back, the reference `profile_save`; already present at `:269`)
- **Keep:** `create_account→terms_privacy` (app-only, already logged) and `scan_qr→sign_in` (app-only, already logged).

`TAB_SCREENS` (`flow.ts:276-279`) becomes `['my_work', 'status_home', 'language_status'/'map_home', 'book_status'/'book_map', 'piece_status'/'passage_record', 'org_home', 'project_home', 'language_home', 'inbox_home', 'settings_home']`. Drop `intent_chooser`.

## 3. Tab bar and home routing differences

| | Reference (`src/App.tsx:269-295`, `src/domain/session.ts:118-150`) | Ours (`apps/mobile/App.tsx:408-450`, `apps/mobile/src/session.ts:106-143`) |
|---|---|---|
| Home: worker | `my_work` | `assignments_home` |
| Home: admin (any scope) | `my_work` | `org_home` / `project_home` / `language_home` |
| Home: viewer | `status_home` | `status_home` |
| Home: no org | `intent_chooser` | `intent_chooser` |
| Tab 1 | **My Work** (icon work, badge = For you count). Only if home is `my_work`. | The home screen, `Home` icon, whatever the home is. |
| Tab 2 | **Map**: `mapScreenFor` → `map_home` for non-admin workers (their language), `status_home` for admins and viewers | `status_home` (`ListChecks` icon), unless the home is `status_home` |
| Tab 3 | **Manage** (admins only) → `manageHomeFor` | — |
| Tab 4 | **Inbox**, always, badge = unread | `inbox_home`, **only when** `deriveInboxCount > 0` |
| Tab 5 | **Settings** | `settings_home` |
| Tabs shown on | `my_work`, map screens (`map_home`, `status_home`, `book_map`, `passage_record`), `inbox_home`, `settings_home`, manage homes. **Hidden** for a no-org home. | `TAB_SCREENS`, including `intent_chooser` |
| Active tab | The exact screen match. Map screens → Map. Manage homes → Manage. | Exact screen match only. A deeper screen shows no active tab. |
| Labels | Icon + text label + red badge | **Icon only**, a 3px indicator bar in `colors.translate`, no badge |
| Tab tap | `reset(s)`, outside the flow machine | `nav.reset({ screen: t })`, the same |

Concrete changes:

1. `session.ts`:
   - Change `homeScreenFor` and add `manageHomeFor` and `mapScreenFor` (J-ENTRY-1).
   - Rewrite `tabsFor(s, counts)` to return `{ id: 'work'|'map'|'manage'|'inbox'|'settings', screen, badge? }[]`:
     - `work` if `homeScreenFor(s) === 'my_work'`
     - `map` always (screen `mapScreenFor(s)`) unless `hasNoOrg`
     - `manage` if `manageHomeFor(s)`
     - `inbox` always (unless `hasNoOrg`)
     - `settings` always (unless `hasNoOrg`); see J-ONB-1 for the sign-out path
2. `App.tsx:408-450`:
   - `showTabs = signedIn && homeScreenFor(session) !== 'intent_chooser' && TAB_SCREENS.includes(screen)`.
   - The active tab is computed by id, with Map covering the map screens and Manage covering the manage homes.
   - Icons (Lucide, our set): My Work `ListTodo` or `Inbox`-free `ClipboardList`, Map `Map`, Manage `Building2`, Inbox `Inbox`, Settings `Settings`. **Do not reuse `ListChecks`**, which is the review icon (PLAN §12).
   - Add a badge (see §4).
3. `deriveInboxCount` → unread count. The My Work badge = the For you count (needs the J-HOME-1 query).
4. `flow.test.ts` reachability (`:34-50`) uses `TAB_SCREENS` as universal edges. It still holds after the change.
5. `specParity.test.ts:136-138` homes assertion → `['intent_chooser','my_work','status_home']`. Add an assertion that `manageHomeFor` returns `org_home`, `project_home` and `language_home` for the three admin sessions. Keep the language-admin fixture at `:120-133`, but change `expect(homeScreenFor(langAdmin)).toBe('language_home')` to `'my_work'` and assert `manageHomeFor(langAdmin) === 'language_home'`.
6. `App.tsx:284-297` cached-home logic: no code change, but the cache key content changes. A stale `org_home` corrects itself after the folds load. Verify on device.

## 4. Conflicts with our visual rules, and how to reconcile them

| Reference pattern | Our rule (PLAN §12, `docs/ux/README.md`) | Recommendation |
|---|---|---|
| Tab labels in text ("My Work", "Map", "Manage", "Inbox", "Settings") | Words optional for avatar U. Icons carry meaning. | Icon-only tabs with `accessibilityLabel` = the reference label. The reference labels become the TITLES and a11y strings. Pick five distinct icons; none may collide with the task icons (Mic = translate, ListChecks = review). |
| Red numeric badge on tabs | Red means recording (the VAD takeover). Yellow is only the next action. Colour is never alone. | A badge in `colors.foreground` (dark) with a white numeral, or `colors.translate`. Never red, never yellow. The numeral carries the meaning. |
| Active tab = a primary-tint pill plus primary text | Our active indicator is a `colors.translate` bar | Keep ours. |
| Sign-in persona cards | Production sign-in | Keep them in DevMenu only. |
| Vision and walkthrough: emoji + title + body + 💡 tip, with "Try:" buttons | Icons carry meaning (Lucide set). Text is not instruction for U. One action. | Lucide icon per step. Reference **title** as the one line. Body optional and muted (these screens are onboarding, literate-leaning: treat them as "U, text fallback" like `sign_in`). No tip box; no "Try:" buttons (inert in the reference). Skip goes in the header so the footer keeps one yellow Continue. |
| `intent_chooser` offers four equal cards | One yellow action per screen | Keep the QR circle as the single yellow action. Show the other options as neutral Rows directly below, not behind "More options", because the reference ADR-014 bans "More options". Use the reference labels and sub-lines verbatim. |
| My Work lists For you / Recent / Waiting on others as text cards | The dashboard is a to-do list; done items stay visible and struck through; one yellow action | The three sections become icon-led row groups. The first For-you item drives the **one yellow footer action** (our existing `next` pattern). Waiting rows use the `Clock` icon (both specs agree). Recent rows are neutral. Consider keeping "done" items struck through inside Recent to honour our "done stays visible" rule. Surface this: the reference hides finished work, we show it struck through. Pick ours (Rule 7: it is an explicit design-language rule), and flag it. |
| Toast: dark pill + green check + "Undo" | Colour never alone; status colours fixed | Compatible: `colors.done` with the `CheckCircle2` icon. The Undo button is outline, not yellow, so it doesn't compete with the screen's next action. |
| Sign Out as a red destructive button in Settings | Only four task hues. Red is reserved. | Outline button with the `LogOut` icon. The destructive meaning lives on `sign_out_confirm` (the guard plus icon), as today. |
| "No email linked" in amber | Amber ≈ our `reference` / `action` colours, which have meaning | Use the muted foreground with an `AlertCircle` icon, and only if email-less accounts ever exist (J-ENTRY-3, deferred). |
| Inbox rows are text-first (title, body, timestamp) | Inbox is avatar P (`AVATAR.inbox_home = 'P'`) | Text is fine (P). Add type icons with the task colour tints so a U user can still read the kind at a glance. |
| Settings, Profile, Org switcher: text-dense | Avatar P | Compatible. Adopt the reference structure and copy with our components (`pui.tsx` `Section` / `Row`). |

## Open decisions to put to the user

1. Explore / public projects: keep it retired (recommended) or port it?
2. Undo on sends: a delayed append (not durable for about 7s) or compensating events (new versioned events)?
3. Pre-auth org list and invite peek: new RPCs, with privacy implications.
4. Email-less QR accounts: defer (recommended)?
5. Keep `pickup_home` and the "Bible" row on My Work as app-only, or move them to the Map (depends on the map/record analysis)?
6. A no-org user with no tab bar: accept the app-only `intent_chooser→sign_out_confirm` edge?
7. Done items on My Work: keep our struck-through rule, or the reference's omission?
