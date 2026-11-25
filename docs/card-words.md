# The words on a dashboard card

Kind: reference

Every card on the ops dashboard, and every line Claude writes for one, follows
this standard. Caleb Koster set it on 2026-11-24, after a card said "Claude
could not make the change" with no reason and a paragraph of file paths
(docs/decisions/2026-11-24-every-dashboard-card-follows-one-word-standard.md).

The reader opens the card fresh. The reader does not know the code, the
logs or what happened before. The reader often reads on a phone, between
other work.

## The shape of a card

1. **What this is about.** Start from high up: which part of the system
   (a tutorial video, the app, a server job, a store), which language or
   screen, and what a person sees. One or two sentences.
2. **What is wrong, or what was asked.** Zoom in one step: what goes wrong,
   for whom, and how much. Two or three sentences.
3. **Why Claude stopped**, on a card that says Claude could not act. Say one
   of the reasons below, never only "Claude could not".
4. **What you can do.** One recommended action, as the card's main button.
   Other actions are smaller, or behind a tap.
5. **Details**, folded: files, code words, ids, commands, logs and runs.
   Only a developer needs them.

## The words

- Sentences of 25 words or fewer; one fact in each sentence.
- The active voice: the person or the thing that acts comes first
  ("The filming draws the light", not "The light is drawn by the filming").
- One name for each thing, and the name a person uses. No coined labels,
  no idioms.
- Start with the name of the thing, not "It", "This" or "They".
- No file path, file name, code word, id, commit, table, token, command or
  SQL outside Details.
- No time as minutes only (":20"). Say "within 30 minutes" or "at 10:00 UTC".
- A card line has 70 words or fewer; a title has 20 or fewer.
- A choice that only a person can make is a numbered list of options, the
  recommended one first. Never ask a person to do a step Claude can do.

## Why Claude stopped

A card that says Claude did not act names one reason
(`scripts/card-words.mjs` `WHY_STOPPED`). Each reason has fixed plain words,
what the person can do, and the recommended action.

| Reason | Who gives it | Recommended action |
| --- | --- | --- |
| A person must choose | Claude | Tell Claude which way to take |
| The cause is in the app | Claude | Fix it in the app |
| The video needs new test data | Claude | Try again, after the data is added |
| Claude did not see the problem | Claude | Tell Claude where it shows |
| Claude did not understand the request | Claude | Tell Claude in other words |
| The tests failed | The workflow | Try again |
| The change did not merge in time | The workflow | Try again |
| A safety check stopped it | The workflow | Try again, or tell Claude |
| Claude did not have access | The workflow | Repair the access, then try again |
| The job stopped with an error | The workflow | Try again |
| No reason recorded | Older records | Read Details, then try again |

Claude gives its reason in `fix.json` as `why`, with `plain`: one to three
sentences for the card. For "A person must choose", `plain` lists the
choices as "1. ... 2. ...", the recommended one first. The technical reason
stays in `noFix`, which goes under Details.

## An issue's card

The watch for user issues writes an issue's first lines before anyone
looked at the cause. Those lines are a guess. The issue manager proves the
cause, and then writes the card again in `fix.json` `card`
(`.agents/skills/user-issues/SKILL.md`, "The card for your issue"). The
dashboard shows the manager's card in place of the watch's lines:

| Line | What it says |
| --- | --- |
| Title | What goes wrong, as a person sees it, for all who can have it. |
| About | From high up: the part of LangQuest, what a person did and saw. Each word of the app a newcomer may not know, explained. |
| Wrong | One step closer: what goes wrong, and the proven cause, in words about the app. |
| Known | What is safe: lost work, whether the person is still stuck, who else can have it. |
| Decide | The one question, what the change does, then 2 to 4 options. Each option says what happens after it. The recommended one is first. Doing nothing is an option. |

The cause in a developer's words, the reasons, the reviewer, the issue
manager and the run stay under Details. A step on the card says only what
happened. Without a manager's card, the Next line shows the fix's `why`,
so the choice is never behind Details.

### A naive reader

A word check sees short sentences, not a card that says nothing a person can
act on. LAN-339's first card kept every rule of the word check, and a new
reader with no context was 2 of 5 sure what to do. So the issue manager
gives the card to a naive reader before it finishes:
`node scripts/card-words.mjs --naive fix.json` prints the prompt (the card's
text and one line about the app, `NAIVE_CONTEXT`). A new worker with no tools
answers what the problem is, what the cause is, what each option leads to,
what is unclear and how sure it is. The manager mends each line the reader
got wrong, at most twice. The card for LAN-339 that Claude wrote this way
made the reader 4 of 5 sure.

## How the standard is kept

- `scripts/card-words.mjs` holds the rules. The dashboard, the checks of
  what Claude wrote, and the tests use this one file.
- `apps/admin/test/cardWords.test.ts` reads every fixed text the Tutorial
  videos page builds. A text that breaks the standard fails the test.
- The tutorial look's `check` step lists Claude's words that break the
  standard, and Claude mends them before the look is sent.
- The watch for user issues runs
  `node scripts/card-words.mjs .user-issues/decisions.json` and mends each
  line it prints before it finishes.
- The issue manager runs `node scripts/card-words.mjs .user-issues/fix.json`
  on its card, then the naive reader (above), and mends the card.
- `apps/admin/test/cardWords.test.ts` holds LAN-339's card as Claude wrote it
  again: it keeps the standard, and the naive reader's prompt has only the
  card's text.
- On a card, Claude's plain words that break the standard go under Details;
  the fixed words of the reason stay in view.
