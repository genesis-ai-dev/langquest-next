# 127. What people make has no Save button: it is kept as it is made, private until Done, and Done sends it on

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-15): "It's strange that we would have a save button.
Everything should be automatically saved", with a spinner turning into a
check to show it, and what people make should be "saved but only accessible
by the creator while unpublished, and once published, accessible to
others." He also asked for something clearer than Publish, with the
easiest next step being to send the work to the preferred people for its
next check. The app had about twenty Save or Publish buttons and four
"Leave without saving?" dialogs; a recording's parts were already kept as
they were made (decision 83), while a review in progress, a note being
typed or an editor's changes lived only on the screen. Chosen:
- **The saved mark.** `apps/mobile/src/ui/SavedMark.tsx` sits in a
  header or sheet: a spinner while something is being kept, then a check
  (`useSaveStatus`, at least 600 ms of spinner so the change reads), a
  warning when it failed. It explains itself in help mode.
- **Drafts on the phone, only for their maker.** `apps/mobile/src/drafts/`
  keeps what someone is making in AsyncStorage as it changes
  (`useDraft`, written 400 ms after each change and when the screen
  closes; keys from `draftKey` always name the person, so a shared phone
  never shows one person's draft to another and account deletion removes
  them). Used for a review in progress (answers, voice, moments, who
  listened), notes, key words, a back translation's notes, what is said on
  Done, and the template, flow, material, guide and divide-your-own-way
  editors. A recording's parts stay on the record as before (decision 83).
  No new event: an unfinished thing is not on the record.
- **Finishing is named for what it does for others.** The recorder's and
  back translation's Publish is now Done; a note's button adds it; a
  review's verdicts are unchanged and "Save to the record" is Done; an
  editor's Save or Publish is Done. Leaving keeps the draft, so every
  "Leave without saving?" is gone.
- **Done sends it on.** Done opens one last look at the version (hear it,
  say what changed) whose main button asks whoever usually does the check
  that comes next ("Ask Rebecca Nyibol"), publishing and asking in one
  write with Undo taking the asking back; "Someone else" and "Send later"
  finish it too. `nextAfterDone` (`passage/recordModel.ts`) works out that
  check before publishing, as the record will after it: feedback the new
  version answers goes back to its reviewer, a back translation once made
  is done. The "Version N published" page after publishing is gone, since
  asking happened on Done.
- **Shared settings keep their Save button** (Caleb, 2026-10-16: "we don't
  want the org name dynamically changing with every stroke for every user
  in the org"). An organization's or language's name, a cluster, a role's
  permissions, a member's role, a book's name, a check's questions and
  people, report targets and a profile name change things for everyone, so
  they apply only when saved, as before.
Amends 83: the workspace's Save, which only said the draft was kept, is
gone; the mark says it. What stays as it was: a draft's events still reach
the server and teammates' phones (they see "Recording in progress" and
cannot play it); making a draft private in the sync itself would move it to
the person's stream, which this does not do. Caleb chose to keep it so
(2026-10-16): teammates cannot play a draft, and the server copy is its
backup.
Reverse if: people lose work because a draft lives on one phone (then
drafts move to the person's own stream, which only they can read), or
teams want to look a version over before anyone is asked (then Done
publishes and the asking moves back to the record).
The passage's "Then the team" checks are cards again, each with its state,
status and people and space around it: PR 72 had made them one-line rows
and PR 92 stacked names under them with no room between.

Amended (2026-11-02, Caleb Koster): "Send later" is now "Done, don't ask
anyone", a button of its own under the asking links (LAN-136, decision
199): it finishes the version and asks nobody, which "later" did not say.
