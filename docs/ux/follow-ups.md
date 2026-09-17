# UX Vision Drift: Follow-Ups After Inbox P0 Fix

**Last Updated:** 2026-09-17 (PR #4)  
**Audit Source:** drift-summary.md, drift-inventory.md (2026-09-17)

This document tracks remaining UX-vision alignment work after the P0 Inbox fix (PR #4).

---

## ✅ Completed in PR #4

**Problem:** Inbox duplicated My Work's task list, decision rows were unwired, and Inbox tab showed for everyone.

**Fixed:**
- ✅ Removed duplicate task list from `InboxHome` (no longer calls `deriveTasks()`)
- ✅ Wired decision rows to navigate to `piece_review` with proper params
- ✅ Made Inbox tab conditional on `inboxCount > 0` (hides when empty)
- ✅ Added `deriveInboxCount()` to count decisions on user's takes
- ✅ Updated comments to clarify Avatar P notification-centre purpose

**Files:** `apps/mobile/src/screens/account.tsx`, `apps/mobile/src/session.ts`, `apps/mobile/App.tsx`

---

## 🔴 P1: Legacy Redirect Screens (1 hour)

### Problem
Two screens exist solely to redirect users to Status, adding unnecessary navigation hops.

### Still Open

#### Progress Home (`work.tsx` line 276–283)
- **Current:** Shows "Progress now lives on Status" message with manual navigation
- **Issue:** Extra screen in nav path; assignment progress detail links here first
- **Fix:** Delete `ProgressHome` function, remove from `flow.ts` SCREEN_IDS/EDGES, update `App.tsx` SCREENS registry
- **Impact:** Simplifies nav stack; assignments go directly to Status

#### Assignment Progress Detail (`work.tsx` line 252–272)
- **Current:** App-only screen showing task status + link to Progress Home
- **Issue:** Long-press on task card → intermediate screen → redirect → Status
- **Fix:** Delete `AssignmentProgressDetail` function, update edge `assignments_home → assignment_progress_detail` to point directly to `status_home`
- **Impact:** Removes dead-end navigation path

**Effort:** 30 min each  
**Test:** Long-press task card → should navigate directly to `piece_status`

---

## 🟡 P2: Stub Forms & Unwired Screens (7 hours to wire, 30 min to hide)

### Still Open

#### 1. Profile Edit (`account.tsx` line 70–77)
- **Current:** Shows `<NotWired what="Profile names and photos" />`, disabled Save button
- **Issue:** Settings → Edit profile goes to dead-end screen
- **Options:**
  - Quick: Comment out "Edit profile" row in `SettingsHome` (5 min)
  - Full: Wire to `profiles` table with `displayName`, `photoUrl` fields (2h)
- **Impact:** Eliminates dead-end or enables profile customization

#### 2. Org Switcher (`account.tsx` line 80–90)
- **Current:** Hardcoded "org1" with no interaction
- **Issue:** Settings → Switch organization shows static list
- **Options:**
  - Quick: Comment out "Switch organization" row in `SettingsHome` (5 min)
  - Full: Wire to org membership list, switch active org context (1h)
- **Impact:** Hides non-functional affordance or enables multi-org

#### 3. Explore Home (`entry.tsx` line 49–50)
- **Current:** "Browse public projects" button on sign-in goes to empty screen
- **Issue:** Guest onboarding gap; screen exists but shows nothing
- **Options:**
  - Quick: Comment out browse button in `SignIn` (5 min)
  - Full: Wire to public projects list with join flow (2h)
- **Impact:** Removes misleading button or enables guest browsing

#### 4. Create Org (`entry.tsx`)
- **Current:** Form present in `CreateOrg` screen, submit button not wired
- **Issue:** Intent Chooser → Create organization → dead-end form
- **Options:**
  - Quick: Not recommended (form is only path for no-org users)
  - Full: Wire submit to `ctx.org.append('v1.OrgCreated', { name })` (1h)
- **Impact:** Enables first-org creation (required for no-org onboarding)

#### 5. Request Access Offline (`entry.tsx`)
- **Current:** Online submit works, offline breaks silently
- **Issue:** No feedback when request can't be sent due to lack of connection
- **Options:**
  - Quick: Disable "Send request" button when offline + show notice (1h)
  - Full: Add offline outbox queueing for access requests (2h)
- **Impact:** Clear offline UX vs silent failure

**Recommended:** Quick-hide Profile/Org Switcher (10 min), wire Create Org + Request Access offline (2h)  
**Test:** Settings shows fewer dead-end rows; no-org flow completes; offline request queues or warns

---

## 🟢 P3: Preventative Measures (4 hours)

### Still Open

#### Avatar Enforcement Tests
- **Current:** Avatar U/P constraints (PLAN.md §12) enforced by review only
- **Issue:** No automated check prevents drift (e.g., Avatar U screen with prose, missing yellow action)
- **Fix:** Add `apps/mobile/test/avatarParity.test.ts` checking:
  - Avatar U screens use `<ActionButton>`, not `<Footer>` with multiple actions
  - Avatar U screens have <20 words of prose (excluding passage refs)
  - Avatar U screens use 6% tints (`tint.translate`, `tint.review`, etc.)
- **Impact:** CI catches design-language violations before merge

**Effort:** 4 hours  
**Test:** Run `npm test` → all Avatar U screens pass; add prose to one → test fails

---

## 🔵 Architecture Gaps (No Code Changes Yet)

### Notifications Worker (G6 from flow-coverage-audit.md)
- **Current:** Inbox shows decisions only; join requests noted but not implemented
- **Issue:** No server worker to derive notifications from partition tail
- **Design:** `docs/flow-coverage-audit.md` section 5.G — fold tail, write notifications for:
  - Assigned to you
  - Review requested
  - Suggestions on your take
  - Join request for an org you can admit to
  - Blocker in a project you coordinate
- **Scope:** Server worker + `v1.NotificationCreated` event + inbox derivation
- **Impact:** Inbox becomes fully functional notification centre

**Effort:** Unknown (server feature, not mobile)  
**Prerequisite:** Join requests data model (currently stubbed)

---

## Summary: What's Left

| Priority | Item | Quick Fix (hide) | Full Fix (wire) | Recommended |
|----------|------|------------------|-----------------|-------------|
| P1 | Progress Home | N/A | 30m (delete) | Delete |
| P1 | Assignment Progress Detail | N/A | 30m (delete) | Delete |
| P2 | Profile Edit | 5m | 2h | Hide for now |
| P2 | Org Switcher | 5m | 1h | Hide for now |
| P2 | Explore Home | 5m | 2h | Hide for now |
| P2 | Create Org | N/A | 1h | Wire (required) |
| P2 | Request Access offline | N/A | 1h | Wire (UX gap) |
| P3 | Avatar tests | N/A | 4h | Add when P1/P2 done |

**Next sprint:** P1 deletions (1h) + Create Org + Request Access offline wiring (2h) = 3h to clear critical path.

---

## Related Documents

- [Spoken Worldwide workflow](spoken-worldwide-workflow.md) (six-stage mapping, resource access, proposed views, and acceptance walkthroughs)
- [PLAN.md](../../PLAN.md) sections 12–13 (Avatar U/P design language)
- [one-next-action.html](./one-next-action.html) (interactive UX reference)
- [README.md](./README.md) (UX mocks overview)
- [flow-coverage-audit.md](../flow-coverage-audit.md) (architecture gaps G1–G12)
- [journey-tests/findings.md](../journey-tests/findings.md) (detailed test coverage)

**Audit artifacts** (not in repo): drift-summary.md, drift-inventory.md from 2026-09-17 UX audit
