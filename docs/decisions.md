# Decisions

Short records of choices that are easy to second-guess later. Each has the
reason and what would change our mind.

## 1. Event log over state replication

Reason: every recurring failure in LangQuest v2 and Codex traces to merging
mutable state. See PLAN.md section 2. Reverse if: a use case appears that needs
real-time co-editing of one artifact, in which case add a CRDT for that
artifact only.

## 2. Intent events with per-type merge rules, not a CRDT library

Reason: the domain's writes are per-actor appends and a few registers. Two
merge shapes cover everything. A library adds a dependency and a mental model
for no gain. Reverse if: more than a handful of event types need non-trivial
merge behaviour.

## 3. Clients materialize alone; server folds are optional and async

Reason: translators must see their own work instantly and offline. Server
folds serve coordinators and cold start only. Reverse if: never; this is the
property that keeps support cost down.

## 4. Content-addressed immutable audio

Reason: makes audio conflict-free and uploads idempotent by construction.
The v2 app already never mutates audio in place; this makes it a rule.

## 5. Hand-rolled sync before LiveStore

Reason: the core is a reducer, a SQLite cache, and two endpoints. LiveStore is
pre-1.0 and its one-log-per-store model only fits now that the partition is
the project. Reverse if: the reactive query layer or multi-tab handling
becomes a real cost, once LiveStore is stable.

## 6. Scale rules from day one (Swarnendu De)

Reason: the advice matched what we had already chosen (read/write separation,
async processing, business logic apart from infrastructure) and exposed two
gaps we then closed: tenant keys and an index plan on every event from the
start, and per-org rate limits and bounded pull pages instead of assuming
"we'll add them later".

## 7. Design language first, then the UX spec's screens

Reason: the UX spec prototype (`ng-langquest-ux`) defines the screen
breakdown and flows, but its purple, text-first styling is a Figma Make
default. We keep its screens, ids, and navigation, and render user screens
in the LangQuest v2 task-first language: one yellow action, icon-encoded
status, 6% tints, colourblind-safe pairs of colour and icon. Admin screens
may use the spec's text density. Reverse if: partner testing shows oral
users need labels after all; then add labels beside icons, never instead.

## 8. Every screen names its avatar

Reason: user and project-manager screens have opposite constraints (icons
versus text, one action versus all options). A comment at the top of each
screen file names the avatar so nobody applies the wrong rules. See
PLAN.md section 12.

## 9. Submission is an explicit event

Reason: UX spec A30. Recordings save the moment they are made; review starts
only when the translator hands the take off. Without `TakeSubmitted`, a
reviewer would see half-finished work. It also gives To Do / Doing / Done
a clean definition: nothing, draft, handed off.

## 10. Reviews suggest, they do not reject

Reason: UX spec A11 and the review screens. A reviewer's "suggest changes"
is advisory and returns the passage to the translator as a respond task.
The quorum rule still treats it as a non-approval, so a required step with
enough suggestions leaves the take in `changes_requested` until a new take
is submitted.

## 11. Personas are real users, and a shared device pushes only its actor's events

Reason: a dev persona that only fakes session facets would emit events the
server rejects (actorId must match the caller). So switching persona is a
real sign-in as a seeded account, and "seed demo team" creates those
accounts and their memberships through the same events a coordinator would
use. Consequence for production: a shared phone can hold several users'
queued events; the client pushes only the current actor's, so nobody's
work is refused under someone else's session.

## 12. No accidental sign-out offline

Reason: queued events belong to the signed-in user and cannot be sent under
anyone else. Sign-out lives behind a confirmation screen that refuses while
anything is queued or the device is offline, and shows why with icons
rather than words. The old header sign-out icon became the menu.

## 13. Two recorders, on purpose

Reason: expo-audio allows one recording at a time and exposes no PCM. v2
solved this with a custom Expo module (`microphone-energy`) that taps raw
PCM for energy and voice-activity segmentation and writes one WAV per card,
while expo-audio writes hold-to-record takes. Both sessions are open during
manual recording. We reuse that module unchanged rather than re-solving the
cold-start and segmentation problems it already solved. Cost: no Expo Go;
a dev client build is required.

## 14. Confirmation is an event, not a column

Reason: v2 stamped `audio_uploaded_at` on rows and needed guard triggers to
stop clients echoing it back. Here the storage trigger appends
`v1.BlobStored` to the project log under the service actor, `append_events`
refuses the type from any client, and devices learn of it through the pull
they already do. Same guarantee, no extra column, no extra sync path.
