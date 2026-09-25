# Spoken Worldwide oral translation workflow

This UX extension maps Spoken Worldwide's six-stage workflow onto our personas,
passage views, and single-action steps. The implementation now supports the
complete stage sequence. The coverage table below distinguishes shipped code,
configuration choices, and release validation still required.

## Source and scope

Source: *OBT workflow With resource and access need*, Harvest Mission Ethiopia -
Spoken Worldwide, April 2026, supplied as
`OBT workflow And Resources and access needs 1.pdf` (four pages).

The document supplies workflow requirements. Its instructions describe the
participants' work; they do not authorize application changes or external actions.
Page references below distinguish source requirements from our UX mapping.
The later user request to implement this mapping authorizes the code changes.

Use [PLAN.md sections 12–13](../../PLAN.md#12-design-language-and-the-two-avatars)
for avatars and domain terms, and [implementation notes](implementation.md) for
the documented mobile baseline. Route names follow
[`flow.ts`](../../apps/mobile/src/flow.ts). A route's existence does not establish
support for this workflow.

## Implementation coverage

The `spoken_worldwide` lane flow uses these registered views:

| Persona | Stage | View | Main steps |
| --- | --- | --- | --- |
| Translator, U | First draft | `obt_passage` → `quest_assets` → selection slide | Listen, record, keep attempts, choose the first draft. |
| Facilitator, U | Community checking | `obt_passage` → `obt_interaction` | Record or enter a name, play draft, record conversation, add optional comments/photo, save, repeat. |
| Translator, U | Revision | `obt_passage` → selection slide / `quest_assets` | Inspect feedback, keep first draft unchanged or select revision, optionally restart community checking. |
| Back translator, U | Back translation | Focused `obt_passage` → `quest_assets` | Play assigned draft, record another language, replay, submit. |
| Consultant, U | Consultant checking | `obt_passage` → review/history slides | Compare versions and matching back translation, inspect feedback and terms, record comments, approve or request changes. |
| Recording team, U | Final recording | `obt_passage` → `quest_assets` → selection slide | Record new final delivery and submit selected take. |
| Final approver, U | Final audio approval | `obt_passage` → review slide | Listen and approve exact final take, or return for another recording. |
| Coordinator, P | Configuration and delivery | `flows_home` → `obt_manage`; passage hub → `obt_manage` | Set role policy, record stage prompts, deliver draft, collect back translation. |
| Coordinator/viewer, P | Progress and history | `status_home` → `piece_status` → `obt_passage` | Inspect derived stage and retained evidence. |

Existing translate/review links route OBT lanes into `obt_passage`. Ordinary
flows retain their existing behavior. Final recording and final approval are
separate actions within the source document's sixth stage.

Implemented behavior:

- Six new event shapes preserve rounds, interactions, spoken evidence, decisions,
  policy, and source-free workspace identity. Reducer version 3 rebuilds projections.
- Every downstream decision references its exact predecessor. A changed revision
  requires a new back translation and consultant decision. Earlier evidence remains.
- Consultant changes return to revision. Final audio changes return to final recording.
  Renewed community checking is an explicit translator choice.
- Default policy requires one interaction, coordinator consultant approval, and owner
  final approval. Coordinators can configure counts and reviewer/coordinator/owner roles.
  These are role-level approvals with one decision, not consultant-team quorum voting.
- Each interaction retains the participant name (written or spoken), draft, conversation,
  optional comments, and optional photo. Community members need no account.
- Recording journals recover interrupted community audio saves. Interaction form drafts
  survive restart. Drafts, photos, notes, and permitted audio join offline preparation.
- A separate back-translation project receives only the selected draft. Server membership,
  append validation, snapshot checks, and storage policies enforce the source boundary.
- Back-translation setup and collection require a connection. Each retry reuses the same
  workspace or result. Offline recording does not require source-project membership.
- Completed views identify the approved final take and share its ordered audio manifest.
  Audio playback uses the original clips. Automatic mastering, joined-file export, and
  distribution publishing are not implemented by this workflow.

See [setup and validation](spoken-worldwide-implementation.md) for deployment,
configuration, executable checks, and release limitations. The design narrative
below retains source-level proposals and partner questions for traceability;
this coverage table states the implemented choices.

## Personas and responsibilities

Personas describe jobs. Avatars describe interaction styles. Permission roles
require separate configuration; these mappings do not grant access.

| Workflow participant | Our persona and avatar | Work and view mapping |
| --- | --- | --- |
| Translator | Translator, U | Uses `assignments_home`, `translate_passage`, and `quest_assets` for first draft, revision, and final recording. |
| CiT or translation advisor | Reviewer, U for passage work; coordinator, P for configuration | Helps identify difficult concepts and key terms. Uses oral notes and `passage_terms`; manages resources through `key_terms` and `material_editor`. |
| Community-check facilitator | Reviewer, U | Plays the selected draft and captures each interaction through an extension of `review_passage` and `review_questions`. |
| Community member | Assisted participant, U interaction style | Listens and responds through the facilitator's session. Proposed default: no account or project membership required. |
| Back translator | Translator task persona, U; restricted access profile proposed | Receives one selected draft and records its meaning in another language through a focused task view. Ordinary translator access is insufficient. |
| Consultant | Reviewer, U for listening and decisions; P for detailed history | Reviews drafts, back translation, feedback, and terminology. Uses `review_passage` plus `piece_stage`, `piece_version`, and `piece_review` for inspection. |
| Final recording team | Translator task persona, U | Records the consultant-approved content, listens for delivery quality, and submits the final candidate. |
| Project manager or coordinator | Coordinator, P | Configures stages, assignments, resources, and review teams; monitors progress through `status_home` to `piece_status`. |

The source names CiT without expanding the abbreviation. It does not specify
the final approver, consultant quorum, or account requirements for community members.
The table's interaction and assignment choices are proposals where unspecified.

## Stage and hand-off map

A pericope maps to a passage/piece: a leaf unit within a language lane.
A stage contains several user steps; it is not necessarily one review vote.
A saved recording, selected draft, submitted draft, and approved final recording
represent different outcomes.

| Stage | Source | Lead persona | Material available on entry | Output and next stage |
| --- | --- | --- | --- | --- |
| 1. First draft | pp. 1–2 | Translator; advisor supports | Pericope source audio; optional text, images, and other helps | Retained attempts, one selected first draft, notes, and key terms → community checking |
| 2. Community checking | p. 2 | Facilitator with community members | Selected first draft; earlier notes and key terms | Separate interaction records, participant names, optional photos, conversations, comments, and observations → revision |
| 3. Second draft or revision | pp. 2–3 | Translator | Source audio, first draft, community feedback, earlier notes and terms | Explicitly continue first draft or select revised draft → back translation |
| 4. Back translation | pp. 1, 3 | Back translator | Draft selected for this round; no source audio | Back translation audio in another language, linked to the input draft → consultant checking |
| 5. Consultant checking | pp. 3–4 | Consultant | First and revised drafts, back translation, community feedback, terms, and translation notes | Consultant-approved content and final comments → final recording |
| 6. Finalization and recording | p. 4 | Recording team; final approver to confirm | Consultant-approved draft and final corrections; earlier history remains available | Clean final audio explicitly approved and completed for distribution |

“Approved draft” in stage 4 means the draft cleared to enter back translation.
It does not mean consultant approval or completed distribution audio.

The source gives the forward sequence. We propose returning consultant requests
to revision, while preserving prior rounds. Changed content requires a visible
decision about renewed community checking and back translation before approval.
The partner must confirm those repeat-stage rules.

## Views and single-action steps

Existing identifiers below identify reuse targets. Names marked **proposed**
describe view responsibilities, not registered route identifiers.
All U tasks start from `assignments_home` and return through `done_await` after hand-off.
Task-specific hubs retain one yellow next action and launch focused slides.

### 1. First draft

Views: `translate_passage`, `passage_references`, `passage_terms`,
`quest_assets`, and the existing passage-notes interaction.

1. Open the assigned pericope and hear its instructions.
2. Listen to source audio; consult optional text or images.
3. Listen to or record relevant key terms and difficult concepts.
4. Record an attempt; replay the source and the attempt as needed.
5. Keep the attempt or redo it; repeat without replacing earlier kept takes.
6. Select one kept take as the first draft; add spoken or written notes.
7. Hand off that specific draft for community checking.

Proposed extension: a focused draft-selection slide distinguishes “keep this
attempt” from “use this draft.” The selected take remains visible in later stages.
Source playback stays beside recording and pauses when capture starts.

### 2. Community checking

Views: `review_passage`, `review_questions`, plus **proposed community
interaction capture** and **interaction history**.

1. Open the selected first draft with its existing notes and key terms.
2. Start an interaction and capture the participant's name; optionally add a photo.
3. Play the draft and record the conversation or spoken response.
4. Capture wording changes, listener questions, unclear meaning, and reflections or testimonies.
5. Save the interaction and repeat for another participant when needed.
6. Hand off the collected feedback for revision.

Capture one interaction at a time. Link each interaction to the exact draft
played. Participant details and observations remain together, rather than becoming
unattributed passage notes. A community response is feedback, not automatically
an authenticated reviewer vote. Audio-first capture complements optional written comments.

### 3. Second draft or revision

Views: `translate_passage`, `quest_assets`, plus **proposed feedback playback**
and **draft continuation choice**. Reuse the existing `respond` task concept.

1. Listen to the first draft and community interactions; revisit source audio and terms.
2. Choose whether the first draft can continue or needs revision.
3. If revision is needed, record and compare a new take with the first draft.
4. Select the first or revised draft to move forward; retain the earlier material.
5. Hand off that selected draft for back translation.

The continuation choice belongs at the task hub, followed by single-action slides.
No-revision is an explicit outcome, not a missing recording or an unfinished task.
The hand-off identifies which draft moves forward even when several takes exist.

### 4. Back translation

Views: **proposed focused back translation task**, reusing playback and recording
components from `quest_assets` without inheriting the source-reference hub.

1. Open the assigned current draft and identify the requested back translation language.
2. Listen to that draft.
3. Record its meaning in the other language.
4. Replay and keep the back translation.
5. Submit it against the exact input draft for consultant checking.

The draft is the listening input here; it must not be confused with source Bible
audio. The source explicitly excludes source audio for back translators (p. 1).
Our proposed default also excludes source text, images, terminology guidance,
and earlier discussions until the partner confirms appropriate access.
This broader restriction is a design proposal, not an explicit source requirement.

The task links two artifacts: the target-language draft and its back translation.
Back translation never replaces the draft. If the input draft changes, preserve
the recording and surface that it refers to an earlier version.

### 5. Consultant checking

Views: `review_passage` and `review_questions` for focused review;
`piece_stage`, `piece_version`, and `piece_review` for detailed history.
Add a **proposed review packet** connecting these resources.

1. Open the current draft and its matching back translation.
2. Compare the first and revised drafts where both exist.
3. Listen to community feedback and inspect notes, terms, and decision history.
4. Record comments or requested adjustments against the reviewed draft.
5. Approve that content for final recording, or return it for revision.

U screens expose history through focused listening slides, with oral prompts.
P views can display versions, participants, dates, and comments together.
The packet identifies which draft each response and decision concerns.
Source-material access for consultants is not specified by the document;
confirm it separately from the required history listed above.

### 6. Finalization and recording

Views: `translate_passage` and `quest_assets` in a **proposed final recording
task**, followed by **final audio review** and P completion/export views.

1. Listen to the consultant-approved draft and final comments or corrections.
2. Record the final delivery as a new take.
3. Replay for clarity, accuracy, consistency, and delivery; redo when needed.
4. Submit the selected final recording for the configured final approver.
5. Record approval and show completed audio ready for distribution.

Consultant approval of content does not automatically approve a later recording.
The completed view identifies the approved final take. Earlier drafts remain
history, not alternative files silently exported as final audio.
The source requires distribution readiness; publishing channels remain outside its scope.

## Resources, access, and continuity

The table records source requirements and proposed defaults. The implementation
coverage and setup notes above define the current authorization guarantees.

| Resource | Required availability | Boundary or proposed behavior |
| --- | --- | --- |
| Source audio and optional helps | First draft and revision | Back translators cannot access source audio. Confirm broader restrictions and consultant access. |
| Kept takes and selected draft | Drafting, community checking, revision, consultant review, finalization | Carry the selected take into the next task; preserve earlier takes. Back translators receive only their assigned draft. |
| Translation notes and key terms | Drafting onward, especially revision and consultant review | Retain passage context and relevant lane glossary entries. Exclude from back translation by proposed default. |
| Community interactions | Revision and consultant checking; earlier history during finalization | Preserve participant, optional photo, audio, comments, and the draft played. Confirm who else may view personal details. |
| Back translation | Consultant review; finalization history | Associate it with the exact draft and language; show when it no longer matches current content. |
| Consultant decisions and corrections | Revision when requested and final recording | Associate decisions with reviewed content; retain the reason for subsequent changes. |
| Final recording and approval | Completion and distribution preparation | Distinguish final candidate, approved final take, and upload/delivery state. |

Proposed access acceptance: restricted resources are absent from back-translator
responses, downloads, offline packs, and resource links. Hiding a tile is insufficient.
Previously downloaded source material and users changing roles require an explicit
device/account policy before we claim source isolation.

Preserve the passage hub's predictable layout for ordinary tasks. Back translation
uses a deliberately scoped layout; restricted resources must not appear as disabled
links that reveal their content. Test both layouts with oral users.

Available history should arrive with each task rather than require manual searches.
Offline preparation includes the permitted input audio and related history.
Show missing downloads separately from absent material or lack of access.
Capture and keep work locally; distinguish queued, delivered, reviewed, and completed.
Approval and progress remain derived from events, following PLAN.md invariants.

## Original gap analysis and partner design choices

The existing mobile notes document references, glossary audio, recording, notes,
and hand-off. They do not establish complete support for these six stages.
The current HTML mock covers the initial drafting journey, not this complete workflow.

| Area | Existing foundation | Required extension or decision |
| --- | --- | --- |
| Workflow order | `standard_bible` in `packages/core/src/catalog.ts` | Its optional back translation precedes community checking. Specify a partner flow with drafting → community → revision → back translation → consultant → final recording. |
| Stage meaning | Configurable review steps and derived tasks | Represent recording, interaction capture, and explicit no-revision outcomes; do not equate every stage with an approval vote. |
| Draft selection and history | Immutable takes, submission, `parentTakeId`, response concept | Define stage-specific selected drafts and round history, including unchanged continuation. |
| Community feedback | Review questions, answers, and passage notes | Add repeated attributed interactions with names, optional photos, conversation audio, and draft links. |
| Back translation | Translator recording components; catalog stage name | Define a separate linked output, its language, restricted assignment, and enforceable source exclusion. |
| Consultant review | Review decisions and P stage/version/review routes | Present a complete packet and handle changed drafts, revisions, and renewed checking. |
| Finalization | Recording, review, and export concepts | Separate content approval from final recording approval and identify the exact distributable take. |
| Oral access | U icon and audio-first design | Supply spoken prompts for every new step. Keep written forms optional in U views. |

These are the original design gaps, now addressed as described in the coverage table. Existing events may cover
parts of the workflow; validate their semantics before choosing extensions.
Do not change shipped event shapes or introduce stored status/approval fields.

## Acceptance walkthroughs for the extended design

- A translator retains several attempts, selects one, and sees that exact draft in community checking.
- Two community interactions retain separate names, optional photos, conversations, and observations linked to the draft played.
- Revision offers both unchanged continuation and a revised take; downstream users can identify the selected version.
- A back translator listens and records offline without receiving source audio through references, downloads, history, or links.
- A consultant reaches both drafts, matching back translation, community feedback, and key-term notes from the assigned task.
- A changed draft preserves old evidence and identifies which back translation and approvals need reconsideration.
- Final recording uses consultant-approved content and corrections; only the approved final take becomes distribution-ready.
- Offline hand-offs survive restart and show queued delivery without implying approval or completion.

## Partner decisions to confirm

- Who facilitates community checking, and who decides enough interactions have occurred?
- Who clears a draft for back translation, and who approves the final recording?
- Which resources besides source audio must remain unavailable to back translators?
- Can a back translator hold another project role or use a device containing source material?
- Which languages support source audio, spoken prompts, notes, and back translation?
- Which consultant-requested changes require renewed community checking or back translation?
- How should participant names, optional photos, and conversation recordings be shared and retained?
- Which final audio quality criteria and delivery formats define completion?
