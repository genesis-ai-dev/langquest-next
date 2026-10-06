# The path through every screen

Every screen has one main action, at most one or two secondary actions, and a
way back. The main action is the likeliest next step, like the next slide in a
slideshow; rarer actions are one labelled tap away (More, Options for this
step, Help, Setup, Advanced, Add details), never deeper. This is the rule from
decisions.md 56 (Linear LAN-28), written out so no screen is left to judgment.
Change this file when a screen's main action changes.

"Back" is the header's back arrow (or ✕ on a task screen, ADR-021); tabs are
always a way back to a home.

## Doing the work

| Screen | What the person needs to see | Main action | Secondary (one or two) | Rarer, one tap away | Way back |
| --- | --- | --- | --- | --- | --- |
| My Work | The one thing waiting on them, then the rest | The Next card's button (Record, Review, Respond, Start, Continue) | Another For you card; the bell (updates) | Recent and Waiting on others lists | — (home tab) |
| Passage record | Where the passage stands, top to bottom; the current step open | The current step's main button: Record it, Review it now, Send to ‹team or person›, Record a fix | More beside it (the step's other actions); Open the recording | Header More (record a new version); Options for this step on any step; Details (reviews by version, history, study) | Back to the map or My Work |
| Recording (workspace) | The source on top (text, audio, key terms), the recorder below | The red record button | Publish (once something changed) | Help (key terms, study, notes, history); drag the divider | ✕ to the passage |
| Back translation | The version to listen to on top, the recorder below | The red record button | Save back translation | — | ✕ to the passage |
| Review it now | ① Listen ② Questions ③ Your verdict, one stage at a time | Next (Next: questions / Next: your verdict), then Looks good | Needs changes (with what to change) | Background (translator's notes, the team's study, earlier reviews); Can't answer this? | ✕ to the passage |
| Already happened | Who gave it, then the same stages | Next, then Looks good / Save to the record | Needs changes | Add details (where, which version, other passages, the retelling) | ✕ to the passage |
| Ask someone | Who usually does it, first | Ask ‹name› | Someone without the app | Directions, questions, due date | ✕ to the passage |
| Version | What changed, the takes | Play | Reviews of this version | Key terms, notes, report | Back to the passage |
| Review | The outcome and the feedback | Record a fix (the author) | Keep it, say why (the author) | Answers, report | Back to the passage |
| Study guide / step | The step's material | Done with this step (or Next step) | Record the first draft (last step) | Passage view, notes | Back to the passage |

## Finding a passage

| Screen | What the person needs to see | Main action | Secondary | Rarer | Way back |
| --- | --- | --- | --- | --- | --- |
| Map | The language's books and progress | A book | Search | Filter (status chips) | — (tab) / Back to All languages |
| Book chapters | The chapters, coloured by state | A chapter | Filter | Edit passages (shape templates) | Back to the map |
| All languages | Each language's progress | A language | Find a language | — | — (tab) |

## Running the organization

| Screen | What the person needs to see | Main action | Secondary | Rarer | Way back |
| --- | --- | --- | --- | --- | --- |
| Org home | The organization and its languages | Invite people | A language; Members | Setup (content templates, reference, review flows, roles, licence) | — (Manage tab) |
| Language home | The language's progress | Open the passage map | Members; Review teams | Setup (templates, reference, flows, roles, list publicly) | Back to the org |
| Members | Who is in, at which level | Invite | A member | By language | Back |
| Review team | The team's members and kind | Save | Usually reviews (kind) | — | Back |

## Account

| Screen | What the person needs to see | Main action | Secondary | Rarer | Way back |
| --- | --- | --- | --- | --- | --- |
| Settings | Who they are, and the common rows | Edit Profile | Notifications; Getting started | What is LangQuest?, Switch organization (more than one), Sign out; Advanced (sync, diagnostics, blocked people); Delete account (its own row, where the stores were told) | — (tab) |
| Inbox (from the bell) | Updates, newest first | An update | — | Join requests and reports (admins) | Back to My Work |

## Getting in

The sign-in, invite and welcome screens follow `docs/invites-and-accounts.md`
(decisions 54 and 59, the demo's ADR-031). Sign In and Create Account each
put their fields and button first, then "or", then the scanner: two ways in
that never combine. On the scan screen a one-person invite's main action is
"Join as {name}" (no email, no password), a group invite's is "Join" (their
name next), and "I already have an account" is the secondary one. A helper's
sign-in code has one action, "Sign in".
