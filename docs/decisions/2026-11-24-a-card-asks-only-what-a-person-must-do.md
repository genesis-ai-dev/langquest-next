# A user issue card asks a person only for what a person must do, in plain words

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb, on the card of LAN-313 ("Snapshot staging table is full of
dead rows"): "LAN-313 is worded extremely poorly. I have no idea what's
going on." The card said "Claude needs your choice", then asked him to
"give Claude's shell in the fix job the job's OIDC token or
CLAUDE_READ_TOKEN" or to run an SQL read, then told him which file to
change. Its button read "OpenLAN-313in Linear".

What the records showed on 2026-11-24 (production, `ops.user_issue_fixes`):

- The manager wrote LAN-313's record on 2026-11-22, before the fix team
  could read production (PR 661, merged 2026-11-23). It said `decision`
  because it could not run the read. LAN-300 and LAN-298 have records of
  the same kind. The watch never hands a `decision` back, so the three
  cards still said "Waits on you" a day after Claude could do the read.
- The read itself, from a cloud thread: the database's cleanup ran about
  a minute after each of the last cuts (02:25:55 cut, 02:27:00 cleanup;
  01:51:03 cut, 01:52:36 cleanup of the snapshot rows). So the line was a
  false alarm: the staging table is empty and all dead for that minute
  after each cut, every time.

What changes:

- **The dead-rows line leaves out the tables a job fills and then empties
  at once** (`QUEUE_TABLES` in `apps/admin/src/sources/ops.ts`, now only
  `public.snapshot_units_staged`). A queue that the cleanup stopped
  cleaning still shows as a table that grows, among the largest tables.
- **Missing access is never a choice for a person.** The user-issues skill
  says: a read of production or of a log goes in `next.reads` with
  `unconfirmed`; never ask a developer for a token, a key or a read.
- **Words on a card.** Every line Claude writes for a card is for an admin
  who does not know databases or code: what people see or what it costs,
  no table, setting, file, token or SQL, ASD-STE100 sentences, and a choice
  as numbered options with Claude's recommendation first. The technical
  detail goes in the cause, the plan, the pull request and Linear's Agent
  notes.
- **The old cards come back once.** `ops_user_issue_order()` names, as
  `again`, each open issue whose record is a choice for a developer with no
  pull request, written before 2026-11-24 06:00 UTC, and not handed over
  since. The fix team takes each once, in the usual order.
- **A mark on an issue number keeps its spaces.** The page wraps the text
  and its marks in one span, so a flex box (a button) keeps "Open LAN-313
  in Linear" as one piece of text.

Reverse if: the cards still ask an admin for steps Claude can do, or the
staging table grows with no cut in progress.
