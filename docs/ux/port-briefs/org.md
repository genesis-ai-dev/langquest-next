# Brief: running the organization

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/org.tsx`: `OrgHome`, `ProjectHome`, `LanguageHome`, `NewProject`, `NewLanguage`, `MembersList`, `InviteMember`, `InviteQr`, `EditMember`, `ReviewTeams`, `ReviewTeamEditor` (exists on the old spec; rework to the demo's flow and look, keep the working invite and RPC logic)

## Demo sources
`src/screens/org.tsx`. Requirements ORG-1..7, NAV-6, FLOW-5. ADR-017, ADR-025.

## Build
- Homes (org › project › language) with breadcrumbs: progress (recorded, done from core `languageProgress`), children, and the management rows permitted at that level: Manage Content (Content Templates, Reference Material), Manage Processes (Review Flows, Review Teams), Manage Members (Roles, Members). Language home also opens its Passage map (`map_home`).
- NewProject (name, description). NewLanguage: name, code, scope; emits `v1.LaneAdded`, `v1.LaneNamed`, and the template selection the old screen did; the language name shows everywhere via core `laneName`.
- Members grouped by level with higher-level members view-only and pending first; InviteMember (email: role and scope limited to the inviter's scope); InviteQr (role, then name, then a code to show; existing `issue_invite`); EditMember; ReviewTeams and editor (named groups of reviewers per language).
