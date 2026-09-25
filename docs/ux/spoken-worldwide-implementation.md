# Spoken Worldwide implementation and setup

The mobile app implements the six-stage workflow described in the
[UX mapping](spoken-worldwide-workflow.md). This change includes application
code, a database migration, and automated checks. Hosted deployment and
physical-device acceptance remain release steps.

## Configure a project

1. Apply the OBT migration through the normal database release process.
   Install a mobile build with OBT UI to use the new workflow. Older builds
   still sync. Reducer versions invalidate caches only; see AGENTS.md.
2. Open the language lane's **Flows** view. Choose **Spoken Worldwide oral
   translation**. Open its workflow settings.
3. Set the minimum community interactions, consultant role, and final approver
   role. Defaults are one interaction, coordinator, and owner respectively.
4. Record spoken stage and community-step guidance in the participants' language. Add source
   references, translation notes, and key terms using the existing resource views.
5. Assign participants using existing project membership and passage assignment
   views. Permissions follow roles; assignments organize work without granting roles.
6. Complete drafting, community checking, and revision. A revision can explicitly
   retain the first draft. A new community round preserves earlier evidence.
7. During back translation, open workflow settings from the passage hub. Enter
   the back translator's existing account email and the output language.
8. Confirm a separate account and device without prior source access. Deliver
   the draft while connected. Retry delivery after any interrupted audio copy.
9. The back translator opens the separate workspace from the organization
   switcher, downloads the draft, records offline, and submits when ready.
10. Collect the result while connected. Consultant approval unlocks a new final
    recording. A separate decision approves that exact final recording.

## Data and access boundaries

`packages/core/src/obt.ts` derives stages from six additive event types.
Changing an upstream decision invalidates downstream evidence by predecessor
identity. A final recording must be a new take, separate from the approved draft
and back translation. No table stores stage, completion, or approval status.

`obt_private.workspaces` binds an input revision to an isolated project and its
back translator. The binding is server-only. The isolated project includes the
passage label, input audio, output language, assignment, and required membership
events. It contains no source-project pointer, source references, glossary,
translation notes, community identities, or review packet.

The server rejects accounts with recorded prior source-project activity,
source-project membership, or organization membership. It also refuses later
source-project access for the bound back translator. This protects event pulls,
snapshots, raw event reads, and storage reads. Explicit RPC grants also close
anonymous snapshot access and reserve inherited service helpers for the service role. The client restricts navigation
and prepares offline downloads from the isolated project only.

No software check proves that a person has never heard the source. Previously
cached files, copied audio, and previously issued signed URLs cannot be revoked
by hiding navigation. The separate-account/device requirement remains necessary.

Other source-project members retain existing project access. They can inspect
community names, photos, and conversations. This change does not introduce a
separate participant-consent or retention policy. Confirm that policy before
collecting real community data.

## Local work and delivery

Community names can be entered or recorded. Written comments and photos are
optional. Each interaction records the draft played and its own audio clips.
The participant form persists locally; the recording journal recovers interrupted
audio saves. Ordinary draft recording retains earlier attempts in OBT lanes.

Audio and photo uploads use the existing content-addressed blob pipeline.
Storage confirmation and workflow approval remain separate. Workspace setup and
collection copy immutable audio objects between authorized project prefixes.
Retries reuse the same workspace and imported output. Collection refuses missing
or incomplete audio and a changed submission.

Spoken prompts are configurable recordings, not generated translations. They
must be supplied before deployment to an oral-language team. Review history
retains written metadata and offers focused audio playback.

Completion identifies the approved final take and its ordered clip hashes.
The share action exports a manifest, not a mastered audio file. Joined-file
rendering, audio processing, and publishing channels require a separate delivery
integration; the source document does not specify those channels.

## Validation

Run the application checks from the repository root:

```sh
npm test
npm run typecheck
npm run typecheck -w mobile
```

`packages/core/test/obt.test.ts` covers stage order, unchanged revision,
convergence and duplicate delivery, revision invalidation, changes requested,
role eligibility, retained drafts, offline media, task/read-model parity, and
missing approval-role blockers. The general reducer suite also exercises every
new event type. Mobile route and screen-contract checks cover the new screens.

Run `server/obtSmoke.sql` against a disposable local database after applying the
migration. It wraps fixture writes in a transaction and rolls them back:

```sh
docker exec -i supabase_db_langquest-next \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < server/obtSmoke.sql
```

The smoke test checks authorized writes and reads, source-free workspace retries,
back-translator writes, prohibited source references, source reads after a later
membership grant, direct event/storage RLS, full and chunked snapshot denial,
legacy RPC denial, old-client upgrade handling, missing-audio rejection, and
idempotent result collection. It creates storage metadata fixtures, not audio bytes.

For this implementation, the migration and smoke test run in an isolated local
schema clone. The existing local database has migration-history drift: a pending
migration attempts to create an already-present `profiles` table. We do not reset
that database or claim the entire migration chain has passed from an empty database.
The local migration command applies the pending realtime and invitation-repair
migrations before it reaches that existing-table conflict.

## Release acceptance

Before enabling the partner lane:

- Resolve migration-history drift and apply the migration in the intended release
  environment. Upgrade clients before enabling the OBT flow. Protocol 1 clients
  receive an upgrade response for OBT projects; other projects remain compatible.
- Run the complete journey on two physical devices, including airplane mode,
  process termination during recording, optional photo capture, and reconnect.
- Verify real Storage audio copying, playback, upload confirmation, and restart
  recovery. SQL metadata fixtures do not test media bytes or native permissions.
- Supply spoken prompts and test the icon-first screens with oral users.
- Confirm approval roles, repeat-community criteria, participant data handling,
  final audio quality criteria, and distribution format with the partner.

The iOS bundle compiles. Simulator visual verification is blocked by the local
Metro file-watcher limit; no completed visual or physical-device test is claimed.
