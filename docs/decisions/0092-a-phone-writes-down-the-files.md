# 92. A phone writes down the files it keeps, and a file it loses behind the app's back is an alarm

Date: 2026-10-12 · By: Caleb Koster · Status: accepted

Reason: many phones sold in the field (Nigeria and places like it) claim
more storage than they have, and once the real space runs out they silently
delete files. LangQuest v2 users lost recordings this way among tens of
thousands of files, and nobody knew until the audio was needed. Caleb asked
for a very noticeable alert when a file that should be on the phone
disappears, cheap enough for low-end phones. PLAN.md section 14 rule 9 makes
a missing local file a quiet absence, which is right for a file that was
never here (someone else's unsent recording) but hid a file the phone threw
away. Chosen:
- The file store (`apps/mobile/src/blobs.ts`) writes down every file it
  keeps in a ledger (`packages/client/src/fileLedger.ts`, its own SQLite
  file `langquest-files.db`, one row per file). New files are written down
  in batches a second after they arrive. A file the store deletes itself is
  crossed out before it is deleted, so a crash between the two leaves a stray
  file that the next start keeps again, never a false alarm. The ledger
  drives no work: upload and download lists still come from the fold and the
  folder (rules 1 and 9), so it can disagree with the folder without harm,
  and the disagreement is the signal.
- Phones only. The web keeps no ledger: a browser's SQLite holds at most
  six files open (expo-sqlite's access handle pool), the event log and
  diagnostics already fill them, and a third database made the web fail to
  open its storage. The web app needs a connection anyway (decision 58).
- At startup the listing the store already makes is compared with the
  ledger. While the app is in use, the folder is listed again (names only,
  one native call off the JS thread) when the app comes back on screen and
  when new files arrive, at most every ten minutes, and at once when an
  upload finds its file gone. Before a listing is believed, up to 100 of the
  missing files are checked one by one; if any is there, the listing is not
  trusted and nothing is reported.
- A lost file comes off the index, so a kept passage downloads it again if
  the server has it, and is kept as lost until someone has seen the alert.
- The alert (`apps/mobile/src/lostFiles.tsx`) covers every screen and
  closes only with "I understand". Core `lostFilesView` says, for the open
  language, how many lost files are safe on the server and how many
  recordings were never sent, and names their passages to record again. It
  also tells the person to go online often, because the device may have less
  space than it says.
Not chosen: hashing files to catch damaged contents (a whole read per
file), a persisted queue (v2's lesson stands; this is a record of what was
kept, not of work to do), and field diagnostics for losses (a new kind
needs the server allowlist and Play declarations changed; a later change).
Reverse if: the ledger itself proves unreliable on these phones (false
alarms in the field), or losses turn out to be damaged contents rather than
missing files, in which case add a slow background spot check of hashes.

Amended (2026-11-07, Carl Sauder): a teammate's recording that came from
their phone and is lost behind the app's back is not this person's to record
again. Such a file is marked when it lands (226), so the lost view
(`LanguageSession.lost`, `lostFilesOf` given the marks) counts it in
neither of the alert's totals and names none of its passages: its author's
phone is where it is recorded again, if it must be. This person's own
files, and another person's on a shared phone, carry no mark and alarm as
before.
