# A change to a video that failed learns the pull request that fixed it, once a new film is in

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: Caleb's instruction on the card of "How LangQuest works" in French
("Fix the capitalization in the app, refilm", suggestion f8c4546f) failed in
the video fix run, because the capital came from the app's French words. PR
633 then changed those words, and the video was filmed again with no problem
at 15:16 (UTC-7). The card still said "Claude could not make the change"
under Waits on you: only a fix made by the video fix run or by Fix it
(2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md) moves a
card, and this fix came by a pull request of its own. Caleb wants no taps
from him once he gives an instruction on a card, and the dashboard's states
must tell the truth. Decided:

- **The video fix run looks.** At each run (:20 and :50), `queue` in
  `scripts/tutorial-review.mjs` gets each change of the last 30 days whose
  fix failed, that did not go to the agent team, and whose video has a film
  in the suggestion's language newer than the failure (ops_tutorial_fixes
  `failed`). It reads the pull requests merged into main since then.
- **Which pull request fixed it.** One merged after the failure and before
  that film that names the suggestion (its first 8 characters, for example
  "Fixes video suggestion f8c4546f"), or else one that changed a file Claude
  named as the cause when the change failed (the fix note, for example
  `apps/mobile/src/i18n/fr.json`). The video fix run's own pull requests
  (`tutorial-fix/...`) do not count. The first one in time wins.
- **The database checks the film.** `ops_tutorial_fixed_elsewhere` keeps it
  only when a film of that video and language came in after the merge. A
  film in `ops.tutorial_videos` is one that passed the frame check, so the
  problem the frame check saw is gone from it.
- **What the dashboard says.** The card "Claude could not make the change"
  goes. For a day a card "Fixed by PR N, filmed again" says which pull
  request, which file, and that a new film came in; it waits on nobody
  (Done). Changes made says "Fixed, filmed again" and links that pull request in place of
  Failed, and the card's record has the step. Try again on the change makes
  a new fix, and the old answer no longer counts.

The words name the evidence (the pull request, the file, the new film), so
an admin who doubts them can open the pull request and the film. A pull
request that changed the named file for another reason, while the problem
stays, would still show; the new film passing the frame check makes that
rare, and a person who sees it can tell Claude what to do on the video's
next card.

Considered: asking Claude to read each candidate pull request and the new
film (a sure answer, but a Claude run each time for a rare case); matching
any pull request that changed the video's own script (other fixes change it
too); marking the change fixed with no new film (the frame check has not
seen the fix then).

Reverse if: a card says "Fixed by PR N" while the new film still shows the
problem.
