# Sync and Ready for offline are one screen, Sync and offline: a status card with the transit strip, then folds that each say what they hold

Date: 2026-11-18 · By: Carl Sauder · Status: accepted

Reason: Me's "Ready for offline" and More settings' "Sync" opened the same
screen (`sync_status`) under two titles, with the Ready for offline card in
two places (decision 61). It read as two screens that mostly repeated each
other, and the screen repeated itself too:

- **Waiting to upload** showed in up to four places: the uploads card, the
  Waiting list, a tile in Details, and the audio-up transfer.
- **Still to come down** showed in three: the packages scene, the To
  receive card and the audio-down transfer.
- **Two progress bars** counted passages one above the other (the first
  download's banner and Ready for offline's).
- **Fixed text:** the always/needs lists, which never change, were the
  tallest thing on the screen.

Carl chose (2026-11-18) one screen, Sync and offline, condensed so that it
answers at a glance and opens for detail:

- **One way in from Me.** A "Sync and offline" row on Me, whose line says
  first what needs noticing (refused, or work waiting to send, with the sync
  icon's count as a badge), else how ready the device is for offline. More
  settings has no Sync row. The header's sync icon, Sign out's "See what is
  waiting" and the upload bar open the same screen.
- **A status card.** The packages scene of decision 166, turned on its side
  (`TransitStrip`, transit.tsx): this phone on the left, the server's cloud on
  the right, uploads moving along one track and downloads along the other.
  - **The line is the status:** solid while live, dashed while polling,
    broken at a no-signal mark while offline (the waiting package goes to
    the break and drops back), an alert on the cloud where the server
    refuses.
  - **Counts and stillness:** counts sit under the phone and the cloud, and
    a tick shows on the line when nothing waits either way.
  - **Under it:** the status word and its sentence, and Sync now.
- **Folds, each one line that says what it holds** (`Disclosure`, which can
  now also be a line with nothing to open, and can colour its line amber or
  red):
  - **Refused by the server**, only when something is refused. It comes first
    and arrives open, with each change and the server's reason. That list
    was under Details before.
  - **Uploads:** what waits by passage, teammates' recordings held for the
    server, and what went up.
  - **Downloads:** a line with nothing to open ("Up to date", "N recordings
    to receive · speed", and offline "Checks for new work when back online",
    never "Up to date").
  - **Ready for offline:** a short packing list. Kept passages, with the
    first download's progress while it runs. The install file, for someone
    who can let a new person in (`installFileItem`). "What works offline",
    folded.
  - **Share nearby:** a row to its screen, as before, without the install
    file reminder (Ready for offline has it now).
  - **Details for support:** the tiles, the transfers, the waiting events
    and the build lines.
- **Starts short.** Only Refused and the fold a link asks for (`open`)
  arrive open, and nothing is remembered between visits.

Removed with it: the uploads card, the To receive card, the separate download
banner on this screen (the Map keeps it), the status's ⓘ (its sentence shows),
and the two titles and orders. PR 514, which kept the install-file reminder on
the Share nearby row and dropped Ready for offline's, was closed for this:
the file is packed before a trip, so it belongs on the packing list.

The screen is a module of its own (`screens/sync.tsx`, with
`sync/readyForOffline.tsx` and `sync/transitStrip.tsx`), loaded the first
time it is opened, since most visits never open it. That keeps a first visit
within its web budget; the all-chunks budget rose 4 KB, mostly for the new
words every visit carries.

Amends decisions 61, 166 and 246. The partner demo has no Sync screen, so
demo parity does not apply.

Reverse if: people look for Sync under More settings and do not find it on
Me; the folds hide something people need without opening them (field
reports, or support asking for screenshots of opened folds); or the strip
reads as decoration rather than status on 2 GB phones.

Amended (2026-11-19, Carl Sauder): Ready for offline's install file item says ready only once the file is in hand, not for a press that only opened the browser: never got, for an older version, downloaded but not chosen yet, or ready (`installFileItem`, `installBlock`; docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended the same day). Its link goes to the screen, now called Download the install file, and for a file downloaded but not chosen it shows offline too, since choosing a file needs no internet.

Amended (2026-11-23, Carl Sauder): a Teammates fold sits above Share nearby's row, where Share nearby can run on this phone. It lists each teammate and how recent the newest work held from them is, as Ready to carry says on Share nearby, read from the store with no radio (`teammatesOf`, `useNearbyTeammates`), so a person sees where they stand with teammates without opening Share nearby. Folded, its line names the least recent teammate, or everyone. Me's row gains one case, after refused and before waiting to send: offline, "Recordings only on this phone: N", this person's recordings waiting to upload that no teammate's phone said it holds (`onlyOnThisPhone`), with a help line saying it is as far as this phone knows. Both show only on a phone where Share nearby can run, so the web carries neither. docs/nearby-sync-plan.md 15.4 and 15.5.

Amended (2026-11-25, Carl Sauder): where sharing while LangQuest is open is on for the person (the organization's `nearby_open`, the switch, no cover), Share nearby's row says so in place of its jobs, even while the room does not run: a person let in offline saw "Share work with teammates without internet" and could not tell the mode was on. It says one of three: sharing now while the room runs; on, but the phone needs something allowed or turned on, and Share nearby says what, where a permission is missing (online too, since it is granted once) or, offline, a radio is off; else on, sharing while LangQuest is open without internet. The permissions and radios are read without a prompt, and what is not read yet counts as on (`nearbyRowWords`, `useWhileOpenRow`). docs/nearby-sync-plan.md 15.6.
