# The issue manager writes an issue's card, and a naive reader checks it

Date: 2026-11-25 · By: Caleb Koster · Status: accepted

Reason: Caleb, on LAN-339's card ("A key word recording stays waiting to
upload while the phone is online"): "horribly ambiguous and unhelpful. I
read it and have no idea what it's talking about. The sentences are
grammatically messy and unclear ... and I don't have the information I
need to make a decision." He asked for a test with a reader that knows
almost nothing about the app. That reader, given only the card's text, was
2 of 5 sure what to do. The card kept every rule of the word standard
(decision 2026-11-24-every-dashboard-card-follows-one-word-standard), so a
word check alone was not enough.

What went wrong on the card:

- The watch wrote Wrong and Known before anyone looked at the cause, and
  nothing replaced them after Claude proved it. Known even said the
  phone pushed nothing; the recording went up when the app opened again.
- The choice Claude asked for ("1. Keep the limit of 2 minutes. 2. Use a
  longer limit") was only under Details. Next said "PR 716 waits on its
  merge" and repeated the title.
- The step line showed the cause in file and code names, cut by the
  database at 300 characters ("the run holds t"), then "Issue manager:
  Opus, high effort."
- Nothing said what the app part was, whether work was lost, who else can
  have it, or what each choice leads to.

What changes:

- **The manager writes the card.** `fix.json` has `card`: a title, About
  (from high up), Events (what happened, as 2 to 6 numbered events, each
  with its time in the reader's clock and the bug marked; Caleb found his
  own numbered list easier to read than the paragraph), Known
  (what is safe, who else can have it) and the choice: a question and 2 to
  4 options, each with what happens after it, the recommended one first.
  The Worker checks it (`server/userIssues.ts` `parseIssueCard`), the
  database keeps it in `ops.user_issue_cards`, one row for each issue, and
  the dashboard shows it in place of the watch's lines.
- **Every open issue has a card, not only the ones with a fix.** Caleb,
  2026-11-26: "change other cards' wordings similarly. Almost all of the
  other cards on the dashboard are similarly confusing and unhelpful." The
  watch writes a first card (no choice yet) when it files an issue, and
  the job `cards` (dispatch with `cards`) writes every open issue's card
  again. The choice shows only when a person must decide now; else Next
  says what happens next. The card has its own table, not a column of the
  fix record, so that three writers can keep it.
- **A naive reader checks it.** `node scripts/card-words.mjs --naive
  fix.json` prints a prompt with only the card's text and one line about
  the app. The manager gives it to a new worker and mends each line the
  worker got wrong, at most twice. The workflow lets the manager run the
  checker.
- **Details hold the developer's words.** A step says only what happened;
  the cause in code words and the manager's model stay under Details.
  Without a manager's card, Next shows the fix's `why`, and the pull
  request's title only when it says more than the card's title.

Considered: a second workflow step with its own Claude as the naive reader.
Rejected for now: the manager already starts workers, and it can mend the
card in the same run. A workflow step could only fail or pass the card.

Reverse if: the naive reader's checks cost more than they save, or cards
written this way still leave Caleb without what he needs to decide.

Proof: LAN-339's card, written again by these rules
(`apps/admin/test/cardWords.test.ts`), made a new naive reader 4 of 5 sure.
