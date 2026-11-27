# Sync and offline's status card shows the packages scene upright again, phone below and cloud above, with the belt of waiting recordings

Date: 2026-11-27 · By: Caleb Koster · Status: accepted

Reason: docs/decisions/2026-11-18-sync-and-offline-one-screen.md turned
decision 166's packages scene on its side into a short strip
(`TransitStrip`) to make the joined screen short. The strip lost what made
the scene readable: the belt of recordings waiting beside the phone (one
package showed, whatever the count), and most of its height (96 units
against 250). With nothing waiting it showed two lines and a tick. Caleb
asked on 2026-11-26 what had happened to the "little waveform packages
trying to get up to the cloud", and chose to bring the old picture back,
with the rest of the one screen kept.

So the status card's picture is `TransitScene` (sync/transitScene.tsx), the
scene of decision 166 as it was on 2026-11-17: the cloud above, the phone
below, packages on a belt beside the phone (up to six, closer together past
that), the front one rising to the cloud while an upload is under way and
bouncing off the no-signal line while offline, a package coming down while
a download is, and the up and down counts always shown (the down count
hidden offline unless one is known). From the strip it keeps the link on
the lines: solid green lines and a green cloud while live, dashed while
checking, and an alert on the cloud where the server refuses. Everything
else in the one-screen decision (the row on Me, the folds, the status word
and its sentence) stands.

Amends docs/decisions/2026-11-18-sync-and-offline-one-screen.md and
decision 166.

Reverse if: the taller card pushes the folds below the fold on small phones
so that people miss Uploads or Refused, or the scene reads as decoration
rather than status on 2 GB phones.
