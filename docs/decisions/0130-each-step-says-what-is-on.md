# 130. Each step says what is on the screen of whoever does it, the recording too, with hearing and reading apart

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken (2026-10-15) does not want translators reading while they
record: they liked that the Bible's text can be folded away, but worry that
if it is there at all it shapes the draft, in FIA recordings too. Caleb
asked that admins control what is available at each step of the review,
including the first recording and recording a back translation (LAN-81).
Before this, a language chose its Bibles and guides for every step at once
(decision 62), a check could only add helps (decision 91), the recorder
always showed a Bible's words (falling back to the English the app
carries), and only Back Translation hid anything, through the kind's
`withholdsContext`, which no screen could set. So a step now says what it
shows: `v1.CheckShowsSet { kindId, what, shown }` in the language stream, a
register per (kind, what), where `what` is one of hearing the Bible,
reading the Bible, hearing the guide, reading the guide, key words, notes
and earlier versions, and `kindId` is a check or `record` for recording a
version (`core/checks.ts` `checkShows`, `RECORD_STEP`). Without a register
everything shows, as before, except at a kind that withholds context,
where nothing does, so Back Translation looks as it did. Setting up a step
is managing the flow (Manage flows). Screens: the language's Checks list
starts with the recording as a card that opens like a check, and every
card says what its step hides (or, when it hides most, what it shows) by
an eye; the recording and each check have "On their screen", one switch
per thing, hearing and reading as separate switches. The recorder, the
study (the drafting team's preparation) and back translation follow their
step: the Bible heard and not read is its player and the verse numbers,
only Bibles with audio are offered and Other Bibles goes; the guide heard
and not read is its spoken step; a check's Background has only what the
check shows and is not there when it shows nothing. Answering feedback
keeps Earlier, where the feedback is. A check's own helps always show,
being chosen for it. The sentences that explained what was hidden are gone
(the review's notice, back translation's line, the passage's "beside you").
Not built: a ready-made flow saying what its steps show (Spoken's own flow
could start with reading off), and translators' own Bible exploring
outside a passage.

Amended (2026-10-15, Caleb Koster): Caleb's second look asked for a shorter
check page and finer choices. A check's page now has People and Questions
as rows that open pages of their own, and "On their screen" has one row
per help: the Bible and the guide open to Audio and Text, key words is a
switch, and notes and earlier versions open to the steps they come from.
`v1.CheckShowsSet` gains `from` (a step: `record` or a check), a register
per (kind, what, from) that falls back to the (kind, what) one, for notes
and earlier versions only. Earlier versions come from a step by what made
them (versions are the recording's, feedback its check's); a note says
where it was written through an optional `kindId` on `v1.NoteAdded`, set
by the recorder, the study, back translation and the review. That adds a
field to a shipped event, as `Card.atMs` did (decision 72): it is additive
and optional, older validators and reducers keep it, and notes without it
count as the recording's. "Same time as" is a choice of any other checks,
which join the check's step where it stands (`checks/model.ts`
`setSameTime`), instead of a switch for the check above. A step that makes
something (back translation) has "Checked at": any check after it, or a
check of its own made right after it, which is `produces.checkedBy` on the
kind, so recording the back translation and reviewing it are two steps
with their own people, questions and screens, and the passage's steps
list both. On the web, switches keep a white thumb when on.

Amended (2026-10-16, Caleb Koster): on a step's page each help is one row
with a switch that turns all of it on or off and a line saying how much is
on ("All", "Audio", "3 of 7"); the row opens the help's own page with a
switch per part (Audio and Text, or each step its notes or earlier versions
were added during, under a label saying so). Choosing material follows the
language its content is in, set once for the language: the team's
reference language (decision 84), asked when the language is set up with
how much is in each language, and changed from the top of What helps them.
What helps them and a check's "Add a help" offer only material in that
language, and what the team already has. Caleb's rule (2026-10-16): the
language of review material is set by the admin for the team, in one place.
Caleb then asked for several languages (2026-10-16: translators will want
Greek and Hebrew beside their own, or other languages): the language
question ticks as many as the team needs. The main language stays
`v1.ReferenceLanguageSet` (what FIA, Bible order and guide matching follow);
each other one is `v1.ReferenceLanguageAdded { language, added }`, a
register per language, so two admins adding different languages offline
both land, and nothing already stored changes. Lists of material take any
of the team's languages.

Reverse if: teams want the same settings on every language of an
organization or cluster; then they move to the organization's
recommendations level (decision 62) with the language's register on top,
with no change to what a step reads.
