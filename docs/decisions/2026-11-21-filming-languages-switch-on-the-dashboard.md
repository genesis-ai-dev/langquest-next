# The ops dashboard's switches choose the languages the tutorial videos are filmed in

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: the languages filmed each night were the `NIGHTLY_LANGUAGES` line in
`.github/workflows/tutorials.yml` (decision 183), so pausing or turning on a
language took a pull request. Tagalog was added on 2026-11-05, after filming
went to English only, and was never filmed; its channel stayed empty and the
page only listed it among the paused languages. Caleb asked for a way to
pause and unpause filming for each language on the dashboard, and chose "a
switch on the dashboard that works at once" over a button that opens a pull
request.

- **Where the choice lives.** `ops.tutorial_filming`, one row per language a
  person set (migration `20261121220000_tutorial_filming_switch.sql`); the
  three filmed before (en, fr, es) start on, so the merge changes nothing.
  Only the service role writes it, through the dashboard action
  `tutorial-filming` (`apps/web/worker/opsActions.ts`), recorded in
  `ops.actions` as `filming_on` or `filming_off` (decision 162).
- **How the filming reads it.** The `languages` job asks the Worker's
  existing door, `GET /api/tutorial-filmed`, with its GitHub OIDC token
  (`e2e/tutorials/films-in.mjs --languages`, decision 192): the workflow
  still holds no production key. Off main, or when the Worker does not
  answer, it films `NIGHTLY_LANGUAGES` as before and says so on the run.
- **Turning on asks once more.** The first night of a language films every
  video (about 47) and its uploads take days of YouTube's limit, so Turn on
  filming asks "Film N videos at 20:10 UTC?" before it acts. Pause is one
  press: the videos already on YouTube stay.
- It starts at the next filming (20:10 UTC); the switch does not start a
  run itself, because the dashboard holds no GitHub key.

Reverse if: the filming must not depend on the Worker (then go back to the
workflow's list), or turning a language on should film at once (then the
Worker needs a way to start the workflow).
