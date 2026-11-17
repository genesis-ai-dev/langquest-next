# 63. Below the organization there are only languages, and the sync unit is the stream

Date: 2026-10-06 · By: Carl Sauder · Status: accepted

Reason: the model still carried two levels that no longer existed. The
project left the app in 34 and became one partition per language in 37, yet
the code named it everywhere (`projectId`, `ProjectState`,
`v1.ProjectCreated`, the `project` scope) while SQL and docs called it a
partition; and every partition held exactly one lane with the same id. Most
of the code paid for distinctions that never varied, and where they varied
TypeScript and SQL disagreed: a lane-scoped member was authorized for the
whole partition on any event without a `laneId`, "All languages" materials
reached only the language that was open, and the UI offered language admins
invites the server refused. With three developers and nobody else's data,
we reset the databases instead of migrating (Carl, 2026-10-06). So, as
`docs/streams-and-languages.md` sets out: below an organization there are
only languages; a language's identity (name, code, source code, country,
target) lives in the organization stream (`LanguageAdded`), its work in its
own stream, and a language stream accepts events only once the organization
lists it. The sync unit is the stream (organization, language or person),
named `streamId` only in sync code; everything about a language says
`languageId`, and work payloads carry neither, since the stream an event is
appended to says which language it belongs to. Membership scope is `org` or
`language`, one role per scope, and core and SQL compute privileges the
same way. Settings have two shared levels: the organization's library and
its recommendations, and the language's template, flow and own choices;
material for every language is a recommended library item. The event
catalog keeps one version of each event, restarted at `v1`, without the
ones nothing wrote, and the role-based v1 workflow model is retired in
favour of the record model. The migrations were squashed into one baseline.
Supersedes 25 and 34; amends 23, 32, 37 and 62.
Reverse if: an organization needs one body of work synced across several
languages at once; then a language stream gains members of its own, not a
lane level.

Amended (2026-10-06, Carl Sauder): two choices made while retiring the v1
model. A new language picks its flow when it is added, and a language with no
flow selected has no steps (`deriveFlow`), instead of falling back to a
default workflow. The server's Inbox rows and pushes come from the same
`updatesFor` the phone's Inbox reads, one row per update for each person who
may open the language; the blocker and "translate everything" rows are gone.
Amends 21, 24, 42 and 47.
