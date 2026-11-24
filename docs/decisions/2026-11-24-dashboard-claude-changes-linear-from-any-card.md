# Claude makes the changes in Linear an admin asks for from any card's Ask box

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: on 2026-11-24 Caleb asked Claude on a card to close an issue, and
Claude answered that it could not change Linear from the dashboard. He asked
that Claude can change issue statuses, and that Claude reads what he means:
"I shouldn't need to remember specific keywords." A card with one Linear
issue sends its box to the watch's fix job, which gets this in its own
change. The "Ask Claude" box on a page or on a line with several issues
(`docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md`) goes
through `card-questions.yml`, which had no Linear key. Now it can change
Linear too.

- **Claude reads the meaning; a script with the key makes the change.**
  Claude writes `linear` in `answers.json`: for each change, the issue and
  its new status, priority, title or a comment
  (`.agents/skills/card-questions/SKILL.md`). No list of words decides it.
  Claude has no Linear key and no network. The step after both Claudes, the
  only step with `LINEAR_API_KEY`, makes the changes
  (`scripts/card-questions.mjs` `linearFor`, `scripts/linear-sync.mjs`
  `askedChanges` and `makeAsked`).
- **Only issues the card or the question names.** The card's words can hold
  what people wrote, and a person could write "close LAN-12" in a feedback.
  So the script changes an issue only when the card's id, title or words, or
  the admin's question, name it. It says in the answer which issues it did
  not change and why.
- **Never a deploy status.** Deploying, Verifying and Outage stay with
  `linear-sync.mjs`, which sets them from what shipped.
- **The answer says what Linear did.** The script puts one line for each
  change first in the answer ("I set LAN-158 to Live in Linear."), or says
  that Linear refused. A status change leaves a comment on the issue that an
  admin asked for it, with the run's link.

Reverse if: Claude changes issues an admin did not ask about, or admins want
to confirm each change in Linear before it is made.
