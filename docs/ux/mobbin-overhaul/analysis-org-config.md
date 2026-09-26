
SUMMARY (10 lines)
1. Admins land on the wrong screen. The reference sends everyone who works to My Work and puts org, project and language homes behind a Manage tab (ADR-017). We send admins straight to their home (m:src/session.ts:106-113, flow.ts:122-124). Fix: add `manageHomeFor`, change `homeScreenFor`, and use the tabs My Work / Map / Manage / Inbox / Settings.
2. The flow editor is the largest gap. Our steps are role + quorum stages. The reference steps hold review kinds: parallel kinds shown as "Together", a Checkpoint toggle, "Collect only", a kind picker, and org-level flows that apply live to every language using them. Our core has none of this.
3. Core needs new facts: v1.ReviewKindDefined, v2.WorkflowStepSet, v1.StepOverridden and v1.ContentProduced (all proposed in PLAN 16), plus v1.ReviewFlowDefined. The proposed v2.WorkflowStepSet also needs an owner key (flowId or laneId) before it ships.
4. Back translation as a "producing kind" is catalog data only in the reference; there is no UI to mark a kind as producing. My recommendation is to seed it through ReviewKindDefined and not invent a toggle.
5. Spoken should be an ordinary flow. Retire the flows_home→obt_manage path, and drop "Revision"/"Final recording" as stages (ADR-011, PLAN 16).
6. The org screens are thin. The org and project homes need progress counts and catalog rows, and the crumb is a hardcoded 'org1' bug. New project should be name + description only, not our 3-step wizard. New language needs a name field and default template and flow.
7. Members, invite and edit member ignore scope. We list project-partition members, and every invite is issued at org scope (org.tsx:266). The reference uses email + role + assignment scope, a Role / Name / QR stepper, and an "Assign Role" step for join requests.
8. Review teams save only one team and silently rewrite workflow steps; that side effect should go. Roles need human labels and descriptions, sections by the level they were defined at, and "Members with this role".
9. Our privilege list lacks `override_checkpoints`, and `send_to_reviewers` should count toward isWorker. Seed roles also differ: our Translator cannot review and our Reviewer cannot fill reference. Widening those affects old data, so I flagged it for you rather than recommending it.
10. Viewer status should become "Progress" with counts per step. Key terms and reference material need concept homes at org or project level and question sets tied to review kinds. That needs new facts, all named in the report.

Intended output path (write blocked): /private/tmp/claude-501/-Users-ryderwishart-frontierrnd-langquest-next/90efa571-6c2a-45bc-a92e-fecce9a2913e/scratchpad/analysis-org-config.md

================ FULL REPORT (save as analysis-org-config.md) ================

# Gap analysis: Organization and configuration (reference `caleb-spoken-mobbin-overhaul` vs langquest-next)

Read-only analysis. No code was changed.

Path conventions:
- `ref:` = `/private/tmp/claude-501/-Users-ryderwishart-frontierrnd-langquest-next/90efa571-6c2a-45bc-a92e-fecce9a2913e/scratchpad/ux/` (reference branch checkout).
- `m:` = `/Users/ryderwishart/frontierrnd/langquest-next/apps/mobile/`.
- `core:` = `/Users/ryderwishart/frontierrnd/langquest-next/packages/core/src/`.
- "Supported" means an existing shipped event carries the fact today. "New fact" names a new versioned event only (PLAN.md 16.1).

What the overhaul branch changed in this domain (`git diff origin/main...HEAD`):
- Admins no longer land on the org/project/language home. They land on My Work and reach their home through a Manage tab (ADR-017).
- The homes show recorded/done counts instead of a single percent (ADR-004).
- The language home gains a "Passage map" card.
- `flows_home` gains a real flow editor: parallel kinds in one step, checkpoints, a kind picker.
- Key terms become concepts with a rendering per language.
- Status becomes "All Languages", with the screen titled "Progress" and counts per step.
- `material_editor` becomes "Edit Material".

## 0. Cross-cutting conflicts to settle first (Rule 7)

1. **Where admins land.**
   - Reference: everyone who does or asks for work lands on my_work, and admins get a Manage tab (ref:src/domain/session.ts:118-134, ADR-017).
   - Ours: admins land on the scope home (m:src/session.ts:106-113, m:src/flow.ts:122-124).
   - Decision: follow the reference. PLAN 16 already agrees.
2. **Settings at the org level.**
   - Reference: all three homes carry "Manage Content" and "Manage Processes" rows, filtered to that level (ref:src/screens/org.tsx:52-88, ref:src/App.tsx:979-998).
   - PLAN 16 says settings live only on the project and language.
   - Recommendation: follow the reference (the user's instruction is the newer one). Keep our three folders as the look of those rows: What to translate = Content Templates, What to study = Reference Material, How it's checked = Review Flows. At the org and project level the folders open the multi-language "Used by" view.
   - Update PLAN 16 in the same change, and flag this to the user.
3. **Flows as an org catalog vs per-lane copies.**
   - Reference: a flow is an org object, and a language applies it. Edits reach every language: "Changes apply to their passages right away" (ref:src/screens/config.tsx:497).
   - Ours: catalog flows are instantiated into per-lane v1.WorkflowStepSet copies, and edits are per lane (core:catalog.ts:266-277, m:src/screens/config.tsx:274-318).
   - This is the largest model gap.
4. **Spoken as a special mode.**
   - Ours: the flows footer switches to obt_manage for spoken_worldwide (m:src/screens/config.tsx:293). The catalog has "Revision" and "Final recording" as stages (core:catalog.ts:147-156).
   - The reference (ADR-011) and PLAN 16 treat Spoken as an ordinary flow: Community → Peer → Back Translation → Consultant (checkpoint) → Local.
   - Decision: follow the reference. Legacy OBT events keep folding.
5. **Which privilege gates admin actions.**
   - The reference uses `Assign Work` (canAssign) as a blanket gate for New project, New language, Invite and Teams (ref:src/App.tsx:243,1639,1648,1721,1753).
   - We must gate on the privilege the emitted event needs (core:org.ts:96-152 EVENT_PRIVILEGE, which the server enforces): manage_structure, invite_members, manage_teams.
   - Decision: use ours, and flag the reference's shortcut.

## 1. Journey checklist

### J-ORG-0 An admin reaches management through the Manage tab
- [ ] **Persona:** org, project and language admins.
- **Reference:**
  - Sign in → home_hub → my_work ("route · trans / review / admin-*", ref:src/flow.ts:154).
  - Tabs: My Work, Map, Manage (admins only), Inbox, Settings (ref:src/App.tsx:283-289).
  - Manage opens `manageHomeFor(adminScope)`: org→org_home, project→project_home, language→language_home (ref:src/domain/session.ts:127-134).
  - At the root the manage home has no Back (ref:src/App.tsx:1722,1739).
  - Viewers land on status_home and have no Manage tab.
- **Ours:**
  - homeScreenFor sends admins to their scope home (m:src/session.ts:106-113).
  - tabsFor = [home, status_home, inbox if count>0, settings] (m:src/session.ts:136-143).
  - home_hub has edges to the three homes (m:src/flow.ts:122-124).
- **Gaps:** no Manage tab, no manageHomeFor, and admins do not land on My Work. The Inbox tab hides at 0 (the reference always shows it). The Map tab belongs to the map domain.
- **Changes:**
  - session.ts: add `manageHomeFor`. `homeScreenFor`: admin → My Work (assignments_home, or my_work after the port).
  - tabsFor → [my_work, map, manage?, inbox_home, settings_home].
  - flow.ts: remove home_hub→org_home, project_home and language_home. Keep the homes in TAB_SCREENS.
  - App.tsx: tab icon and active-tab fallback (see ref:src/App.tsx:292-297).
  - Regenerate m:test/spec-flow.json and specParity.
- **Data:** none. adminScopeOf exists (core:org.ts:428-438).

### J-ORG-1 An org admin sees the org home and its projects with progress
- [ ] **Persona:** org admin.
- **Reference org_home** (ref:src/screens/org.tsx:99-150; wired ref:src/App.tsx:1638-1646):
  - Header card: org name, "{region|New organization} · n project(s) · n member(s)", role badge.
  - "Manage Projects": row sub "{recorded} of {total} recorded · {done} done", or "No passages yet" (95-97).
    - Empty copy: "No projects yet. A project holds the languages you translate into — add one to start." (135).
    - Add row: "New project".
  - "Manage Content": "Content Templates" (sub "{names} · n languages") and "Reference Material" (sub "n study · n question sets · n key terms").
  - "Manage Processes": "Review Flows". Each row is hidden without its Manage privilege (59-88; subs ref:src/App.tsx:979-998).
  - "Manage Members": Roles "{n} roles at this level and above", Members "{n} at org level · {n} total" (37-50).
  - Sections collapse (8-35).
- **Ours OrgHome** (m:src/screens/org.tsx:77-96):
  - Project rows have no sub. The add row reads "Set up project" or "New project", gated by isAdmin.
  - The roles count uses the fixed 5-role constant (20, 71). The members count comes from the project partition (68).
  - No catalog rows.
- **Gaps:** progress, empty copy, catalog rows, correct counts, collapse.
- **Changes:**
  - Add a progress sub and catalog rows or folders gated by manage_templates, manage_reference and manage_flows, opening with a level param.
  - Roles count = non-retired org roles. Members = `membershipsOf`.
  - Add edges org_home→templates_home, reference_home and flows_home (gated), mirroring ref:src/flow.ts:253-255.
- **Data:** progress for projects that are not open needs a projection. We fold only the open partition; `supabase/functions/project-projections` could supply it. Alternatively, show "Open to see progress". No new event.

### J-ORG-2 An org admin creates a project
- [ ] **Persona:** org admin (manage_structure).
- **Reference:**
  - org_home "New project" → new_project (ref:src/flow.ts:251).
  - "New Project" (ref:src/screens/org.tsx:907-948; ref:src/App.tsx:1702-1714):
    - Hint: "A project groups languages that share templates, reference material, and review flows."
    - "Project name"; "Description" with placeholder "What this project covers".
    - "Create Project".
  - Back to org_home. Toast: "{name} created — add its languages next".
- **Ours NewProject** (m:src/screens/org.tsx:353-520):
  - A 3-step wizard ("Set up project · Step n of 3"): structure, reference note/audio, assign the first passage.
  - Emits ProjectRegistered, ProjectCreated, MemberAdded(owner), LaneAdded, LaneTemplateSelected, UnitAdded*, Material*, AssignmentMade.
  - Uses ctx.project.projectId, so it never truly creates a second partition. Edge new_project→project_home replace (flow.ts:215).
- **Gaps:** no description; too much in one wizard (PLAN 16: "Admins do not pick passages from setup"); no new partition.
- **Changes:**
  - Replace it with a name + description form.
  - On create: generate a projectId → org.append ProjectRegistered → openOrganization(new) → ProjectCreated + MemberAdded(owner) in the new partition. Toast, then back.
  - Move template to J-CFG-1 and reference to J-CFG-7. Drop the assignment step (the record domain's "Ask someone").
  - Update screenContracts.
- **Data:** ProjectRegistered and ProjectCreated are supported. Description needs a new fact (`v1.ProjectDescribed`). The project "status" badge must be derived, never stored.

### J-ORG-3 A project admin opens a project home and adds a language
- [ ] **Persona:** project admin (manage_structure).
- **Reference project_home** (ref:src/screens/org.tsx:634-683; ref:src/App.tsx:1715-1729):
  - Crumbs "{org} › {project}".
  - Header: description, status badge, "n languages", Recorded/Done bars (687-702).
  - "Manage Languages": row sub "{flowName} · {recorded} of {total} recorded · {done} done". Empty copy: "No languages in this project yet."
  - Catalog rows. Members sub "{n} assigned in this project".
- **Reference new_language** (ref:src/App.tsx:1664-1679):
  - "New Language". Hint: "This language is added to the current project. You can invite language admins from Members after it is created."
  - "Language name"; "Language code" with placeholder "e.g. DIN".
  - "Create Language". Toast: "{name} added to {project}".
  - The new language gets the default template and flow (ref:src/App.tsx:945-951).
- **Ours:**
  - ProjectHome (m:src/screens/org.tsx:98-119): hardcoded crumb 'org1' (104). Rows show languoidId with "{template} · {checks}". Has a "Status › Open status" row.
  - NewLanguage (522-535): code only, laneId `L-${code}`, no toast, no defaults.
- **Changes:**
  - Real org name in the crumb. Flow name + counts in the row sub. Catalog rows and edges.
  - NewLanguage: name + code, toast, apply default template (LaneTemplateSelected + UnitAdded) and default flow.
  - Remove project_home→status_home.
- **Data:** LaneAdded is supported. Language display name needs a new fact (`v1.LaneNamed`). The "Translator: {name}" line has no source; derive it or drop it.

### J-ORG-4 A language admin opens a language home
- [ ] **Persona:** language admin.
- **Reference language_home** (ref:src/screens/org.tsx:704-758):
  - Crumbs "{org} › {project} › {language}". Header "Translator: {name} · Review flow: {flowName}" + bars.
  - Primary card "Passage map" / "Every passage, where it stands, and what's next" → map_home (ref:src/flow.ts:180).
  - Manage Content; Manage Processes (Review Flows, and "Review Teams" / "Language reviewers grouped into teams"); Manage Members.
- **Ours LanguageHome** (m:src/screens/org.tsx:121-148):
  - Crumb bug 'org1' (130).
  - Three SetupFolders: "What to translate", "What to study", "How it's checked".
  - "Review teams" row, member rows, and "Open status" → language_status.
- **Changes:**
  - Add the header line and progress.
  - Replace "Open status" with the Passage map card → the map screen (the map domain owns the id). Add edge language_home→map_home and remove language_home→status_home (flow.ts:231).
  - Keep the folders, with Review teams below them (PLAN 16: advanced rows below folders).
- **Data:** derived only.

### J-ORG-5 An admin browses members by level
- [ ] **Persona:** admin. Others see the list view-only.
- **Reference members_list** (ref:src/screens/org.tsx:154-242):
  - Header "Members" + "+ Invite".
  - Intro: "Members assigned at {level} scope{ for this view}. Expand the groups below for the other levels."
  - "{Level} members · n". Empty copy: "No members assigned at this level yet."
  - "Expand by" → "By project" / "By language". "Higher levels · view only".
  - Row: avatar, name, "{target} · joined {date}", role or "Pending" badge, edit chevron, or "View only" + lock (263-319; memberTargetLabel ref:src/data.ts:1054-1069).
- **Ours MembersList** (m:src/screens/org.tsx:150-215):
  - Shows project-partition members (153) with the raw id as sub and the fixed role badge.
  - "Asking to join" accept/decline. The footer Invite is gated by isAdmin.
- **Gaps:** org memberships and scopes, expanders, higher levels, view-only rows, gate.
- **Changes:**
  - Build the list from ctx.org.state.members, filtered by level param. Add expanders and "Higher levels · view only". Name from displayName or the people context. "joined" from the register hlc.
  - Keep legacy v1.MemberAdded rows as their own group (PLAN 16.1 rule 5).
  - Gate Invite on invite_members.
- **Data:** supported: OrgMemberAdded (with scope and displayName), OrgMemberRemoved, membershipsOf.

### J-ORG-6 An admin invites someone by email with a role and a scope
- [ ] **Persona:** invite_members.
- **Reference invite_member** (ref:src/screens/org.tsx:329-523):
  - Hint: "Pick a role, then choose the scope this assignment applies to. Scope can be this level or below."
  - Card: "Invite by QR code" / "For people without email — they scan to join".
  - "Email address" (placeholder "name@example.com").
  - "Role": cards with description, and a "Defined · {Level}" badge.
  - "Assignment scope": Organization / Project / Language, with levels above the inviter disabled. Line: "Where this person can use the selected role’s privileges."
  - For project or language scope: "Project" or "Language", with "Which project/language this assignment applies to."
  - "Send Invite" → toast "Invite sent to {email}", with Undo → "Invite taken back" (ref:src/App.tsx:1193-1195).
- **Ours:**
  - InviteMember (m:src/screens/org.tsx:217-232): "They join as" role list, then "Next" → invite_qr.
  - InviteQr issues at a hardcoded {level:'org'} (266). Email comes only after the token is created.
- **Changes:**
  - Restructure invite_member: QR card, email, role with description, scope pickers (port `assignableScopes`/`grantScopeAt` from ref:src/data.ts:1044-1052).
  - "Send Invite" = issueInvite(scope) + send-invite.
- **Data:** InviteIssued already has scope. Undo needs a new fact (`v1.InviteRevoked`), and redeem_invite must refuse revoked invites.

### J-ORG-7 An admin invites someone without email by QR (role, name, code)
- [ ] **Persona:** field admin.
- **Reference invite_qr** (ref:src/screens/org.tsx:527-628):
  - Header "Invite by QR". Stepper "Step n of 3 — Role / Name / QR code".
  - Role step:
    - Copy: "Pick the role this person should have. You don't need their email."
    - Dashed "Create a new role" → role_editor (ref:src/flow.ts:282). The saved role is preselected on return (ref:src/App.tsx:1019).
  - Name step: "A name so you can recognize them. If they already have an account, their name replaces this when they scan." Placeholder "e.g. Nyibol Deng".
  - QR step:
    - The QR, "{name}", "{role} · {Level}".
    - Copy: "Hold this up for them to scan. Tap Done when it has been scanned."
    - Done → members_list popTo.
- **Ours InviteQr:** the role comes from the previous screen, there is no name step, and no create-role shortcut. It shows the token, "Shown once…", email and share. The edge invite_qr→role_editor exists but is unused.
- **Changes:**
  - Make invite_qr a 3-step stepper. Keep the token, expiry and share on the last step.
  - Add "Create a new role", with a roleId param back on return.
- **Data:**
  - A name on the invite needs a new fact (`v1.InviteNamed`).
  - Show "Invited · not yet joined" from OrgState.invites where redeemedBy is null (supported, core:org.ts:228-235). Our model has no pre-created pending member.

### J-ORG-8 An admin changes a member's role or scope, or approves a join request
- [ ] **Persona:** invite_members.
- **Reference:**
  - edit_member reuses the invite form. Title = name, or "Assign Role". Sub "{role} · {target}".
  - Pending hint: "This person created an account and asked to join. Assign a role and scope to give them access."
  - Buttons "Save Assignment" / "Assign Role". Toast "{name} is now {role}" (ref:src/App.tsx:1680-1697).
  - A join request arrives in Inbox: "Join request" / "{name} asked to join {org}. Assign a role to give them access." Accept → edit_member (ref:src/App.tsx:1040-1051, 1596-1606; ref:src/flow.ts:279-280).
  - role_editor → "Members with this role" → edit_member (288).
- **Ours:**
  - EditMember (m:src/screens/org.tsx:307-351) shows raw scope keys (339). It changes role within a scope but cannot change scope. Buttons "Save member" / "Remove from this scope".
  - Join requests are accepted on members_list with a default role of translator (173).
- **Changes:**
  - Use one component for invite and edit.
  - Scope change = OrgMemberRemoved(old) + OrgMemberAdded(new). Human scope labels.
  - Accept → edit_member in "Assign Role" mode → decideRequest(id, true, roleId, scope). Toast.
  - Change the gate on inbox_home→edit_member to invite_members.
- **Data:** supported (OrgMemberAdded/Removed, JoinDecided). The decide_request RPC needs a scope parameter (server change, no event).

### J-ORG-9 A language admin sets up review teams
- [ ] **Persona:** manage_teams.
- **Reference review_teams** (ref:src/screens/org.tsx:762-827):
  - Header "Review Teams" + "+ Team".
  - Intro: "Teams for {language}. Members must have the Review privilege and be assigned at this language."
  - Cards: name, "{n} members", chips.
  - Empty state: "No review teams" / "Create a team to group language reviewers."
- **Reference review_team_editor** (829-903):
  - Editable title (placeholder "Team name").
  - "Members" with the hint "Only members with Review privilege at this language can be added." (languageReviewers ref:src/data.ts:1117-1123).
  - Empty: "No eligible reviewers. Invite members with a Review role scoped to this language first."
  - "Delete team" with Undo → "Team brought back". "Save Team" → toast "{name} saved · n people".
  - The team's kindId (ranking when asking) exists but has no UI.
- **Ours:**
  - ReviewTeams (m:src/screens/org.tsx:538-563): the footer edits only the first team (544). An "Edit stages" row → flow_editor (558-560; flow.ts:260).
  - ReviewTeamEditor (566-604): every project member is eligible. Saving rewrites every reviewer WorkflowStepSet to use this team (581-588).
- **Changes:**
  - A list of all teams; "+ Team" → editor with a teamId param.
  - Filter eligible members by the review privilege covering the lane.
  - Remove the step-rewrite side effect.
  - Add delete + Undo. Remove the review_teams→flow_editor edge.
- **Data:** ReviewTeamDefined and ReviewTeamMemberSet are supported. Delete needs a new fact (`v1.ReviewTeamRetired`). If the ask port needs the usual kind: new fact `v1.ReviewTeamKindSet`.

### J-ORG-10 An admin manages roles by level
- [ ] **Persona:** manage_roles.
- **Reference roles_home** (ref:src/screens/config.tsx:9-77):
  - Header "Roles" + "+ Role".
  - Intro: "Roles are privilege sets without a fixed scope. Scope is chosen when assigning a role to a member." Plus one of:
    - " Roles created here can be assigned at any level."
    - " Showing roles defined here, plus view-only roles from higher levels."
    - " Showing roles defined at this level or higher. View only."
  - Sections "Defined at {Level}".
  - Inherited rows: grey, lock, "View only · edit from the level where it was defined". Own rows: "n members · n privileges".
- **Reference role_editor** (79-198):
  - Editable title (placeholder "Role name"). Sub "{Role|New role} · {Level}".
  - Banners:
    - "View only — defined at the {level} level. Edit it from {Level} Home."
    - "View only — you do not have permission to edit this role."
  - "Members with this role" → edit_member.
  - Scope notes:
    - "Scope is not set here — choose organization, project, or language when inviting or editing a member."
    - "Scope is assigned per member when this role is given."
  - "Permissions": a toggle + PRIVILEGE_DESC line per privilege.
  - "Create Role" / "Save Role". Toast "{name} role created/saved".
- **Ours:**
  - RolesHome (m:src/screens/config.tsx:16-29): one "Defined at organization" section and a "New role" footer.
  - RoleEditor (31-70): labels are raw ids with underscores replaced, no descriptions. Save requires at least one privilege (54).
- **Changes:**
  - A mobile PRIVILEGE_LABEL/DESC map (copy ref:src/data.ts:149-164).
  - Member count and member list. Intro and banners.
  - Gate role_editor→edit_member on invite_members.
  - Flag the ≥1-privilege rule; the reference allows empty TBD roles.
- **Data:** RoleDefined is supported. Description and definedAt need a new fact (`v1.RoleDescribed {roleId, description, definedAt}`). Until then, every role reads as org-defined.

### J-CFG-1 An admin picks a content template, or sees who uses which
- [ ] **Persona:** manage_templates.
- **Reference templates_home** (AppliedCatalogScreen ref:src/screens/config.tsx:205-299; ref:src/App.tsx:1794-1809):
  - Title "Content Templates".
  - Intro at language level: "Templates divide Scripture into passages. Choose the one this language records against."
  - Intro at org or project level: "Templates divide Scripture into passages. Each language applies exactly one — this view covers the {n} languages in this organization|project."
  - Cards: name, code badge, description.
    - Language level: "Use" / "✓ In use".
    - Other levels: "Used by {names}" / "Not used in this view", plus a "By language" expander.
  - Toast "{language} now uses {name}" with Undo → "Undone — nothing changed" (ref:src/App.tsx:965-976).
  - Gate: canManageCatalog = privilege AND adminScope rank ≤ level (961-963).
- **Ours TemplatesHome** (m:src/screens/config.tsx:73-119):
  - Lane level only. A row press applies immediately, with no Undo.
  - Has a "Choose a Bible passage" row → dynamic_bible (98-99; flow.ts:95).
- **Changes:**
  - Port AppliedCatalogScreen with a level param. Use a Use/In use pill, not a row press. Add Undo (re-select the previous template).
  - Note that units from the old template stay (UnitAdded is grow-only).
  - Remove templates_home→dynamic_bible.
- **Data:** supported (LaneTemplateSelected, instantiateTemplate). The catalogs differ: ours dynamic/fia/bible/book (core:catalog.ts:122-138), the reference has 7 (ref:src/data.ts:857-865). Keep ours.

### J-CFG-2 An admin picks a ready-made review flow
- [ ] **Persona:** manage_flows.
- **Reference flows_home** (ref:src/App.tsx:1810-1834):
  - Title "Review Flows", "+ Flow".
  - Intro at language level: "The flow is advice: it suggests what should happen next. Steps can be done in any order or set aside with a reason — only checkpoints are required."
  - Intro at other levels: "Each language runs one review flow — this view covers the {n} languages in this organization|project. Flows are advice; checkpoints are the only hard stops."
  - Card sub: steps joined " → ", parallel kinds joined " + " (stepName ref:src/domain/record.ts:83-85), or "Recorded is done".
  - FlowStepsInline (ref:src/screens/config.tsx:302-329): chips with parallel kinds stacked, checkpoint steps amber with a lock. Empty: "No reviews — done once recorded".
  - "Use"/"In use", and "Edit"/"View" → flow_editor.
  - Six flows (ref:src/data.ts:294-336):
    - Standard Bible: [Peer + BT] → Community → Consultant🔒 → Final.
    - Quick Check: Peer → Final.
    - Oral Review Path: [Community + Retell] → Final🔒.
    - Consultant-only: Consultant🔒 → Final.
    - Collect only: no steps.
    - Spoken Oral Method: Community → Peer → BT → Consultant🔒 → Local.
  - Defaults per language: DEFAULT_LANGUAGE_SETUP (1005-1012).
- **Ours FlowsHome** (m:src/screens/config.tsx:274-318):
  - The FLOW_TEMPLATES role/quorum stages (core:catalog.ts:145-192).
  - Press = LaneFlowSelected + remove the old steps + instantiateFlow.
  - "Applied stages" rows. For spoken, the footer "Configure oral workflow" → obt_manage.
- **Gaps:**
  - No kinds, no parallel kinds, no checkpoint, no Collect only, no Local.
  - Spoken includes Revision and Final recording as stages. Standard Bible differs.
  - No Undo and no org or project view.
- **Changes:**
  - Port AppliedCatalogScreen + FlowStepsInline with our tokens: review teal chips; a checkpoint gets a lock + dashed border, never colour alone.
  - Switch to the six reference flows as org flows. Keep old FLOW_TEMPLATES ids readable as "Older flow (v1 stages)".
  - Remove the flows_home→obt_manage footer and edge (flow.ts:139). Add "+ Flow".
- **Data:** LaneFlowSelected is supported. New facts:
  - `v1.ReviewKindDefined {kindId, name, produces?, withholdsContext?}` (PLAN 16).
  - `v2.WorkflowStepSet {stepId, kindIds[], checkpoint?, order}` (PLAN 16) plus an owner key, flowId or laneId, which must be decided before it ships.
  - `v1.ReviewFlowDefined {flowId, name, description}` in the org partition.
  - deriveWorkflow (core:workflow.ts:12-27) must merge the org flow's v2 steps with legacy v1 steps (a v1 step reads as one kind). It crosses partitions, so do it as a read model over both states, never inside the reducer.

### J-CFG-3 An admin designs a flow with two parallel kinds and a consultant checkpoint
- [ ] **Persona:** org admin (manage_flows).
- **Reference flow_editor** (FlowEditorScreen ref:src/screens/config.tsx:335-527):
  1. flows_home → "+ Flow" or "Edit" (ref:src/flow.ts:291).
  2. Header:
     - Editable title (placeholder "Flow name"), sub "Review flow".
     - Info card: "Steps are a suggested order. Kinds in the same step can happen together. Anyone can set a step aside with a reason; a checkpoint is the only hard stop — moving past one needs the Override Checkpoints permission, and the reason is recorded." (387-389).
     - Description textarea, placeholder "What this flow is for (shown to teams choosing it)".
  3. A new flow starts as [Peer Review]. Each step card has:
     - A number bubble and the label "Step", or "Together" when it holds more than one kind (426).
     - Move up, Move down and Remove step, each 48px.
     - Kind chips with ×.
     - "+ Alongside" (or "+ Add kind" when empty) (459).
     - A Checkpoint toggle: "Later steps wait for this one." / "Can be set aside with a reason." (466-472). A checkpoint step is amber.
  4. Connectors read "then", or "then, once cleared" after a checkpoint (416).
  5. The kind picker sheet:
     - "Add a kind of review" / "Kinds are your organization's vocabulary. Add your own if these don't fit."
     - Rows with icon, name and description.
     - "New kind — e.g. Elder Review" + "Add" (529-567).
  6. "+ Add step" adds a step and opens the picker. "Collect only" shows: "No reviews. A passage counts as done once it's recorded. Teams can still record reviews — they just aren't suggested." (403-405).
  7. Footer:
     - "Used by {langs}. Changes apply to their passages right away — nothing already recorded is lost." / "Not used by any language yet." (497).
     - "Create Flow" / "Save Flow". Toast "{name} saved".
  8. Back with unsaved changes opens the sheet "Leave without saving?" / "Your changes to this flow haven't been saved." with "Save Flow" and "Discard changes".
  9. Read-only without the privilege.
- **Target journey:** New flow → Peer Review → Alongside: Back Translation ("Together") → Add step: Community → Add step: Consultant + Checkpoint → Add step: Final Approval → Create Flow.
- **Ours FlowEditor** (m:src/screens/config.tsx:323-388):
  - Role stages with any/majority/unanimous and a required toggle. "New stage name" creates a reviewer stage.
  - An empty flow cannot be saved (349).
  - No reorder, name, description, kinds, checkpoint, leave guard or "Used by". Edits apply to one lane only.
- **Changes:**
  - Rewrite FlowEditor to the reference model: a flowId param, per-step registers, fractional order keys (a reorder writes only the moved step).
  - Save emits, in the org partition: ReviewFlowDefined + v2.WorkflowStepSet + removals + ReviewKindDefined for new kinds.
  - Remove the quorum UI (legacy steps keep folding). Update screenContracts.
- **Data:** the new facts from J-CFG-2. LaneFlowSelected can name an org flowId; catalogVersion is ignored.

### J-CFG-4 An admin marks a step as a checkpoint, and someone overrides it
- [ ] **Persona:** the flow designer; a coordinator with Override Checkpoints.
- **Reference:**
  - The toggle is in the flow editor.
  - The privilege "Override Checkpoints": "Move a passage past a checkpoint, with the reason logged" (ref:src/data.ts:140,158).
  - The record gates override on it (ref:src/App.tsx:1407).
  - Status shows a lock on checkpoint rows (ref:src/screens/map.tsx:28).
- **Ours:** none. `WorkflowStep.required` is an approval gate, not a checkpoint (core:events.ts:20-29).
- **Changes:**
  - Add `override_checkpoints` to PRIVILEGES and MANAGE_PRIVILEGES (core:org.ts:24-45), plus EVENT_PRIVILEGE and SQL event_privilege.
  - Add the toggle to the role editor.
  - Enforce by derivation, not refusal (PLAN 16.1 rule 6).
- **Data:** checkpoint on v2.WorkflowStepSet; `v1.StepOverridden` and `v1.StepSetAside` (PLAN 16). Give the privilege to the org admin seed role for new orgs.

### J-CFG-5 Back translation appears as a producing kind in a flow
- [ ] **Persona:** the flow designer.
- **Reference:** there is no UI to mark a kind as producing.
  - `produces` is seed data on Back Translation: `{what:"back translation", into:"English", action:"Back-translate it", checkedBy:"consultant"}` with `withholdsContext:true` (ref:src/data.ts:250-275).
  - Picker-created kinds are plain checks (ref:src/screens/config.tsx:559).
  - The effects show elsewhere:
    - "Back-translate it" opens the recording screen (ADR-015, ref:src/App.tsx:471,1542-1568).
    - The record says "Back Translation · recorded" (ref:src/data.ts:404).
    - The consultant sees "Back translation to compare" (ref:src/screens/review.tsx:64,112).
    - The highlight reads "Back-translate {passage}" (ref:src/domain/record.ts:207-208).
- **Ours:** back translation is an OBT stage (core:catalog.ts:150), with source-free workspace delivery in obt_manage (m:src/screens/obtManage.tsx:46-61).
- **Changes:**
  - Seed the kinds, BT included (produces + withholdsContext), through ReviewKindDefined at org creation, next to SEED_ROLES (m:src/screens/entry.tsx:236).
  - Optionally add a "makes a recording" icon+text marker on chips and in the picker. This is not in the reference: ask first.
  - Do not add a produces toggle unless asked.
  - Keep our source-free isolation as the implementation of withholdsContext (record and work domains).
- **Data:** `v1.ReviewKindDefined` and `v1.ContentProduced {takeId, fromTakeId, kindId, language}` (PLAN 16).

### J-CFG-6 An admin adds a new review kind
- [ ] **Persona:** manage_flows.
- **Reference:** only from the picker: "New kind — e.g. Elder Review" → Add. It gets icon chat, "Anyone the team chooses" and "Defined by your organization.", and is saved with the flow (ref:src/App.tsx:1840-1844).
- **Ours:** none.
- **Changes:** part of the J-CFG-3 picker.
- **Data:** ReviewKindDefined in the org partition, gated by manage_flows.

### J-CFG-7 An admin browses and edits the reference library by level
- [ ] **Persona:** manage_reference. Anyone with fill_reference for unlocked material.
- **Reference reference_home** (ref:src/screens/config.tsx:573-679; ref:src/App.tsx:1848-1861):
  - Header "Reference Material", sub = level.
  - Intro: "Context lives at the level it holds and adds up — nothing is copied. Translators see it in the workspace tray; reviewers see the questions for their kind of review."
  - "Key Terms": "{n} concepts · a rendering per language".
  - "Study material · n": "{pattern} study guide · n steps · {passage}". Empty: "No study material for this view."
  - "Review questions · n": "{Kind} · n questions · {source}". Note: "Question sets for the same kind add up: a reviewer sees the organization's, the project's, and the language team's together, labelled by source."
  - "General · {Level} · n". Empty: "No general materials at this level yet."
  - "Expand by" (By project / By language), "From higher levels · available here", "Locked" badge.
- **Reference material_editor** (ref:src/screens/review.tsx:402-485):
  - Header with a lock toggle, "Locked"/"Unlocked".
  - "Updated {date} · by {who} · questions for {kind} · {passage}". "{n} unfilled blanks".
  - Guide summary:
    - "Study guide · {pattern} · n steps" + "{source}. Each step is one document with its audio; the app breaks the text into parts people can note. What teams add stays with their passage, not here."
    - Step cards: "{phase} · n parts · n stops for discussion", "Audio file"/"No audio yet". Plus "Linked from the text".
  - Questions: "1–5" / "Yes / No" / "Text" + "Required".
  - "Save Changes", disabled when locked.
- **Ours:**
  - ReferenceHome (m:src/screens/config.tsx:122-166): Source Bible settings, FIA setup, key terms, General, question sets with "Add … from the catalog", legacy notes. Lane level only. "Add material".
  - MaterialEditor (m:src/screens/review.tsx:170-265): raw field ids, a lock row, title "Fill reference" (flow.ts:304).
- **Changes:**
  - Adopt the reference sections. Keep Source Bible as a deliberate extension (PLAN 16's orange folder).
  - Question sets by kind. Rename to "Edit material". Lock in the header. Guide summaries, type and required.
  - "Add material" is our extension (ADR-018 says authoring is not in the demo). Flag it.
- **Data:** MaterialDefined, FieldSet and Locked are supported. New facts:
  - Project or org home: MaterialScope has only lane/unit/step. Use PLAN 16 `v1.ContextItemAdded`, or `v1.MaterialHomeSet`. Org material belongs in the org partition.
  - Question set tied to a kind: `v1.QuestionSetKindLinked` (legacy StepQuestionSetLinked keeps folding).
  - Question type and required: `v1.QuestionSpecSet`.

### J-CFG-8 Someone browses key terms and adds a term with its rendering
- [ ] **Persona:** a translator (fill_reference) from the workspace; an admin from the library.
- **Reference key_terms** (ref:src/screens/config.tsx:685-758):
  - Header "Key Terms", sub = context or "{lang} renderings". Header action "New term".
  - Search: "Search terms".
  - "In this passage · n", then "Other terms · n" or "All terms · n".
  - Row: term, a badge (FIA / source / "Project"), and the rendering, or amber "No {lang} rendering yet".
  - Footer: "Concepts come from your organization's list (like FIA key terms) or your project. Each language keeps its own renderings and the reasons behind them."
  - Sheet "New key term" / "Added to your project's list. Other languages can add their own renderings." Fields:
    - "Source term — e.g. grace (charis)"
    - "Meaning, briefly"
    - "{lang} rendering"
    - "When to use it, and why"
  - "Add Term" needs term and rendering (760-781).
- **Ours KeyTerms** (m:src/screens/config.tsx:169-205): an inline term + gloss form. No search, no badge, no rendering at add time.
- **Changes:** search, badge, the sheet with a rendering field. On add, emit KeyTermDefined + KeyTermRenderingAdded + KeyTermAdjusted("Added with rendering “…”", ref:src/App.tsx:755-770).
- **Data:** KeyTermDefined is lane-scoped. The reference has the concept at org or project with a rendering per language (ref:src/data.ts:529-543). New facts:
  - Concept home: `v1.ContextItemAdded` (kind key_term), or `v2.KeyTermDefined {termId, home, projectId?, source}`.
  - `v1.KeyTermRenderingSet {termId, languageId, rendering, versionId?, noteTakeId?}` (PLAN 16).
  - Legacy lane terms read as lane-homed concepts.

### J-CFG-9 Someone opens a key term
- [ ] **Persona:** translator, reviewer, admin.
- **Reference key_term_detail** (ref:src/screens/config.tsx:785-921):
  - Sub: "{FIA key term|source} · shared across the organization" or "{source} · project term".
  - A gloss card + "Appears in {books}".
  - FIA GlossaryCard: "FIA Master Glossary", hint, "Listen to “{term}”", "Read the whole entry (n paragraphs)", "Try together:", media.
  - Tie card: "Tie to your draft" / "Tied to your draft", with "So reviewers know this term shaped {ctx}." / "Reviewers will see this term and your reasoning. Tap to untie."
  - "In {lang}": renderings, or amber "No rendering yet" / "Add how {lang} says this, and when to use it."
  - Ghost button "Adjust or add a rendering" opens a sheet:
    - Title "{lang} · “{term}”". Sub "Every change is recorded with your reason."
    - Fields: "New rendering (optional)", "When to use it", voice "Say why", "Or type what changed, and why".
    - "Save".
  - Details disclosures: "Why it's rendered this way" ("n changes · latest by {who}, {when}"), "Where it's used" (→ version_detail), "Other languages".
- **Ours KeyTermDetail** (m:src/screens/config.tsx:208-271): inline Renderings and Adjustments inputs, "Linked translations" → piece_version, "Tie to this translation". No untie, no voice, no glossary, no other languages, no disclosures.
- **Changes:** restructure as listed. Voice uses KeyTermAdjusted.blobHash (supported). The edge key_term_detail→piece_version exists (flow.ts:257).
- **Data:**
  - Untie needs a new fact (`v1.KeyTermUnlinked`).
  - "Other languages" needs the cross-lane concept from J-CFG-8. Interim: group lane terms by normalized term text, marked as a suggestion (principle 8).

### J-VIEW-1 A viewer checks progress across languages
- [ ] **Persona:** org, project or language viewer (View Status only).
- **Reference status_home** ("All Languages", screen title "Progress"; ref:src/screens/map.tsx:40-126; ref:src/App.tsx:1332-1352):
  - Sub "{org} · {All languages|project|language}" (viewScopeFor ref:src/App.tsx:258-266).
  - Summary card: "Across n languages · n passages", "x% recorded", "y% done", "n with reviewers", stacked bar.
  - "Find a language" when there are more than 5.
  - Grouped by project. Language card: code tile, name, "{canon scope} · {flowName}", clock badge with the waiting count.
  - FunnelRows: Recorded, each step "n of N" (lock on checkpoints), Done (16-38).
  - Footnote: "Each bar counts passages that have cleared that step of the language's review flow. A passage is done when every step is complete — or, with no flow, once it's recorded."
  - Tap → map_home, read-only. There is no assign action.
- **Ours StatusHome** (m:src/screens/status.tsx:25-55):
  - "Status", sub "Read-only overview of language progress." Rows show "{n} pieces · {bottleneck}" and a % badge.
  - Admins get "Give assignment". Drill language_status → book_status → piece_status.
- **Gaps:** ADR-004 drops the % and bottleneck. Scope grouping, waiting count and search are missing. Assign is not here in the reference.
- **Changes:**
  - Rewrite as "Progress" with the funnel (our tokens + lock icon). Tap → map.
  - Remove "Give assignment" and the edge status_home→give_assignment (flow.ts:170).
  - Keep the old drill-down until the map port lands.
- **Data:** all derived, no new event.
  - cleared per step = `deriveTakeStatus().steps[i].outcome === 'passed'` (v1), or v2 completeness.
  - waiting = open reviewer AssignmentMade with no ReviewSubmitted.
  - Other projects need a projection.

## 2. Screen-id mapping: reference → ours → action

| Reference | Ours | Action |
|---|---|---|
| org_home | OrgHome org.tsx:77 | Progress, empty copy, catalog rows/folders, correct counts. Becomes the Manage-tab root. |
| new_project | 3-step wizard org.tsx:353 | Name + description only. Move template/reference/assign out. |
| project_home | org.tsx:98 | Progress, flow+counts rows, catalog. Fix the 'org1' crumb. Drop the Status row. |
| new_language | org.tsx:522 | Name + code, hint, toast, default template and flow. |
| language_home | org.tsx:121 | Keep folders. Add header line, progress, "Passage map" card. Drop "Open status". |
| review_teams | org.tsx:538 | Multi-team list, intro, empty state. Remove the flow_editor row. |
| review_team_editor | org.tsx:566 | Eligibility filter, delete + undo. Remove the step rewrite. |
| members_list | org.tsx:150 | Org memberships by level, expanders, higher levels. Keep a legacy group. |
| invite_member | org.tsx:217 | Email + role + assignment scope + QR card. |
| invite_qr | org.tsx:235 | Role / Name / QR stepper, "Create a new role". Keep the token and share. |
| edit_member | org.tsx:307 | The invite form. Scope change. "Assign Role" mode. |
| roles_home | config.tsx:16 | Sections by level, intro, counts. |
| role_editor | config.tsx:31 | Labels + descriptions, members, banners. |
| templates_home | config.tsx:73 | AppliedCatalogScreen per level, Use/In use, Undo. Drop the dynamic_bible row. |
| reference_home | config.tsx:122 | Reference sections, question sets by kind. Keep Source Bible. |
| material_editor ("Edit Material") | review.tsx:170 ("Fill reference") | Rename. Lock in header. Guide summaries, question type and required. |
| key_terms | config.tsx:169 | Search, badge, "New term" sheet with rendering. |
| key_term_detail | config.tsx:208 | Gloss, glossary, tie/untie, "In {lang}", adjust sheet with voice, 3 disclosures. |
| flows_home | config.tsx:274 | AppliedCatalogScreen + FlowStepsInline, the six flows. Drop the obt_manage branch. |
| flow_editor | config.tsx:323 ("Edit stages") | Rewrite: kinds, Together, checkpoint, Collect only, picker, leave guard. |
| (none; Spoken is a flow) | obt_manage obtManage.tsx:15 | Remove from the flows journey. Keep it only for legacy OBT lanes via obt_passage. |
| status_home ("Progress") | status.tsx:25 ("Status") | Per-step funnel. Tap → map. No assign. |
| map_home / book_map / passage_record | language_status / book_status / piece_status | Map domain (superseded). |
| version_detail | piece_version | Record domain. Remap key_term_detail edge. |
| my_work | assignments_home | Work domain. Admins land here. |
| inbox_home→edit_member | exists (gate assigner) | Change the gate to invite_members. |
| (none) | give_assignment, piece_assign, pickup_home, progress_home, assignment_progress_detail | Superseded by "Ask someone" (ADR-007/020). Other domain. |

**Edge edits in m:src/flow.ts:**
- **Add:**
  - org_home and project_home → templates_home, reference_home, flows_home (gated manageTemplates, manageReference, manageFlows).
  - language_home→map_home (or the interim map screen).
  - key_term_detail→(the version screen).
- **Remove:**
  - home_hub→org_home, project_home, language_home (122-124).
  - templates_home→dynamic_bible (95).
  - flows_home→obt_manage (139).
  - review_teams→flow_editor (260).
  - project_home→status_home (221), language_home→status_home (231).
  - status_home→give_assignment (170).
- **New gates:**
  - `inviter` (invite_members) on members_list→invite_member, members_list→edit_member, inbox_home→edit_member, role_editor→edit_member.
  - `structure` (manage_structure) on org_home→new_project and project_home→new_language.
  - `teams` (manage_teams) on review_teams→review_team_editor.
  - Add each to Gate (flow.ts:74-77) and edgeAllowed (session.ts:90-103).
- **Titles:** material_editor "Edit material"; flow_editor "Review flow"; status_home "Progress"; reference_home "Reference material".
- **Also update:** m:test/spec-flow.json, m:test/specParity.test.ts, m:src/screenContracts.ts.

## 3. Role and privilege model diff

**Catalog** (ref:src/data.ts:131-164 vs core:org.ts:24-38):
- These map 1:1 by label:
  - Manage Org Structure = manage_structure
  - Invite Members = invite_members
  - Manage Roles = manage_roles
  - Manage Content Templates = manage_templates
  - Manage Reference Material = manage_reference
  - Manage Review Flows = manage_flows (also gates ReviewKindDefined, ReviewFlowDefined, v2.WorkflowStepSet)
  - Manage Review Teams = manage_teams
  - Assign Work = assign_work
  - Translate = translate
  - Fill Reference Content = fill_reference
  - Ask for Reviews = send_to_reviewers (keep the id, which is shipped in RoleDefined payloads; label "Ask for reviews")
  - Review = review
  - View Status = view_status
- **Missing:** Override Checkpoints, "Move a passage past a checkpoint, with the reason logged". Append `override_checkpoints` to PRIVILEGES and MANAGE_PRIVILEGES, add it to SQL event_privilege, and give it to the seed roles of new orgs.
- Add a mobile label map with the PRIVILEGE_DESC strings verbatim. Today we show raw ids (config.tsx:61).

**MANAGE and WORK privilege sets:**
- The reference MANAGE set includes Override Checkpoints; ours does not.
- The reference WORK set includes Ask for Reviews. Our isWorker is translate, review, fill_reference (m:src/session.ts:64). Add send_to_reviewers.

**Seed roles:**
- Reference: 14 roles (ref:src/data.ts:1075-1090).
  - A Translator holds Translate + Fill Ref + Ask + Review + View, so it can peer-review.
  - Reviewer roles hold Fill Ref + Review + View.
  - Also: Team Leader (with Override), Consultant (review only), Observer (View Status), and TBD roles with no privileges.
- Ours: 5 (core:org.ts:178-187).
  - Translator has no review.
  - Reviewer has no fill_reference.
- Changing privilegesOfFixedRole widens permissions on old data, so it needs the user's approval. Recommendation: add the missing reference roles as extra seed roles for new orgs and leave the five fixed mappings alone.

**Role shape:**
- The reference has description, definedAt, isCustom and memberCount. memberCount and isCustom are derivable. Description and definedAt need a new fact (`v1.RoleDescribed`).
- Port the scope helpers as pure derivations over OrgState, with language = lane: roleVisibleAt, canManageRolesAt, roleIsEditableAt, inviteableRoles, memberIsEditableAt, grantScopeAt, assignableScopes (ref:src/data.ts:1018-1052).

**Session:**
- Facets: ours (m:src/session.ts:51-83) is a superset of ref makeSession (ref:src/domain/session.ts:31-50). Keep it, and add send_to_reviewers to isWorker.
- Home and tabs change as in J-ORG-0.
- The reference gate set adds `contributor` (Translate or Review) and `asker` (Ask for Reviews or Assign Work) (ref:src/flow.ts:120-123; ref:src/domain/session.ts:261-275). The record domain needs these. This domain needs inviter, structure and teams.
- Catalog editing: port canManageCatalog = can(p) AND adminScope rank ≤ view level (ref:src/App.tsx:961-963). Today our folders only check can(p) (m:src/screens/org.tsx:127).
- Member edits: port memberIsEditableAt. **Verify the server SQL checks scope rank, not just the privilege.** A lane admin must not be able to add an org-scope membership.
- Join requests: both use invite_members. In the reference they appear in Inbox; in ours, on members_list.

## 4. New facts (names only; each needs reducer cases + permutation/idempotence fixtures)

From PLAN 16:
- v1.ReviewKindDefined
- v2.WorkflowStepSet — **add a flowId or laneId owner key before shipping**
- v1.StepSetAside
- v1.StepOverridden
- v1.DepartureUndone
- v1.ContentProduced
- v1.ContextItemAdded / Anchored / Hidden
- v1.KeyTermRenderingSet

Added by this analysis:
- v1.ReviewFlowDefined
- v1.ProjectDescribed
- v1.LaneNamed
- v1.InviteRevoked
- v1.InviteNamed
- v1.RoleDescribed
- v1.ReviewTeamRetired
- v1.ReviewTeamKindSet (optional)
- v1.QuestionSetKindLinked
- v1.QuestionSpecSet
- v1.KeyTermUnlinked
- v1.MaterialHomeSet (or fold into ContextItemAdded)

Also add the new privilege `override_checkpoints`, and EVENT_PRIVILEGE plus SQL rows for every new event.

No new event is needed for: the Manage tab, progress counts, the status funnel, template or flow Undo (re-select), invite scope (already in InviteIssued), or member scope change (remove + add).