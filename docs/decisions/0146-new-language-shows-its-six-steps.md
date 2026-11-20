# 146. New language shows its six steps first, asks for reference material before the review flow, sets its checks up on their own pages, and its invite can put people on checks

Date: 2026-10-20 · By: Caleb Koster · Status: partly superseded by 193

Reason: Caleb (2026-10-19): New language felt like an endless set of steps
with no idea of what comes next; its custom review setup still had a switch
joining a check to the one above, unlike a ready language's checks, where
each check picks any others it runs alongside; the review flow came before
the reference material, so it could only be picked, never said what each
check sees; and the last page, "What will they do?", read as choosing one
kind of person. He asked for the material before the review flow, for each
check to choose what of it (and of earlier checks' output) its people see,
for people to be put on checks while inviting (skippable), and for a
slideshow that reveals one thing at a time. Built:
- An overview first: the six steps (Language, Content, Split into pieces,
  Reference material, Review flow, People) down one path, each with a small
  picture, coming in one after another (none of it moves with reduce
  motion), then Start. Every page after it carries the six as a bar, done
  ones ticked and its own lit (`org/NewLanguageStages.tsx`,
  `org/stagesModel.ts`). Help mode says what each step is; the pages carry
  no sentences explaining it.
- Reference material comes before the review flow: the languages it is in
  (decision 130), then what the team will have in them, a tick per Bible,
  set of study guides and note, the old suggestion ticked
  (`org/MaterialPicker.tsx`, `useNewLanguageOffers` in `screens/org.tsx`).
- The review flow: a ready-made flow to start from (only flows in the
  team's languages or saying none, decision 84 as amended 2026-10-20, now
  that those languages are asked first), or none ("I'll choose the
  checks"), then the language's checks on the pages a ready language
  sets them up on (the list with Add a check, each check's page with its
  people, questions, what is on their screen, helps, must pass, same time as
  any others, and checked at). The language does not exist yet, so those
  pages work on a draft: the events it will start with, folded as its stream
  would fold them (`checks/languageDraftModel.ts`, held by `checks/draft.ts`), given
  to the same screen code through a ctx whose language is the draft
  (`checks/draftCtx.ts`, `useDraftAware`; `draft: '1'` on `check_editor`).
  Its people are the organization's own until people are invited. Adding the
  language sends the draft's events in its stream under ids of that language
  (`draftSpecsFor`), each language of a cluster its own copy, in place of
  the flow copied at the end (decision 91). Choosing another flow after
  changing the checks asks first. The draft's old Checks screen
  (`DraftChecks`, its "Same time as" switch) is gone.
- A step that makes something (back translation) says the language it is
  made in, on its check's page and on a library flow's step sheet, from the
  team's reference languages or the language list (`checks/IntoSheet.tsx`):
  `produces.into`, as `v1.ReviewKindDefined` and a flow's kinds already
  carry it; no new event. Caleb asked for this the same day.
- Inviting, here and from Members: "Time to invite people" (New language) or
  "Who are you inviting?" over a card per role, each with what it brings
  ("Translators"), what it lets them do one tap open (its role's switches
  that are on, and where), and its own Invite button; no radio buttons. A
  role that does checks can then be put on some of the open language's
  checks (skippable), and the code carries them: a new invite column
  `checks` and `issue_invite_v4` (migration 20261019220000), which needs
  Manage teams in that language and a role with Review; joining appends
  `v1.ReviewTeamMemberSet` for each check to the language's stream as the
  server (`redeem_invite_for`), while the inviter may still manage teams
  there. The inviter's phone names each check's team first (core
  `checkTeamSpecs`). Email invites and a code for one person by name do not
  carry checks yet.
Not built: per-Bible choices on a check's screen (a check turns the team's
Bibles on or off together, and adds a particular one as its own help);
Get ready's invite question keeps its role chips (it makes a code as it
opens, which is what counts the language as ready).
Reverse if: admins skip the overview so often it is only in the way, or
teams need checks set up before reference material is known; then the order
can change without touching the draft, which works for any step order.

Amended (2026-10-30, Caleb Koster): Reference material lists Bible Brain's
Bibles in the team's languages too, after the library's and unticked, so it
holds every Bible the language page counted (decision 84, amended
2026-10-19); Caleb asked that it show "all translations available in
biblebrain" (LAN-194). One that is ticked becomes a library item as Add a
Bible makes it (`addBibleBrainSource`), when the language is added; one
that cannot be added then is named, like any offer. The same day: the web
had shown one Bible of many on that page in a browser that cannot save
files (Safari before 26, a private window), because loading library
documents stopped at the first it could not save. Fetched documents now
stay in memory when saving fails.

Amended (2026-10-30, Caleb Koster; LAN-195): inviting is one page. Caleb
found the role invites confusing (a card per role with its own Invite
button, then a page for checks, then another for the code) and said yes to
a drawing of one page. The page opens with Translators picked and their code
already below, since most invites are for translators; the roles are tiles,
two to a row, one picked at a time, with "Other roles" for the rest and
New role first, set apart; what the picked role lets them do is one tap
open under the tiles; the checks it can be put on are chips under that, and
the code is made again once the ticks stop changing (`invites/invite.tsx`).
Share as a link, by email and one person by name are the quiet links under
Done, for the role picked. The page is the same from Manage, from Members
and at New language's last step, which now shows the translators' code at
once. Because the code is made as the page opens, New language counts
"Invite your translators" as done (an invite was issued, `invitedTo` in
`admin/ready.tsx`), as Get ready's invite question already did; counting
only invites someone used is a later change if admins find that wrong. No
new event or migration.
