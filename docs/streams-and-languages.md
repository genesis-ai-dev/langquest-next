# Streams and languages: the plan

Status: accepted, 2026-10-06 (Carl Sauder): decision 63, which also replaces
the parts of decisions 23, 25, 32, 34, 37 and 62 listed at the end of this
document.

The app's central model still carries two levels that no longer exist.

- **The project.** Decision 34 took it out of the app, and decision 37 made
  each language its own synced partition. The code still names it
  everywhere: `projectId` on every event, `project_id` in every table,
  `ProjectState`, `v1.ProjectCreated`, `ctx.project`, the `project` scope
  level. Meanwhile some SQL and the docs call the same thing a partition
  (`partition_cursors`, `can_read_partition`).
- **The lane.** A target language inside a project partition. Since
  decision 37 every work partition holds exactly one lane, and the two share
  an id.

So most of the code pays for distinctions that never vary. Where they do
vary, TypeScript and SQL disagree about what they mean. This plan replaces
the project, the work partition and the lane with one concept, the language,
and names the sync unit the stream. While the databases are being reset
anyway, it also takes the event catalog down to one version of each event.

## 1. Concepts

**Organization.** A group that translates together.
- It holds its roles, memberships, invites, join decisions, license and
  library: templates, flows, materials and versifications.
- It also holds the list of its languages and what defines each one: name,
  language code, source language, country and target. Every member sees all
  of this without pulling any language's work.
- One stream: the organization stream.

**Language.** One organization's translation into one target language. It is
the unit of work, sync and permission below the organization.
- It uses exactly one template and one flow, as in the partner demo
  (`LanguageSetup`).
- Its stream holds the work: the template choice and the passages made from
  it, the flow choice and its steps, review teams, recordings, takes,
  reviews, requests, notes, departures, key terms, materials and study marks.
- One stream: the language stream. Its id is the language id.

**Person.** A profile, which has a small stream of its own: terms accepted,
intro seen, walkthrough done. Only that person writes to it.

**Stream.** The unit of sync: an append-only event log with its own server
sequence, cursor, snapshots and blob folder.
- There are exactly three kinds: organization, language and person.
- "Stream" is the sync layer's word and stays there. Domain code says
  organization, language or person, never stream.
- Nobody says partition, lane or project anywhere.

**Membership.** A person holds a role at a scope.
- There are two scopes: `{ level: 'org' }` and
  `{ level: 'language', languageId }`.
- An org scope covers every language.
- A person holds at most one role per scope: one for the organization and
  one per language.
- Their privileges for a language are the union of their org role, if it
  exists, and their role in that language, if it exists.
- With no language given, only org scope counts. This applies the same way
  in TypeScript and in SQL.

**Settings.** There are two shared levels, plus each person's own choices.
- **Organization.** Its library holds templates, flows and materials,
  question sets among them. The organization recommends library items to
  every language (`ReferenceRecommended`, decision 62). Anything meant for
  all of an organization's languages is a library item it recommends, never
  something copied into a language.
- **Language.** A language picks one template and one flow; its steps, teams
  and its own materials sit under those. It narrows or adds to the
  organization's recommendations (recommend, hide, or follow the
  organization), and an admin can place an item on one passage by hand.
- **Person.** Each translator picks which recommended Bibles they read
  (decision 62). Today this lives only on the device; section 8 asks whether
  it moves to the person stream.
- No project-wide layer exists in between. On `main` the only live part of
  that layer is the "All languages" material and the question sets copied in
  by "Use in reviews". Since decision 37 they land in whichever language was
  open, so they already reach only that language. Under this plan they become
  recommended library items.

## 2. Rules

1. Every work event belongs to exactly one language: the one whose stream it
   is appended to. Commands produce payloads without a language id; opening
   a language decides which stream they go to.
2. A language stream accepts events only after the organization stream lists
   that language (`LanguageAdded`), and from its first event the normal
   membership checks apply. This replaces today's special cases for a
   project partition that has no members yet: its first event is let in
   under a bootstrap rule, and anyone may read it while it is empty.
3. A language's identity has one home, the organization stream. Today the
   name alone is written in up to four places.
4. Who is in a language comes from the organization: org-scope and
   language-scope memberships. A language stream has no member list of its
   own.
5. Ids and keys inside a language stream no longer include the lane. On
   `main` several are built with the lane id in them, so that languages
   sharing one partition could not collide. Each language now has a stream of
   its own, so nothing in it can collide with another language's:

   | What | Today | After |
   | --- | --- | --- |
   | A study step marked done | `<unitId>:<laneId>:<guideId>:<stepId>` | `<unitId>:<guideId>:<stepId>` |
   | A flow step's id | `<laneId>/<flowId>@<v>/<step>` | `<flowId>/<step>` |
   | A hand-edited flow step's id | `<laneId>/custom/<step>` | `custom/<step>` |
   | The Translation Guidelines material's id | `tg:<laneId>` | `tg` |
6. You may grant a role, or issue an invite, only at a scope where you hold
   `invite_members`: at org scope, or at your own language. The server
   enforces this. Today the UI offers language admins things the server then
   refuses.
7. Events restart at `v1`. Nothing shipped survives the reset, so no event is
   kept for compatibility.

## 3. Event catalog

### Organization stream

| Event | Payload | Merge |
| --- | --- | --- |
| `v1.OrgCreated` | name | register |
| `v1.RoleDefined` / `v1.RoleRetired` | roleId, name, privileges / roleId | register per role |
| `v1.MemberAdded` / `v1.MemberRemoved` | profileId, roleId, scope / profileId, scope | register per (profile, scope) |
| `v1.InviteIssued` / `v1.InviteRedeemed` | inviteId, roleId, scope, expiresAt / inviteId, profileId | as today |
| `v1.JoinDecided` | requestId, profileId, accepted | latest wins |
| `v1.LicenseSet` | license | only opens (decision 38) |
| `v1.LanguageAdded` | languageId, name, code, sourceCode | earliest wins; `sourceCode` is the language source Bibles are offered in (`eng` today), which the sources and reference screens read |
| `v1.LanguageRenamed` | languageId, name | register |
| `v1.LanguageCountrySet` | languageId, country | register |
| `v1.LanguageTargetSet` | languageId, scope, startDate, targetDate | register |
| `v1.ReferenceRecommended` | itemId, recommended | register per item (decision 62) |
| `v1.LibraryItemDefined`, `…VersionPublished`, `…SharingSet`, `…ItemArchived`, `…Subscribed`, `…Pinned` | as today | as today |
| `v1.Redacted` | eventId, reason? | grow-only |

`OrgMemberAdded`/`OrgMemberRemoved` take the plain names, since the old
project-level `MemberAdded` events are gone. A language-level event in this
stream, such as `LanguageRenamed` or a membership at language scope, is
authorized by the actor's privileges for that language.

### Language stream

| Event | Payload | Replaces |
| --- | --- | --- |
| `v1.TemplateSelected` | itemId, docHash, unitPrefix, books? | `v2.LaneTemplateSelected` (v1 dropped) |
| `v1.UnitAdded` | unitId, parentUnitId, kind, label, order | unchanged |
| `v1.UnitHidden` | unitId, hidden | `v1.LaneUnitHidden` |
| `v1.FlowSelected` | flowId, itemId?, docHash?, name? | `v2.LaneFlowSelected`; `restoreFlow` is ported off v1 |
| `v1.FlowStepSet` / `v1.FlowStepRemoved` | stepId, order, kindIds, checkpoint / stepId | `v2.WorkflowStepSet`, `v1.WorkflowStepRemoved` |
| `v1.ReviewKindDefined` | as today | unchanged |
| `v1.ReviewTeamDefined` / `…MemberSet` / `…KindSet` | teamId, name / teamId, profileId, member / teamId, kindId | laneId dropped |
| `v1.RecordingAdded` | recordingId, unitId, kind, cards | laneId dropped |
| `v1.TakeComposed` / `v1.TakeArchived` | takeId, unitId, cardHashes, parentTakeId / takeId | laneId dropped |
| `v1.TakeSubmitted` | takeId, questionSetIds? | unchanged |
| `v1.ResponseRecorded` | as today | unchanged |
| `v1.ReviewRecorded` | as today | replaces `v1.ReviewSubmitted` |
| `v1.DepartureRecorded` / `…Undone` | laneId dropped | |
| `v1.RequestMade` / `…Withdrawn` | v2 payload (teamId?), laneId dropped | merges v1 and v2 |
| `v1.NoteAdded` | laneId dropped | |
| `v1.StudyStepMarked` | unitId, guideId, stepId, done | laneId dropped |
| `v1.MaterialDefined` / `…FieldSet` / `…Locked` | scope {unitId?, stepId?} | `scope.laneId` dropped |
| `v1.KeyTermDefined`, `…RenderingAdded`, `…Adjusted`, `…Linked` | laneId dropped | |
| `v1.ReferenceSet` | itemId, state (`recommended` \| `hidden` \| `inherit`) | `v1.LaneReferenceRecommended`; register per item |
| `v1.PassageReferenceLinked` | unitId, itemId, linked | laneId dropped; register per (passage, item) |
| `v1.ReferencesUsed` | unitId, takeId? \| reviewId?, items | laneId dropped; grow-only |
| `v1.BlobStored` / `v1.BlobInvalidated` | as today, server only | |
| `v1.Redacted` | eventId, reason? | |

These are dropped and have no replacement:
- `ProjectCreated`, `ProjectConfigChanged`, `ProjectRegistered`.
- The project-level `MemberAdded`, `MemberRoleChanged` and `MemberRemoved`.
- `LaneAdded`, plus `LaneNamed`, `LaneCountrySet` and `LaneTargetSet`, which
  move to the organization stream.
- `SourceImported`, `AssignmentMade`, `ReviewSubmitted`, `TakeSelected`,
  `ReviewCommentRecorded` and `StepQuestionSetLinked`. Nothing read a
  selected take: a passage's current version is its latest submitted take.
- `CatalogItemToggled`. Nothing on `main` writes it, and nothing calls
  `catalogEnabled` or `sourceBibleEnabled`, since decision 62 replaced the
  source-Bible opt-in it served with recommendations. `catalogKey`,
  `catalogEnabled` and `sourceBibles.ts`' toggle go with it.
- The v1 `LaneTemplateSelected`, `LaneFlowSelected` and `WorkflowStepSet`.

`ReferenceAttached` was written only by the v2 importer, which now writes a
v2 project's source content as a material (`v2src:<asset>`) instead.

### Person stream

`v1.TermsAccepted`, `v1.VisionSeen` and `v1.WalkthroughDone`, unchanged. The
stream's org id is `_person` (today `_user`).

## 4. Envelope and storage

**Envelope.** `{ id, type, orgId, streamId, actorId, deviceId, hlc,
parentEventId?, payload, serverSeq? }`. The `streamId` is one of:
- `_org` for an organization stream
- the language id for a language stream
- the profile id, under org `_person`, for a person stream

**Which id where.** `stream_id` and `language_id` hold the same value for a
language stream, but they answer different questions, and the difference is
what else each may hold.

- `stream_id` (`streamId`) answers "which log does this belong to?" It can
  be any of the three streams: `_org`, a language id, or a profile id. Only
  sync machinery uses it, and none of that code cares what kind of stream it
  has:
  - server: `events`, `snapshots`, `stream_cursors`, the blob folder, the
    realtime channel, `diag.records`
  - device: the `events` and `cursors` tables
  - code: `SyncClient`, `EventStore`, `Transport`
- `language_id` (`languageId`) answers "which language is this about?" It
  only ever holds a language, never `_org` or a profile id. Everything that
  deals with languages as things uses it:
  - `languages`, membership scopes, `public_languages`
  - `notifications` and `content_reports`, where null means the organization
  - read models, reports, route params, the recording journal
  - the app's open-language handle
- Rule of thumb: if the value could be the organization or person stream,
  it is a `stream_id`. If it can only be a language, it is a `language_id`.
- They meet only at the edge between domain code and sync. Opening a
  language opens the stream whose id is that language id, and the
  organization stream is opened through `ORG_STREAM`. One or two functions
  convert; nothing else mixes the two, so a function that takes a
  `languageId` can never be handed `_org`.

**Postgres.** Every `project_id` column becomes `stream_id` (a sync table)
or `language_id` (a table about a language). The tables keyed by stream or
language, after the change:

| Table | Key | Notes |
| --- | --- | --- |
| `events` | `(org_id, stream_id, server_seq)` | today `project_id` |
| `snapshots` | `(org_id, stream_id, reducer_version, server_seq)` | today `project_id` |
| `stream_cursors` | `(org_id, stream_id)` | today `partition_cursors` |
| `languages` | `(org_id, language_id)` | **new**; folded from the organization stream. Holds name, code, source code, country, target and when it was added. Gates appends to a language stream, names invites, `my_organizations`, diagnostics and listings |
| `org_memberships` | `(org_id, profile_id, scope_key)` | `scope_level` is `org` or `language` (today `org`, `project`, `lane`); has `language_id`. The `memberships` table and `member_role` go |
| `public_languages`, `language_visibility` | `(org_id, language_id)` | today `public_projects`, `project_visibility`; one language per row; `languages[]` becomes `code` |
| `notifications` | — | `language_id`; null means an organization-level row |
| `content_reports` | — | `language_id`; null for a person |
| `diag.records` | — | `stream_id` |
| storage bucket | `<org>/<stream>/<hash>.<ext>` | |

Realtime channel: `events:<org>/<stream>`.

**Device (SQLite).**
- `events (org_id, stream_id, …)`, `cursors (org_id, stream_id)`.
- Read models keyed `(org_id, language_id, unit_id …)`; there is no
  `lane_id` column. `lane_counts` becomes `language_counts`.
- The store drops a database from before the change when it opens (one
  with a `project_id` column), since it belongs to the old server.

**Authorization (SQL and core, one definition).**
- `org_privileges(org, profile, language_id)`: org-scope roles, plus
  language-scope roles when `language_id` is given. Today it takes
  `(org, profile, project, lane)`.
- `may_emit`, by stream:
  - Language stream: the event's privilege against
    `org_privileges(org, actor, stream_id)`.
  - Organization stream: against the payload's `languageId` when the event
    names one, otherwise org scope.
- `can_read_stream` (today `can_read_partition`):
  - organization stream: any membership in the organization
  - language stream: any privilege for that language
  - person stream: the person themself
- `append_events` refuses an event in a language stream with no `languages`
  row.
- In core, `privilegesFor(org, profile, languageId?)` matches this exactly.
  `scopeCovers` loses its lane rules.

## 5. Phases

The work is one branch with one reset, in reviewable commits. Each phase
ends green on `npm test`, `npm run typecheck`, and from phase 3
`npm run db:test`.

**Phase 0. Write it down.**
- Add the decision entry and rewrite PLAN.md sections 3, 4 (invariant 6), 6, 7 and
  13 against this document.
- Replace the org-structure section of AGENTS.md.
- Update the `event-sourced-sync` skill.
- Add a vocabulary fitness test (`scripts/vocabulary.test.ts`): no
  `partition`, `lane` or `project` identifiers in `packages/*/src`,
  `apps/*/src`, `server` or `supabase/migrations`. Allow-list the Supabase
  and EAS "project" (refs, `langquest_project_url`) and the demo's screen
  ids. It is on since phase 7.

**Phase 1. Core: the two folds.**
1. Rename the envelope field `projectId` to `streamId`, and add
   `ORG_STREAM`/`PERSON_ORG`.
2. Organization fold:
   - `languages` registry (`LanguageAdded` earliest wins; rename, country
     and target registers).
   - Scope becomes `org | language`.
   - No catalog toggles; `ReferenceRecommended` stays as on `main`.
   - `languageMembers(org, languageId)` gives profile → effective role and
     privileges.
   - `privilegesFor` with org-only semantics when no language is given.
3. Delete `WORK_PARTITION`, `workPartitionOf`, `partitionOfLane`,
   `orgLanguages`' lane shape and `withOrgMembers` (`orgProject.ts`).
   `OrgState.projects` becomes the `languages` registry.
4. Language fold (`LanguageState`, today `ProjectState`):
   - Remove `project`, `config`, `members`, `lanes`, `laneNames`,
     `laneCountries`, `laneTargets` and `sourcePins`.
   - The `laneTemplates`, `laneFlows` and `laneHiddenUnits` maps become
     single values: `template`, `flow`, `hiddenUnits`.
   - `selectedTakes` and `studyMarks` are keyed without a lane.
   - Remove `laneId` from every payload type, from `validate.ts`, and from
     the reducer per the catalog above.
5. Retarget every derivation that took `(state, laneId)` to take the
   language state, plus the organization's people where it needs roles:
   - `passage.ts` `deriveFlow`, `usualTarget`, `questionsForKind`.
     A question's source becomes org (shipped, or a recommended library
     set), language or request; the `project` source goes.
   - `materials.ts`, `references.ts` (`recommendedFor`, `linkedTo`),
     `indexes.ts`, `readModels.ts`
   - `reports.ts` (`LanguageReport`; it reads country and target from the
     organization), `portfolio.ts`
   - `libraryApply.ts`, `record.ts` id builders, `commands.ts`
6. Rewrite the fixtures, and the order-independence and idempotence
   permutation tests, for both folds.

**Phase 2. Retire the v1 workflow model.**
- `deriveWorkflow`, `deriveTakeStatus`, `eligibleReviewers`, `tasks.ts`,
  `status.ts`, `blockers.ts`, `DEFAULT_CONFIG.workflow`, quorum rules and
  role-based steps still drive the local read models (`passage_rows`,
  `task_rows`), the inbox and blockers. They fall back to the default
  workflow even for languages on a library flow.
- Move each consumer onto the record model (`deriveFlow`, kinds,
  `ReviewRecorded`, `updatesFor`), then delete the v1 model, the old in-app
  catalog (`catalog.ts`/`catalogData.ts` paths with `catalogVersion < 2`), and
  `ReviewSubmitted`/`AssignmentMade` handling.
- This is the largest phase and the one most likely to surface behaviour
  someone relies on. Start it with a list of every screen that reads a v1
  derivation, and agree on the record-model equivalent for each before
  deleting anything.

**Phase 3. Server.**
1. Squash the migrations into one baseline (`supabase/migrations/<date>_baseline.sql`).
   - The reset makes this free.
   - It removes the `_validate_payload_before_*` / `_event_privilege_before_*`
     wrapper chains and the dropped `lane_reports`.
   - It is written from the final definitions, not concatenated.
2. Build the tables and functions in section 4:
   - `languages` fold in `_apply_org_event`
   - `org_privileges`, `may_emit`, `append_events` with the language gate
   - `can_read_stream`, plus `pull_events` and the snapshot RPCs on it
   - storage policies
3. Rework the invite and membership RPCs:
   - `issue_invite` checks the scope rule (rule 6) and that the language
     exists.
   - `preview_invite` names the language from `languages`.
   - `decide_join_request`, the stewards and `_delete_account` go to
     language scope.
4. Bring the remaining RPCs and functions onto language and stream keys:
   - `my_organizations`, `set_language_visibility` (today
     `set_project_visibility`), `report_content`,
     `_may_moderate`, `reconcile_notifications`
   - the `diag.*` functions, which no longer need their
     `lane_id = p_project` equality
5. Regenerate `validate_payload` and `event_privilege` against the new
   catalog, and keep `scripts/record-parity-sql.ts` green.
6. Add authorization parity cases: the same `(memberships, actor, language,
   event)` tuples through core and SQL.
7. Rewrite the smoke files (`server/*.sql`) for the new shapes.

**Phase 4. Client package.**
- `SyncClient`, `EventStore`, `Transport`, `MemoryStore`, `SqliteStore` and
  the SQLite read models move from `projectId` / `laneId` to `streamId` /
  `languageId`.
- Rename the meta keys, `snapshotWorker`, `blobReconciler` and diagnostics
  (`DiagRecord.streamId`).
- Add the stale-database check (section 4).

**Phase 5. Workers and importer.**
1. Projection worker:
   - per language stream: notifications, `public_languages`
   - per organization: join-request and report notifications (since
     decision 68 made by the database when they change; the pass refreshes
     an organization whose stream changed)
2. Web worker (`orgFolder`, `api.ts`): one summary per language; rows become
   `{ languageId, report }`; `mayViewLanguage`.
3. Rename the Edge Function `project-projections` to `stream-projections`,
   along with its cron job and `config.toml` entry.
4. v2 importer: one v2 project becomes one language. It refuses a project
   with more than one target language, which the team treats as an anomaly.
   `ReferenceAttached` is decided here.

**Phase 6. App.**
1. Language context:
   - `ctx.language` (the open language stream's handle, from
     `useLanguage`) replaces `ctx.project` (`useProject`), `ctx.laneId` and
     `ctx.setLane`.
   - Route param `languageId`; saved key `language:<actor>:<org>`.
   - `openLanguage` returns a language id or `null`.
   - An organization with no languages opens none, and Home offers New
     Language.
2. New Language:
   - `LanguageAdded` in the organization stream, then `TemplateSelected`,
     units and `FlowSelected` in the new language stream, which the server
     now accepts because the language is listed.
   - Renaming, country and target write to the organization stream.
3. Scopes and session:
   - Membership screens get two levels, Organization and the language;
     "All languages" goes.
   - `session.ts` derives role and privileges from organization memberships
     only.
4. Device data:
   - recording journal targets `{ orgId, languageId, unitId }`
   - draft keys, recent passages, report rows, moderation targets
5. Reports screens, `orgFigures` and `useOrgSummary` move to language rows.
   `flow.ts` and the parity test are unchanged.
6. Material for every language:
   - The material editor's "All languages" choice saves a library item and
     recommends it, instead of a material in the open language.
   - "Use in reviews" recommends the library question set instead of
     copying it into the open language.
   - The reference screens write `ReferenceSet` where they wrote
     `LaneReferenceRecommended`.

**Phase 7. Finish.**
- Turn the vocabulary test on.
- Run `npm run test:integration`, `npm run test:web` with a seeded library,
  and the Maestro run on both platforms (`run-app` skill).
- Rewrite `docs/ux/demo-parity.md` and `server/README.md`.
- Check `docs/play-store-declarations.md`: no answer is expected to change.

## 6. Rollout

1. Merge to `main` only when the team is ready to reset.
2. Reset the hosted database (it gets the new baseline), then seed the
   library.
3. Delete the old `project-projections` Edge Function.
4. Ship a native build to every phone; a phone drops its old database when it
   opens.
5. Nothing has to be migrated, because nothing outside the team holds data.

## 7. Decisions this changes

The new decision records this document. It:
- **Supersedes** 25 (per-lane settings layered over project settings) and
  34 (the organization as one unit that syncs).
- **Amends:**
  - 23: scope is `org | language`.
  - 32: steps are namespaced by flow version, not by language; the add-wins
    reason still holds.
  - 37: identity lives in the organization stream, the gate replaces the
    bootstrap rule, and `LanguageAdded` replaces `ProjectRegistered`.
  - 62: the three recommendation levels stand, and the language level
    becomes `ReferenceSet`. Material and question sets meant for every
    language are recommended library items rather than copies.
- Records that the code no longer says project, partition or lane, and that
  the databases were reset to get there.
- Changes PLAN.md invariant 6, which becomes "streams are self-contained".

## 8. Open points for implementation

These don't change the concepts.
- Whether `LanguageAdded.code` can change later (a `LanguageCodeSet`), or a
  wrong code means a new language.
- Whether a language admin may rename their language, or only an
  organization admin. The draft rule is: anyone with `manage_structure` for
  that language.
- Whether the person stream gets a pull path, or stays RPC-only as today.
- Whether a translator's own Bible choices (device-only today, under
  `my-bibles:<actor>:<org>:<language>`) move to the person stream so they
  follow the person to another phone. That needs the pull path above.
- "Use in reviews" on a library question set still copies the set into the
  open language as a material, instead of recommending the library item.
  `questionsForKind` reads only the language's own materials, so a
  recommendation would reach reviewers only once it is also given the
  recommended question-set documents (fetched by hash) and the review
  screens pass them. Until then a set meant for every language has to be
  used in each language.
