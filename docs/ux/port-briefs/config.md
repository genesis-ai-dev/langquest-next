# Brief: roles, reference, key terms, review flows

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/config.tsx`: `RolesHome`, `RoleEditor`, `ReferenceHome`, `MaterialEditor`, `KeyTerms`, `KeyTermDetail`, `FlowsHome`, `FlowEditor` (exists on the old spec; rework). `TemplatesHome` moves to content.tsx: delete it from config.tsx.

## Demo sources
`src/screens/config.tsx`. Requirements ORG-3, ORG-4, ORG-8, TERM-1..6, FLOW-1..4. ADR-002, ADR-004, ADR-005, ADR-016.

## Build
- Roles: named permission sets with the full catalog and descriptions (core `PRIVILEGES` incl. `override_checkpoints`, `shape_templates`); lower levels see inherited roles view-only; "Invite someone as {role}" -> `invite_qr`.
- Reference library and MaterialEditor: study guides, question sets by review kind (materials of kind `questions` with `scope.stepId` = kindId; question text stored with core `formatQuestionField`, read with `parseQuestionField`; required or suggested), other materials; lock. Restore the old material editor's behaviour (`git show main:apps/mobile/src/screens/review.tsx`, `MaterialEditor`) in the new look.
- KeyTerms (search, "In this passage" when opened with unitId, renderings or "No rendering yet", FIA labelled) and KeyTermDetail (meaning, renderings, adjust or add a rendering with a required why by text or voice, where it's used -> `version_detail`).
- FlowsHome: core `FLOWS` with descriptions and steps, which languages use which (`deriveFlow`), "Use" / "In use" per language -> `ctx.act(commands(...).useFlow(...))` with Undo restoring the previous steps (`saveFlowSteps` with the old steps).
- FlowEditor (params laneId): steps with parallel kinds, reorder, remove, add a kind to a step or alongside, checkpoint toggle, add a new kind (`defineKind`), warn before leaving with unsaved changes, say which language uses it; save -> `saveFlowSteps`. Never emit `v1.WorkflowStepSet` (v1) any more.
