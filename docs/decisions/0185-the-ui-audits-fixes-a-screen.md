# 185. The UI audit's fixes: a screen says what it waits for, asks before what cannot be undone, and opens a thing where the same thing opens elsewhere

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: a UI audit of the app (127 findings, each reproduced on the web
export and judged) found screens that said untrue things, did something
other than what they showed, or threw work away without asking. Caleb
(2026-10-28): "Please fix all of these issues." Most fixes follow rules
already recorded (one name per thing, 138; status indicators tell the
truth; touch targets; no explanatory text, as help on each element); the
ones below change what a screen does, beyond the partner demo or an
earlier entry, and are kept on purpose:
- **Asking before what cannot be undone.** Delete Account's big button is
  Cancel; "Delete My Account" is a red ghost button that asks once more by
  name (`public/delete-account.html` says so). The Inbox's report sheet
  leads with opening what was reported (the version, the review or the
  passage), and Remove is a red ghost button after it. Looks good asks
  before sending words that asked for changes. New language's ✕ and the
  sign-in code page ask before leaving (137 amended).
- **The same thing opens the same way.** An Inbox request for a check
  opens the check, as My Work's row does (`work/homeModel.ts`
  `updateTarget`; flow edges from the Inbox to review and back
  translation). A request done or withdrawn leaves the Inbox and the bell,
  on the phone and in the server's Inbox rows (core `settledUpdate`,
  `server/projectionWorker.ts`). "New in ‹language›" and a language chip on
  the Map say that they switch the whole app, and a toast says "Now in
  ‹language›". Someone with a manage role in one language gets that
  language's map from the Map tab, not a Progress list of one.
- **Saying what it waits for.** My Work says when the language is not on
  this phone yet or has no passages, instead of "Nothing is waiting on
  you". The path draws a check set aside and a checkpoint moved past (with
  its reason) apart from one that passed, and a step behind a locked
  checkpoint waits for it. Asking someone without the app saves the
  request and then offers their message to send yourself, since the app
  sends nothing. Signing out with work waiting shows it sending and opens
  Sync to see what waits. One "waiting to send" number everywhere. A failed
  password change keeps the renamed name and says so.
- **Notifications are a switch** that turns off as well as on, and when the
  phone's settings block them it says so and offers the phone's settings.
- **The sync icon has a glyph per standing** (tick, plain, crossed out,
  warning, down arrow for too old), not colour alone.
- **Finding a passage.** A book lists 25 passages at a time with Show
  more; Filter is in the book's header and the key sits above the chapter
  tiles; on a phone the sub-line names the language; with a filter on,
  chapters outside it are grey and open a sheet instead of a passage; each
  testament's chip counts its matches, and the map opens on the one that
  has them. "Divide differently" opens the chooser at once and is offered
  only to those who may write the organization's library (as MAP-023).
- **Help mode.** On the web, Listen shows only when the browser has a voice
  for the app's language (`helpContext.ts` `voiceFor`), and the tooltip
  tells a screen reader that a tap closes it. Fields and primary buttons
  with the kit's stock help get their own words; a ratchet in
  `test/helpMode.test.ts` holds the count still left (96) and lets it only
  fall.
Not done here: finding 92 (removed content leaves a trace for its author
and in History) needs new state in core and a reducer version; finding 8
and 107 (help and questions spoken on phones) wait on Caleb's choice.
Reverse if: people find the extra asks slow on work they do every day, or
partners expect the demo's flow where it differs here.
