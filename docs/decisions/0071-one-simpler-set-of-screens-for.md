# 71. One simpler set of screens for everyone, keeping every capability

Date: 2026-10-08 · By: Caleb Koster · Status: partly superseded by 125

Reason: clients who had watched field translators with little or no
experience with technology preferred Ryder's simplified screens (one task,
big buttons). Caleb chose to simplify the app itself rather than add a
second "simple" view: a Simple/Full split per person was designed and
dropped, because two sets of screens would double what has to be kept
working. The specification is the partner demo's ADR-032 to 040 and
SIMPLE-1 to 16 (ng-langquest-ux, branch `caleb-simple-translator`; notes in
`docs/ux/simple-redesign.md`). Built here:
- The passage record leads with the path's next step; other ways forward are
  under "Something else?" (ask someone, already happened, not now, a new
  version, a note, what helps, keeping it on the device), and the study,
  reviews by version and history under "Versions and history"
  (`screens/passage.tsx`).
- Publish, then ask: publishing (a version or a back translation) returns to
  the record with the usual team for the next check preselected
  (`published` param, `usualTargetFor`).
- The recording workspace's top pane takes any reference by chip, and
  `recording/splitModel.ts` adds one-line ends (`BAR`) to the 35/50/65 snaps.
  The record button stays in the footer, so it is reachable at every snap.
- Ask someone lists the review group for that check first, named
  (`askCandidates`); admins may put people in each group.
- Admins get "Get ‹language› ready": four plain questions on My Work
  (what they record, what helps them, who checks, invite), and the language
  page shows the same three rows in place of Setup. New Language can choose
  books (`booksInScope` with `custom`). Roles read in three groups
  (`PRIVILEGE_GROUPS`), and a new role can be made while inviting or
  admitting someone.
- Help mode: a ? in every header; while on, kit controls explain themselves
  instead of acting (`helpContext.ts`, `helpMode.tsx`), spoken on the web.
- Joining reads "Join your team": scan their code, find your organization,
  start a new one. "Keep it, say why" has no preset reasons.
Not built yet, because each needs model or recorder work: grouping recorded
parts into cards by verse label (needs verse labels on parts), recording
which Bible was playing during each take (today `v1.ReferencesUsed` lists
what was offered and opened), microphone setup by ear (the recorder keeps
its pause and cutoff only for a session), spoken help lines per screen on a
device, notes on a key term, and side-by-side panes on wide windows.
Reverse if: field tests show translators miss what moved behind "Something
else?" or "Versions and history", or admins need the Setup list back.

Amended (2026-10-08, Caleb Koster): Home, the tabs, the Map and Me now look
like the agreed design, not only relabelled. The tabs are Work, Map, Manage
(admins) and Me, with no count on Work; the bell carries the unread count.
My Work leads with one "Next for you" card (Start opens the passage for
recording and feedback, Review it for a check, the back translation for
one), then "Then" (three rows, the rest one tap on) and "Waiting on others"
and "Opened lately" as quiet links that open in place. Getting started is
gone (help mode and the Get ready card replace it); a coordinator's Home
leads with "Get ‹language› ready · n of 4" and the next question, which opens
the Get ready screen at that question (`step` 1 to 4), with join requests and
checks asked of them under it. The sync chip shows only when work waits to
send, the device is offline or sync is refused. A language's map is search,
"Next", testament pills and one row per book with a bar and "25/97"; the stat
tiles, filters and template and flow are behind "Filter". A book's chapters
show three states (done ✓, started •, not started), the seven-tone key one tap
deeper. Settings is Me: name, Ready for offline, Set up the microphone, How
LangQuest works, More settings, then Sign out; More settings holds the rest,
including Delete account (decision 56's "Settings" row; the deletion page and
store declarations now say Me → More settings → Delete account).

Amended (2026-10-08, Caleb Koster): Review it and back translation are the
agreed screens (`screens/review.tsx`, `simple/review.tsx`,
`simple/btWorkspace.tsx`). Review it is Listen, Questions (one per screen),
Decide, then "What should change?" voice first; Background is one sheet
(the passage in the Bible the translator used, the team's study, notes, key
words, earlier checks). No new events; existing fields carry the new parts:
- A note at a moment of the version is a review artifact with `atMs`, as on
  review links.
- An answer said aloud is a review artifact too; `answers` stay text and
  name it ("Said aloud · 0:14 · recording 1"). Tying a clip to its question
  exactly would need a `questionId` on Card (core, SQL `_is_cards`, a
  migration), not done.
- A note on the Bible in Background is a verse note (`verse`, `translation`,
  `at`), as the study and the recorder leave.
- Back translation is said part by part against the parts of the version;
  each piece carries the moment its part starts (`atMs`), which
  `produceContent` now keeps, so the consultant can pair them. Part cards
  say "Part n" until parts have verse labels.

Amended (2026-10-08, Caleb Koster): the admin screens now take the agreed
shape, not only its words (Caleb: "go through the plan we agreed on and
actually do it"). A language's page is the Get ready checklist until the
language is ready, then the same four as a summary with join requests under
them; everything else it had is under More. Ready means something to record,
a way to check it, and someone given a role or a code for that language (the
organization's own translators do not count, since they cover every
language); what helps them is asked but never required. Each question is its
own screen (`get_ready` with `step` 1 to 4, `helps` for What helps them). A
guide or note in the library counts as offered unless the language hides it,
as `reference/offered.ts` already offers it; a Bible only when recommended.
Who checks, from a ready language, edits that language's own steps (core
`saveFlowSteps`), so it stops following the library flow it used; Undo puts
that flow back. New Language is four steps and offers the new team the
organization's own English Bible and study guides, else LangQuest's (followed
first). What someone will do reads as four plain choices given by the
organization's roles (Back-translate gives the checking role unless a role of
its own exists); the rest stay one tap away. A role's fifteen permissions are
twelve switches in three groups: setting up languages covers the structure,
templates and dividing books; choosing who checks covers flows and review
groups. Inviting shows a group code (30 uses) first; email and a code for one
named person are one quiet tap away.

Amended (2026-10-08, Caleb Koster): the recording workspace, Publish, the
study and microphone setup now follow the agreed images (`src/simple/`).
The workspace's header names the passage; its chips are Bible, Guide, Key
words, Notes and Earlier (versions, feedback, voice notes, back
translations), the Bible a small player over its verses with a picker when
there are several; key words play their verse and "Your word" (the latest
voice adjustment) or record one ("Say yours", `adjustKeyTermRendering`), and
"Add a key word" is `defineKeyTerm`. Parts are cards counted "Part 1, 2…"
(still no verse labels), recorded ones under one card; each divider end is a
one-line bar (the Bible bar, the recorder bar with the record button), and
the footer holds the record button and Publish. Publish is a screen inside
the workspace, so nothing offered or recorded is lost on the way. The study
is one reader for `study_guide` and `study_step` (it no longer keeps the tab
bar). Microphone setup measures the room's quiet for the sensitivity, takes
three tries with pauses of 0.7, 1 and 1.5 s, and keeps the pick on the device
(AsyncStorage `mic-setup:v1`), which every voice-detecting recorder starts
from; the pause dots and the cutoff line left the workspace for "Adjust by
hand" there. A voice-detected part now belongs only to the session that
started the detector (`claimVad`), so a recorder left mounted under another
screen keeps nothing it did not record. Still not built: notes on a key term
(no screen writes a `term` note, so "Note on a word" is left out).

Amended (2026-10-09, Caleb Koster): spoken help on a device plays recorded
lines in the app's language, downloaded and kept on the phone (decision 81);
none are recorded yet, so a device still shows the words.

Amended (2026-10-10, Caleb Koster): help mode no longer opens by itself. The
first-time screen intros (demo a-helpFirst) are gone, because opening the
overlay the first time someone reaches each screen was too confusing; help
comes only from the ?. While it is on, the screen dims and every part stays
lit with its number, the ? lit and filled as the way out (the "Help is on"
banner is gone). A tap on a part shows a tooltip beside it, its name and
what it does, with a play button; nothing plays by itself, and the card
that said "Playing" and stepped through the parts with Back and Next part is
gone. The play button shows where there is something to play: a recording
of the line, or the browser's voice on the web. "How this works" still plays
when tapped, in the same tooltip. Every part that explains itself is now
numbered: the controls that used `useHelpPress` explained themselves without
a visible number, and now light up and number like kit's (`useHelpSpot` with
`HelpBadge`). The layer that draws the dim, the numbers and the tooltip
(`helpMode.tsx`) measures each part every frame while help is on, so it
follows scrolling; kit's Screen body and the workspace panes (`HelpClip`)
keep what scrolls inside them from being lit past their edges. Numbers go in
reading order across what is in sight when help comes on, and parts
scrolled into view later take the next numbers, so a number never changes.
Reverse if: field tests show people miss help without the intros (then an
intro behind the ?, not on first open), or the dim hides what people need
to see while exploring.

Amended (2026-10-11, Caleb Koster): New language makes its own answer where
none fits. Question 3 has "I'll choose the steps" (as Get ready does): it
opens the flow editor on a new flow for the organization, named "<language>
checks" and starting from the steps of the way picked before, and the flow
saved there comes back picked. Review flows stay library flows chosen per
language, so the new one is a template other languages can use too.
Question 2's "Make your own" opens the template editor (`new_language` had
no edge to it, so the app said it could not open there). Continue no longer
shows a still "Saving…" button: the screen names each part as it starts
(the passages, the review steps, the Bible and guides offered, listing the
language, saving its passages) under a bar that keeps moving, and ✕ says
to wait until it is done. The wait itself was mostly FIA's English guides:
loading a collection fetched everything it depends on, which for that
collection is 1,525 guides (65 MB), and following it did that before going
on. Opening any passage did the same on every phone, the first time. Now a
collection brings only its numbering, as a Bible source already did
(`loadDocs` in library/docStore.ts), and each guide is fetched by its own
hash when a passage reads it. On a phone-like link (12 Mbit/s down, 4 up,
120 ms) a first language took 60 s and now takes 5 to 7; the first passage
opened fetched 1,524 documents (67 MB) and now fetches its one guide (80
KB). Offline, a phone keeps the guides of the passages it keeps (decision
61, `StudyPrefetch`), not every guide.
Reverse if: teams need every guide on the phone before they go out of
signal, beyond the passages they keep (then a "keep all guides" choice on
Ready for offline, not a download on first open).

Amended (2026-10-13, Carl Sauder): the "seven-tone key one tap deeper" above
is no longer what the app shows. A book's chapters show three states, and
the key under Filter has five lines: done, started, not started, no passage,
and kept on this device. The seven tones survive only in each chapter
tile's spoken label. The UI test suite (decision 95, MAP-021) holds the
app to this.

Amended (2026-10-13, Carl Sauder): the welcome offered "Show me how" and
"Skip for now", which both went to My Work once the Getting started card was
gone. It now offers one "Get started" for every role (AUTH-057). The tour
"Show me how" stood for was never built.

Amended (2026-10-14, Caleb Koster): Switch Organization is no longer only
under More settings, because Caleb and a partner both found it hard to find
there. For someone known to be in more than one organization, Me shows it
as its second row, under their name (`inSeveral` in `account/model.ts`).
My Work does not offer it: Caleb chose Me as the one place. Someone in one
organization, or on a device that has never listed theirs, still finds it
under More settings, where it starts a new one, so Me stays uncluttered for
most translators (the demo's ADR-029 shows it only to people in more than
one). The list is read once per run and shared
(`account/useOrganizations.ts`), so the row does not jump between Me and
More settings.

Amended (2026-10-14, Caleb Koster): every part explains itself. Caleb asked
for help on every element that should have it, with the principle behind it
applied across the app. What deserves help:
1. Everything a person can tap, type in, switch or drag is a part: while help
   is on it lights, takes a number, and explains itself instead of acting.
   Before, about 90 controls outside the kit still acted, as did the kit's
   tappable cards, sections that open in place, Show more, fields, switches,
   Back and the tabs, so a tap in help mode could leave the screen or open the
   keyboard. Back now explains itself too: the ? is the one way out of help.
2. A part says what tapping it does, not only its name. Buttons, chips,
   tappable cards and rows whose label is one word or a name carry a line
   (`help` on the kit's controls; a Row's `sub` unless `help` is given).
3. A mark that means something without words (the sync dot and ring, a
   step's state marks, a bar or a bare count) explains itself (kit's
   `HelpInfo`), or the part it sits in says what it means.
Plain words that say what they are need nothing. Sheets have their own ?: on
a phone a sheet is a window of its own, so help draws inside it and lights
only its parts (`useHelpHost`), and help turns off when a sheet opens or
closes. `apps/mobile/test/helpParts.ts`, run by `helpMode.test.ts`, fails on a
control without its line; a `help-ignore:` comment marks the few that need
none (a sheet's backdrop, toasts, the crash screen, the update banner above
the help layer). The 883 English lines add 59 KB to what a first visit
downloads on the web, so its budget rose from 6.1 to 6.25 MB
(`apps/mobile/scripts/export-web.mjs`, 6.17 MB then).
Reverse if: people stop using help because the extra numbers crowd a screen
(then number only the parts in reach of the ? first), or a line per part
costs more to translate and record than field tests show it saves.

Amended (2026-10-16, Caleb Koster): one row speaks for a list. Caleb, with a
screenshot of the recording screen in help mode ("Holy help references
batman"): every row of the parts list had its own bubbles, 51 numbers on one
screen, and having them "on just one row would be sufficient". The crowding
the entry above warned of had come from lists, where every row repeats the
same parts. Now each row a list draws is a `HelpRow` (`helpBadge.tsx`) naming
its kind (`of`). While help is on, the first row of each kind in sight speaks
for the list (`helpContext.ts` `chooseRows`: a row wholly in sight before one
cut off at an edge, then top to bottom): its parts light and take numbers.
The other rows stay dim and unnumbered, and a tap on one of their parts still
explains it, lighting it with its tooltip, so nothing acts in help mode. The
row keeps speaking while it is on the screen; when a list that draws only
what shows scrolls it away, the next row in sight takes over. In a list in
a list (a guide's sections and their pictures), the first inner row in sight
speaks for its kind, whichever outer row holds it. Lists whose items
each do something different (tabs, filters, crumbs, a menu of actions) keep
a number on every item and say why with a `help-each:` comment.
`apps/mobile/test/helpParts.ts` fails on a list whose rows hold parts with
neither. The recording screen went from 51 numbers to 27.
Reverse if: people miss what a row does because the row that speaks for its
list is not the one they look at (then let the row last tapped speak), or
same-shaped rows turn out to need different explanations.

Amended (2026-10-16, Caleb Koster): one first-time motion, which Caleb asked
for: the first time a phone shows a list of parts, its top part slides right
to show its bin, then back. It has no words, covers nothing and opens no help
(decision 136).

Amended (2026-10-16, Caleb Koster): a ready language's page no longer
summarises the four questions as They record, What helps them, Checks and
People with the rest under More. It names each thing as the organization's
page does (Content template, Reference material, Review flow), with seven
rows and no More; see 138.

Amended (2026-10-21, Carl Sauder): a Global Viewer looking in on an
organization (decision 158) has an eye in every screen's header ("Global
Viewer" beside it on a wide window) that opens the Global Viewer screen:
the organization they are in, then every other one to open instead. It is
chrome, put in the header by the shell (`HeaderExtraContext`), and opens the
screen as the tabs open theirs, so `flow.ts` stays the authority for moving
between screens (decision 20). Their tabs are an admin's without Work and
the Inbox, where nothing ever arrives for them. Carl chose the header link
over a strip across every screen (it cost height and said nothing a header
could not) and over a tab of its own (on a wide window it sat beside a
sidebar line that did the same, and a phone had only the tab).

Amended (2026-11-02, Caleb Koster): help numbers what matters first (LAN-135,
decision 199). Carl counted about 20 numbers on the recording list and asked
for the few that matter. Parts that repeat what a row already says or only
show something (a part's bars, verse marks and grip, a place between parts,
the bin, the divider, reference chips not chosen, the Bible pane while
recording) are quiet (`HelpQuiet` in `helpBadge.tsx`): dim and unnumbered,
and a tap on one still explains it, as rows that do not speak for their list
do. The recording screen numbers 7 parts (REC-059).
