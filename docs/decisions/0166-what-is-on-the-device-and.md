# 166. What is on the device and what waits to upload is shown by passage: a download button on every passage, an upload bar while anything waits, and the Sync screen by passage with a record of what went up

Date: 2026-10-25 · By: Caleb Koster · Status: accepted

Reason: a tester asked whether translators can work fully offline and then
sync, after the app "would not load" with the phone offline (a build from
before decision 87). Caleb found the app's answers hard to read: a tiny cloud
mark on chapter tiles said a passage was kept, keeping one was under
"Something else?", a book divided into passages showed chapter tiles although
a passage can run across chapters, nothing said plainly that recordings made
offline wait on the phone or how many, the Sync screen listed event names
("TakeComposed · Luke 13:1–9"), nothing said when work went up, and an update
check that failed offline showed Android's own error ("Unable to resolve host
u.expo.dev"). So:
- **Download buttons.** Every passage's row and every chapter's tile has a
  round download button (`DownloadButton`, sync/offline.tsx): an outline to
  download, an arrow wave moving down while it does (`WaveArrow`,
  sync/transit.tsx), amber when offline and not all here, green once it is. The top of a passage is the same button as a line
  ("Download for offline", "Downloading for offline · 3 of 5", "On this
  device"); the card under "Something else?" is gone. A book says how many of
  its passages are ready on this device. Tapping keeps the passage, stops
  keeping one the person chose, or says why it is kept (asked of them, worked
  on). Decision 61's per-unit choice stands; the cloud marks and the map key's
  "On this device" go.
- **Passages, not chapters.** A book whose passages are not its chapters one
  each (`chaptersAreWhole`, map/mapModel.ts) shows its passages as rows, 25 at
  a time, instead of chapter tiles. Chapter tiles are four across on a phone
  (five before), big enough for a thumb and their download button.
- **The upload bar.** While recordings or changes wait to upload, a bar over
  every screen says how many ("3 recordings waiting to upload", changes only
  when no recording waits), and "Offline" or "Uploading"; it says "All
  uploaded" for four seconds when the last went. While they go up, its arrow
  waves upward. It opens the Sync screen as
  chrome, like a tab or the Global Viewer link (decision 158), not along a
  flow edge, and does not open it from a recording screen.
- **The Sync screen by passage.** It starts with recordings as packages
  between a phone and a cloud (`TransitScene`, sync/transit.tsx), with how
  many wait to go up and to come down: online they leave the phone's belt
  for the cloud and arrive from it; offline the front one rises to a
  no-signal line and drops back (Caleb's idea, 2026-10-25). Then how much
  waits (or "All uploaded" and when the last upload was), then "Waiting to
  upload" by passage ("0 of 3 recordings uploaded", one box per recording
  turning green as it goes, from each passage's most recordings since its
  queue was last empty), then "Uploaded": what this device sent, by day,
  passage and time. The event list stays under Details, for support. The
  motion is transforms and opacity on the native driver and stops under
  reduce motion.
- **A record of what went up.** The language session keeps a short log on
  the device (`packages/sync/src/sentLog.ts`, the store's meta table): files
  as each upload finishes and changes as the server accepts them
  (`SyncClientOptions.onSent`), by passage, a sitting's worth joined into one
  line, at most 300 lines. It is for people to read and drives nothing. It
  starts empty on each device with this build.
- **No update errors.** A failed update check or download shows nothing;
  diagnostics get the reason, and the next return to the app looks again.
  Only "Downloading update…" and "Update ready — tap to restart" show.
Reverse if: people miss the event list (then plain names for each kind join
the passage rows), the bar over every screen crowds small phones (then it
moves into the headers), or teams want a whole book downloaded at once (then
a book gets its own button, which decision 61 left out).

Amended (2026-10-25, Caleb Koster): every line says only what this device
knows. Caleb, after the first build: offline, a passage he had not
downloaded still offered "Download for offline", and tapping it said "Kept
on this device" at once; "Above all, these indicators … must tell the
truth. They cannot assume anything." The old app's false flags had caused
partners and users real trouble. So:
- **Offline is the phone's word as well as the server's.** `ctx.language.online`
  is false as soon as the operating system says there is no network
  (expo-network, `saysOffline`), not only after the next sync attempt fails.
- **Online is only the server's word.** Caleb: some checks "show that the
  phone is online … even if the user has a VPN turned on and they have no
  internet connection". The operating system's "connected" says nothing
  about a VPN with no internet behind it, a hotspot's sign-in page or a SIM
  out of data, and a sync then hangs with no answer while the last result
  still says online. So the app counts what the server itself said
  (`sync/reachModel.ts`, `useServerReach`): each sync it answered
  (`LanguageSessionOptions.onAnswered`), each answer to the live channel's
  heartbeat (every 15 s, `server/supabase.ts`), and, when neither has come
  for 20 s while the app is on screen, a check of its own
  (`server/reachability.ts`: `/auth/v1/health`, counted only when the
  server's own JSON comes back within 8 s). An unanswered check says
  "Offline" at once, unless something answered after it was asked; the
  next answer of any kind clears it and syncs. With the live channel up
  the heartbeat answers, so the check seldom runs; it costs one small
  request every 20 s otherwise, and none off screen or with no network.
  SYNC-034.
- **No download is offered offline.** A passage not kept says "Download
  needs a connection" and does nothing. Keeping one shows no toast: the
  line itself says what happens.
- **"On this device" only once counted.** A passage says it only when the
  session's own count of its files says every one is here (decision 147:
  rows as well as audio); until the count has it, "Checking this device…".
  Kept but not all here: "Only {here} of {total} files on this device".
- **Moving only while moving.** The session publishes which passages have a
  file going up or coming down right now (`uploading`, `downloading`).
  "Uploading", "Downloading for offline", the arrow waves and the packages'
  flights show only then. Work merely waiting is "Saved on this device".
- **"All uploaded" means everywhere.** A phone syncs the language it has
  open, so other languages' work waits on the device: their changes come
  from the event log (`pendingStreamsBy`) and their recordings from each
  session's last count (`files-waiting:<org>/<language>` in the store's
  meta). They count in the bar and show as rows on the Sync screen.
- **Nothing new is not known offline.** "To receive" and the transfers say
  "Offline" there, not "None" or "Up to date"; the top count shows only when
  something is known to wait. Settings' sync line says recordings waiting,
  and offline before "Live".
- **Sent means sent.** Offline, asking someone, a review and a published
  version say who gets it when the device is connected.

Amended (2026-11-06, Caleb Koster): My Work's to-do rows end with the same
download button as a Map row, for the passage each is about (LAN-19), so
"On this device" shows before the passage opens. It is on the rows of the
Then list and the "record again" row; the lead card, the join, divide and
language rows, and the waiting and recent lists have none.

Amended (2026-11-07, Carl Sauder): teammates' recordings held here count
in the upload bar and the Waiting list too (`docs/nearby-sync-plan.md` 5.8):
a phone holding backups shows the amber bar while offline and lists other
people's passages, which is true of this phone. They come from the upload
list, so for someone who may not write files in the language (`mayUpload`,
`packages/sync/src/nearbyFiles.ts`) teammates' files stay off it, and off
the bar, until delivery (phase 4). Carl sees this when it ships
(plan section 13), so he can object. A record's History gains one line for a
row still nearby ("Came from Sam's phone, not on the server yet"), read from
row status; a claim row says only that it came from Sam's phone. No other
list marks it.

Amended (2026-11-12, Carl Sauder): "All uploaded" stays until the person
moves to another screen, at least four seconds, and the bar goes only then.
The bar sits above the screens, so as it went every screen moved up by its
height (52 pt), four seconds after the last upload, a moment nobody could
see coming. A tap aimed just before landed on whatever had moved under it:
the phone tests' did (an iPhone missed the map's search field, and two of
four Backs hit nothing, in run 43342922443), and so could a person's. Going
as one screen gives way to the next, it never moves a screen in use
(`DoneMark`, sync/uploadsModel.ts). It still pushes the screen down when
something starts to wait, mostly just after the person's own tap. Floating
it over the foot of the screen like the toast would cover what is there,
and moving it into the headers (the reversal above) would lose its words
and leave screens without a header without it.

Amended (2026-11-18, Carl Sauder): the Sync screen's packages scene is turned on its side into the status card's strip (`TransitStrip`), whose line is the status, and the uploads card and the To receive card are gone; Uploads is a fold with the Waiting and Uploaded lists, and Downloads a line that offline still never says "Up to date" (docs/decisions/2026-11-18-sync-and-offline-one-screen.md).
