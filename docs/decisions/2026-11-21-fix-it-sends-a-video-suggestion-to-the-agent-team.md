# Fix it on a tutorial video's card sends the fix to the agent team, which merges it on preset rules, and the video is filmed again

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-21, thread "Fix it on a video suggestion card") saw
a card on the Tutorial videos page that said the French button of the
Consultant check video reads "Faire la approbation finale". The card had
only Accept, Reject and Edit, and Accept only filed the change in Linear for
a person to fix later. He asked: "can it be an option to just fix the
problem, instead of simply sending it to linear as an issue?" He agreed to a
first design (Fix it, then a draft pull request, then a Merge tap), then
changed it: "I don't want to have to tap merge on the card. Once i give the
instruction on the tutorial video card, I want everything to get fixed
automatically and refilmed without my input, unless I explicitly give
instruction on the card that my future input will be needed before applying
a fix, or the fix applies to the rules we'd preset before (i.e., when claude
auto fixes it vs when a dev's input is needed). The chain of events should
be visible in the conversation thread with claude on the relevant video
tutorial card." He chose the rules below ("Yes, use the rules"). Decided:

- **Fix it.** A suggestion about the app (kind `code`) that waits for an
  answer has Fix it beside Only file in Linear. A change to a video that
  failed has Fix it in the app. Fix it accepts the suggestion and files it
  in Linear at once (`ops_suggestion_fix_in_app`, `opsActions.ts`). Once its
  issue is known, an instruction for that issue waits for the agent team
  (`ops.user_issue_notes`, `named` and `go`), and the watch hands it to the
  fix jobs within 15 minutes, as an instruction on a user issue.
- **The video fix run hands one over by itself.** When Claude finds that the
  cause of an accepted change is in the app, not the video (fix.json `app`),
  and a person accepted or wrote that change, it goes to the agent team as
  if that person had tapped Fix it (`ops_tutorial_fix_to_app`). A clear fix
  that Claude accepted itself does not: its card asks a person.
- **The admin's Fix it is the yes.** The fix merges with no person, also
  while the agent team's mode is `ask`, only when all of these are true
  (`gate` in `scripts/agent-team.mjs`, `go`):
  1. It changes only app screens or words (`apps/mobile/src`, its i18n
     files included), `apps/admin/src`, `packages/core/src`, and tests.
  2. Claude proved the cause on main, and the change does only what was
     asked (verdict `fix`).
  3. A test proves it. For a screen's look, pictures before and after prove
     it (a display fix).
  4. Typecheck, the tests, the second Claude and guardrails pass.
  5. No instruction on the card asks to see the change first.

  The fix waits for a developer when it touches the database, sync, the
  server, sign-in, who may do what, packages, native code, build or store
  settings, workflows, secrets or privacy, when it changes the library
  (that needs a seed), or when it needs a product choice the admin did not
  make. These are the paths and verdicts the gate refused before; nothing
  new merges outside them. When a fix that merges fails to get into main 3
  times, it waits for a developer, as any fix of the team
  (2026-11-19-an-agent-team-fixes-user-issues.md, amended 2026-11-20).
- **"Ask me first".** Fix it has the box "Ask me before it merges". An
  instruction on the card that asks the same in words ("ask me first",
  "wait for my yes", "don't merge") does too (`saysAskFirst`), and so does
  the issue's manager when it reads the instructions so (`askFirst` in
  fix.json). Then the fix waits, and "merge it" on the card merges it as
  it is, as on a user issue.
- **Filmed again at once.** When the agent team's pull request merged, the
  next video fix run (:20 and :50 each hour) films the video again in its
  language (tutorials.yml's workflow_dispatch, `refilm` in
  `scripts/tutorial-review.mjs`, `ops_tutorial_app_refilmed`), not at the
  next night. It waits while a film run goes, so that a second run in the
  `tutorials` group does not cancel the first.
- **One card shows the chain.** A fix in the app has one card (`appFix` in
  `apps/admin/src/sources/videos.ts`) from Fix it to a day after the new
  film. Its steps are You asked, Claude fixes the app, Checks, Merged and
  Filmed again. It is Claude's turn at each step, and it waits on the admin
  only when they asked to see the change first, when the rules need a
  developer, or when the team made no change; then it says why. Its record
  (`diag.ops_card_record`) holds each step: the Fix it tap, the handover,
  the agent team taking the instruction, its answer and its record of the
  fix, the merge with the video sent to be filmed again, and the new film.

Every merge into main is a public release, so a fix that
merges with no person reaches people at once. That is why the five rules
are the agent team's rule as it was, with only the developer's read taken
away for a change the admin asked for in words.

Considered: a Merge tap on every fix in the app (Caleb's first yes; he did
not want to tap Merge each time); turning the agent team's mode to `on`
(every fix of every user issue would merge with no person, which nobody
asked for); fixing the app in the video fix run (that run may change only
`e2e/tutorials`, and its pull requests merge with no person, so it must
not reach the app); filming again at the next night (up to a day late).

Reverse if: a fix that merged this way breaks something people use, or
admins find that they want to read each change before it merges.
