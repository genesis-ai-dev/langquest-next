# 61. Every passage says whether it is on this phone, and Settings says how ready the phone is for offline

Date: 2026-10-05 · By: Caleb Koster · Status: accepted

Reason: a person can read and play passages while connected and assume they
will still have them in the field, then find out after a long trip that the
audio never came along. The offline scope was already precise (PLAN.md
section 14 rule 10: assigned, worked in, or chosen with `keepOffline`), but
nothing on screen showed it and nothing let anyone choose a passage. Core
`offlineByUnit` and `offlineSummary` (`packages/core/src/blobs.ts`) count, per
passage and for the whole scope, the audio a passage plays (its own and what
it inherits, the same set the downloader fetches), how much is here, what is
still to fetch and what nobody has sent yet. The app shows it in three places
(`apps/mobile/src/offline.tsx`): a line on each passage ("On this phone",
"Downloading for offline" with progress, or "Not kept on this phone" with
Keep offline), a mark on the Map's passage discs and chapter tiles for kept
passages, and a
"Ready for offline" row in Settings that opens the Sync screen, which lists
what is always here and what always needs a connection (unkept audio and
study material, study films, reports, other languages). On a phone, a kept
passage also takes its study guide along: step audio, glossary audio,
pictures and maps (`study/StudyPrefetch.tsx` finds the guides,
`study/studyFiles.ts` keeps the files by a hash of their address and screens
play the local copy first). Films stay online because of their size, and the
web app keeps none, since it needs a connection to open (decision 58). Study
files are not evicted; FIA's are low-resolution copies. A passage is ready when
it is kept and every file the server has is on the phone; a recording not yet
sent from the phone that made it cannot block that, and is named instead.
Text, status and history are not counted: the open language's partition is
always whole on the phone. Keep offline works on the content template's own
units, so it is a chapter where the template splits by chapter and a passage
where it splits by passage; there is no separate chapter-wide switch
(Caleb's call, 2026-10-05).
Reverse if: people keep so many passages that the 2 GB cache evicts kept
audio's neighbours in practice (then the Settings line needs a size budget),
the study file folder grows past what phones can spare (then it needs the
same eviction rules as audio), or teams need films in the field.

Amended (2026-10-07, Carl Sauder): the app runs on phones, tablets and the
web (decisions 55, 58), so the screens say "device" where they said
"phone": "On this device", "Not kept on this device", "Always on this
device", and likewise in sign-in, sync, reports and errors. "Phone" stays
only where it names phones on purpose: phone-number fields, and the guide
editor's note that phones and tablets get a small copy of each picture. The
demo already says "another device". Code identifiers (`onPhone`, the
`'phone'` layout kind) keep their names.

Amended (2026-10-20, Carl Sauder): a phone's first download of a big
language fills its passages in behind the Map (147), so "text, status and
history are always whole on the phone" holds once the fill is done. Until
then each passage's line stands in for its record, the Map and the Sync
screen say "Downloading this language" with how many passages are here,
and "On this device" means a passage's rows and its audio: a kept passage
whose rows have not arrived is not ready, and opened offline it shows its
line and "Not on this device yet". The person's offline scope fills first,
after whatever a screen opens.

Amended (2026-11-18, Carl Sauder): Me's "Ready for offline" row and More settings' "Sync" are one row on Me, "Sync and offline", opening one screen with one title and one order; Ready for offline is a fold on it, a packing list of kept passages and, for someone who can let a new person in, the install file, with what always works offline folded under it (docs/decisions/2026-11-18-sync-and-offline-one-screen.md).

Amended (2026-11-20, Carl Sauder): a book, and a section of a language with its own outline, has a download button of its own, because someone who will be offline for a while may want all the work on one or more books on their device (LAN-316). The choice stays each unit's own, as above: the button keeps each of the book's passages, and each passage's button still shows and changes its own (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md).

Amended (2026-11-20, Carl Sauder): a kept passage takes its study guide along only when it is the person's own (asked of them or worked on) or was kept by its own button. One kept through its book's or section's button is kept for its recordings alone, because a book's study guides are thousands of files: it reads "Recordings on this device" and is marked apart from "On this device", and a switch on its own screen keeps its reference material too, or stops. And a kept passage is ready only once its guide has been looked up; until then it says "Checking this device…", where it used to say "On this device" and then turn amber (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended the same day).

Amended (2026-11-23, Carl Sauder): a recording not yet sent from the phone that made it is named where the passage says it is on this device, not only in Settings' summary. Since LAN-317 (`docs/decisions/2026-11-20-unheard-recordings-are-not-judged-or-changed.md`) a recording nobody can hear here is not reviewed, said back or changed from this phone, and one its phone has not sent cannot be heard anywhere, online or not, so a passage that read "On this device" could still hold its review at Listen with nothing on the Map saying why (found reviewing LAN-317 against LAN-316's change). Carl chose to keep such a passage green, since this phone has all it can get and connecting would not bring the recording, and to name it: its line says "1 recording hasn't been sent from the device that made it yet.", and a book's or a section's line that would say its recordings and reference material work without a connection says "Some recordings haven't been sent from the device that made them yet." instead (`groupLook`, sync/offlineModel.ts). Considered: amber until the recording is sent, which could stay amber for good if that phone is lost, with nothing this phone could do.

Amended (2026-11-23, Carl Sauder): on a book's screen the line over the passages has no words now (`docs/decisions/2026-11-20-a-book-has-its-own-download-button.md`, amended the same day), so a book that is on this device with a recording not sent yet says so in its header, after where its passages stand: "On this device · some recordings not sent yet" (`GroupLook.note`). An outline section's round mark still says "Some recordings haven't been sent from the device that made them yet." in its spoken label, and a passage's own line is unchanged.
