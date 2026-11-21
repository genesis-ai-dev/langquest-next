# 186. Claude looks each night at what came in about the tutorial videos and suggests changes; a person accepts, edits or rejects each on the ops dashboard

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked for an AI such as Claude to weigh, for each video, every
input not yet answered (comments on YouTube, code changes, notes the team
leaves on the ops dashboard) and suggest changes to its screens, script or
voice, to the app's code (to Linear), or a new video, with the inputs and
suggestions on the dashboard for a developer to accept, edit or reject. He
chose GitHub Actions signed in to his Claude plan over a routine in his own
account, so the system is in the open for the team: any developer can see
it, and replace the token with their own plan's if his has trouble. Decided:
- **Inputs and suggestions are rows in `ops`** (migration
  `20261029120000_tutorial_feedback.sql`): `ops.tutorial_inputs` (a
  comment, a code change or a note), `ops.tutorial_suggestions` (script,
  screen, voice, code or new) with the inputs each answers, and one
  `ops.tutorial_reviews` row per look. Only the service role writes them;
  the dashboard reads `diag.ops_tutorial_feedback`. An input is open until
  Claude looks at it, or while a suggestion that answers it waits.
  Inputs and answered suggestions over a year old are taken out.
- **The comments job only reads** (`server/tutorialComments.ts`, job
  container, 23:50 UTC): each connected channel's new comments become
  inputs. Making sense of them is the look's. It also files in Linear the
  accepted code changes the Worker could not, 20 a night at most.
- **The look runs on GitHub Actions on a Claude plan**
  (`.github/workflows/tutorial-review.yml`, 10:00 UTC):
  `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token`, kept encrypted in `.env.production` and set as a
  repository secret by `npm run secrets`. It uses the plan's five-hour and
  weekly limits, not an API bill; Caleb chose no cap, as he does not use
  the plan at that hour. Claude follows the `tutorial-review` skill.
- **No production key in GitHub.** The workflow reads what is open and
  sends its look through the app Worker (`/api/tutorial-review`), which
  lets in only this workflow on main by the OpenID Connect token GitHub
  signs for the job: issuer, audience, repository, `workflow_ref` and `ref`
  checked against GitHub's keys (`apps/web/worker/githubOidc.ts`). No
  shared secret to leak or rotate.
- **Comments are untrusted.** Anyone can write one, so Claude gets no
  network, no token and no shell beyond reading git; its one output is a
  file the Worker checks (`parseReview`, `server/tutorialFeedback.ts`) and
  the database checks again; and nothing it suggests happens without a
  person. The replies it writes are shown to copy into Studio, never posted.
- **Code changes come in through the look**, from the changes merged into
  main since the last one, and only where a video's words or steps no
  longer fit; a screen that only looks different is filmed again by the
  nightly filming (183).
- **The dashboard decides** (Tutorial videos → Feedback and suggestions;
  162 amended): Accept, Edit, or Reject with why, which the next look reads
  before suggesting the same again; Add a note. An accepted code change
  becomes a Linear issue.
- **Not yet:** making an accepted script, screen, voice or new-video change
  is by hand. Building it as a pull request with a preview film is a later
  change.
Reverse if: the looks eat into the plan's limits when people need them;
more suggestions are rejected than accepted for weeks (then keep the
inputs and drop the suggestions); or GitHub changes what its OIDC tokens
say.

Amended (2026-11-03, Caleb Koster): comments are kept 30 days, not a year.
Google's audit for more YouTube API quota (Caleb, 2026-11-02, thread "Plan
tutorial videos and keep them current") checks how we keep YouTube data,
and YouTube's developer policies let an API client keep what it reads about
other people for 30 days before it must read it again or delete it. Caleb
said yes (2026-11-03) to one change that makes us pass: a comment, with its
English and suggested reply, is taken out 30 days after it was posted,
whether or not Claude has looked at it or a suggestion that answers it
waits (the suggestion stays without it); one older is never copied, and the
comments job reads back no further (`KEPT_DAYS`). An hourly pg_cron job
takes them out (migration `20261103190500_tutorial_comments_30_days.sql`),
so a stopped comments job or look keeps nothing longer. The privacy policy
gains a part on our YouTube channels (`/privacy#youtube`: YouTube's Terms
of Service and Google's Privacy Policy, what we copy, Claude, the 30 days,
how to take away a channel's access), and the videos page (187) links it.
Code changes, notes and answered suggestions keep their year. A comment
Claude has not looked at within 30 days, because the look stopped running,
is lost to it.

Amended (2026-11-13, Caleb Koster): the comments job reads first in
YouTube's day, at midnight in California (`apps/web/worker/jobsModel.ts`),
not at 23:50 UTC. The publish job's uploads that day had used up the
project's units by then: on 4 to 9 November 2026 the job read 0 to 11 of
the 16 channels and stopped on `quotaExceeded`. Reading a channel's new
comments costs a unit a page; at midnight the day's 10,000 are all there,
and the intake and the uploads come five minutes later.

Amended (2026-11-13, Caleb Koster): the dashboard shows the videos as one
list for each app language, in place of the filming table and the
suggestion cards. Each video's row has its state, a day-by-day timeline
(zoomed with a pinch; a click on a mark shows the change, the films before
and after, the comment as written, the PR or the log) and, at its right, a
warning mark when an admin must act. The mark opens that video's cards: the
problem, who acts next, what happens if nobody does, and a box to tell
Claude what to do; Claude's next fix run takes that instruction as already
approved. Beside the list, what waits on an admin that is not one video's
(publish, connect a channel, paused languages) and what the workers do now
and tonight. Caleb asked for this so one page says what waits on him, and
so that he gives Claude directions before the night's run instead of
opening logs. The history comes from `ops.tutorial_videos`, which already
keeps every film (`diag.ops_tutorial_films`, migration
`20261113234000_tutorial_films.sql`); the causes, holds, failures and slots
from the nightly's `status-<language>.json` in the public release; a fix's
state from its suggestion. A suggested reply shows for 14 days, since
nothing records that someone posted it.

Amended (2026-11-13, Caleb Koster): Claude makes an accepted change to a
video's script, screens or voice, as a draft pull request; the "Not yet"
above is done, without the preview film. Caleb (2026-11-13, threads "Make
comments and screen changes update videos" and "Show the tutorial video
pipeline for the last week") found a comment on "Choose the app's
language" that nothing came of, and gave a video's states as waiting for
admin approval, working on fix, and waiting for admin to merge the pull
request: a person accepts first, then Claude works. Every 30 minutes the
same workflow's fix jobs start at most three accepted changes, as the watch
for user issues makes its draft fixes (202): Claude changes only
`e2e/tutorials/<video>.ts` and `e2e/tutorials/lines/` in a checkout with no
key; a job with no key applies the patch and runs the videos' typecheck and
tests; a job that runs nothing of it opens the draft pull request with the
built-in token, which links what it answers and never quotes a commenter. A
person marks it Ready for review and merges it, and the merge films the
video again (183). Each suggestion keeps where its fix is (migration
`20261114010000_tutorial_fixes.sql`): working, open, merged, closed or
failed with why, read and written through the Worker's
`/api/tutorial-review/fixes`. A code change still goes to Linear and a new
video is still made by a person. Caleb (2026-11-13) also asked that an
admin see each problem (a comment, a screen change, a film that failed or
was held) and write what Claude must do with it: that instruction, sent
from the dashboard's card, is an accepted suggestion at once (kind
`instruction`, `ops_tutorial_instruct`), and Claude reads the film's log,
the screen where it stopped, the frame check and the video's state with
it. Reverse if: more of Claude's fixes are
closed than merged for weeks, or they eat into the plan's limits when
people need them.

Amended (2026-11-16, Caleb Koster): Claude fixes a video by itself when
the fix is clear, and every video fix merges itself. Caleb (2026-11-16,
thread "Automate tutorial video fixes") found that the fix flow asked too
much of him: Claude should judge each comment and app change, make a fix
that is clearly needed (pull request and merge too) with no person seeing
it but a record kept, and wait for a developer's answer on the ops
dashboard only when one is needed, as the only input a person gives. Claude
changes only the videos, never the app. Decided (migration
`20261116210000_tutorial_clear_fixes.sql`, the `tutorial-review` skill):
- **The look sorts each input.** A change to a video's script, screens or
  voice that is wrong against the app on main, with one right fix that
  Claude checked, is `clear`: the Worker and the database accept it at once
  (`clear`, `decided_at`, no `decided_by`). A viewer's wish, a choice of
  what to teach, the app's code and a new video still wait for a person.
  The look also reads each language's `status-<language>.json`, so a film
  that failed or was held becomes a suggestion, with the film's language.
- **A video fix merges itself.** The pull request is opened, not as a
  draft, with the token of LangQuest's own GitHub App (the release-branches
  App, `RELEASE_APP_ID`), so guardrails run at once, with auto-merge on;
  the merge queue merges it when `gate` passes. The push stays with the
  built-in token, which cannot change a workflow. A fix run closes a pull
  request whose `gate` failed or that has not merged within 24 hours, and
  its fix is `failed`, which asks a developer on the dashboard. A fix that
  finds the video already does what was asked is `unneeded`, not failed.
- **Two checks before a pull request opens.** A fixed rule (`codeRefusal`,
  `scripts/tutorial-review.mjs`) refuses an added line in a video's file
  that reads a file, the environment or the network, runs another program
  or code from text, or reaches into the page beyond Playwright's own steps;
  and a second Claude, which reads only the patch and never the comment or
  the suggestion, says whether it only changes what the video shows and
  says. Either one stops it, and the fix fails with why.
- **The record** is the dashboard's "Changes Claude made to the videos":
  each fix of the last 30 days, who said yes (Claude, an admin, or an
  admin's instruction), its state and its pull request. An open fix is a
  worker's item, not an admin's card. A held or failing film waits on
  Claude's next look first, and on an admin when that look made nothing for
  it or what it made was rejected.
Considered: the organization setting "Allow GitHub Actions to create and
approve pull requests": its pull requests start no checks, so they can never
merge themselves, and it would apply to every repository in the
organization, which Caleb did not want. Reverse if: a clear fix that merged
has to be taken back more than once a month, or Claude's fixes fail their
checks more often than they pass.

Amended (2026-11-17, Caleb Koster): each suggestion about a video shows
pictures of what it is about, and is written for an admin first. Caleb
(2026-11-17, thread "Show pictures on tutorial video suggestion cards"): a
card that said "the dim backdrop is half drawn at the last step in fr and
es ... status-fr.json (1:21) ... step 12's `until`/`stay`" left him unable
to tell what it was about, so he could not answer it. Decided (migration
`20261117193000_tutorial_pictures.sql`, the `tutorial-review` skill):
- **Claude picks the pictures.** The look downloads the last film run's
  pictures in each language it reads (`tutorials-<language>`: each step's
  screen, the stills the frame check found wrong, the screen where a film
  stopped), and Claude gives each suggestion one to six, each with a plain
  caption and, where it sees the place, a ring (`ring`, parts of the
  picture). Claude looked at the pictures; a script that picked "step N"
  out of the words would show the wrong place whenever the words named
  none. A film now keeps its dry run's step pictures (`film.ts`), which it
  used to delete, so the videos that change most have pictures too.
- **Kept by hash in R2, read by anyone.** `send` puts each picture through
  the Worker (`PUT /api/tutorial-review/pictures/`, this workflow on main
  only, by its OIDC token), and only one whose hash the workflow listed
  before Claude ran. A suggestion keeps the names (`pictures`, and
  `after_pictures` once its fix is merged and filmed again). They are
  served at `/api/tutorial-pictures/` with no sign-in, as the films are,
  so the fix's pull request can show them too: they are stills of public
  videos and screens of their test data. The ring is drawn by the
  dashboard over the picture, so the picture stays as the film run made it.
- **Plain words first.** The skill has Claude write the title and the start
  of the detail in ASD-STE100 plain English for an admin, naming the
  pictures, and the technical part after a line "For the fix:", which the
  dashboard folds away. The fix still reads the whole detail. A suggestion
  made before that still waits for a person, and that no admin edited, gets
  its words again from the next look (`title` and `detail` on its
  `pictures` entry), so the cards Caleb could not answer become readable;
  an admin's edit is never written over.
- **A small ring is shown zoomed in.** A film still is a wide frame with the
  phone in a quarter of it, so a picture whose ring is small shows that
  part, with space round it, and a click opens all of it.
Considered: frames cut from the film in R2 at each step's time (a held or
failed film is never put in R2, and the step times are not kept), and the
pictures in the public `tutorials` release (a release holds at most 1000
files). Reverse if: pictures are wrong for what a card says more than once
a week, or R2's `tutorial-pictures/` grows past 1 GB (then take out those
no suggestion of the last year names).

Amended (2026-11-19, Caleb Koster): a suggested reply waits until a person
says what became of it, in place of showing for 14 days. Caleb (thread
"Make tutorial videos dashboard page clear") found the reply's card had
nothing to press. Its card now copies the reply and opens the comment on
YouTube, and takes Done or No reply needed
(docs/decisions/2026-11-19-the-tutorial-videos-page-opens-on-what-waits-on-you.md).
The reply is still posted by a person on YouTube, never from the dashboard:
the reason above (a comment is untrusted) stands. The answer is kept on the
comment (`reply_done`, with when and who; migration
`20261119171500_tutorial_reply_done.sql`) and goes with it after 30 days.

Amended (2026-11-21, Caleb Koster): a suggestion whose fix is in the app
can now be fixed from its card. Fix it sends it to the agent team, which
changes the app; the fix merges on the team's rule with no tap unless the
admin asks to see it first, and the video is filmed again as soon as it is
in main. When Claude finds that the cause of an accepted change is in the
app, the change goes to the agent team by itself
(docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md).
