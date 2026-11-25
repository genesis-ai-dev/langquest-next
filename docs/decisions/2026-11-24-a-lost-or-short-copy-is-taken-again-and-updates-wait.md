# A local person's short or lost copy is taken again on Share nearby and while open, and over-the-air updates wait while a copy is held

Date: 2026-11-24 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-24 found that a person let in offline could be
left without the team's work with nothing on the phone able to bring it back.
A person is set (`ready`) at the first server answer while the copy is left to
finish (item 6), and a person never goes back a stage, so the join screen's
Look, the only way to take a copy, was gone; if the signal went before the
first download, or the join was refused, the copy stayed short. And an app on
another reducer, from an update caught at a market or a newer install file
from a teammate, dropped the copy at its next start (item 26): offline the
organization was empty and the language held only events above the copy, so
the person could not record, review or read guides, and teammates' events were
refused as "language not listed". Carl decided: hold over-the-air updates
while a starting copy is held, warn before installing a newer install file,
and let Share nearby and the quiet mode take a copy again whenever one is lost
or short.

A dropped checkpoint that was a starting copy leaves a mark
(`copyLost:<org>/<stream>`), cleared by a copy taken again or by the first
download. `SyncClient.copyNeed` says what a stream still needs of a teammate
(`missing`, `filling`, `lost`, or nothing once it holds a whole copy or
anything from the server), and Share nearby and the quiet room pass a copy
target for the local person of that organization and language whenever either
stream needs one (`roomCopyTargetFor`). It asks nobody once the copy is whole
(`wanted`), and Share nearby says the copy is short or that an update removed
it. The quiet room now also gives copies on Android, as Share nearby does, so
two teammates sharing while LangQuest is open can mend one; a copy goes only
to a phone that asks and passes the read gate and Hello's limits.

With app.json's `checkAutomatically` at `ON_LOAD`, expo-updates downloads an
update in the background at a start and applies it at the next, and nothing
in the app can stop it. The app's own looks wait: on coming back to the front
(`UpdateBanner`) and the first launch's wait, neither looks while the phone
holds a teammate's starting copy the server has not replaced
(`startingCopyHere`, over sync's `startingCopyHeldIn`); the copy ends at the
first download, so the update follows it. The app also has a look of its own
at each start (`useUpdateAtStart`, outside the disguise, so a disguised phone
looks as it did), held the same way, which runs only once a build stops
expo-updates looking by itself (`updatesLookByThemselves`), so no build looks
twice. `checkAutomatically` `NEVER` is a native setting: it changes both
platforms' fingerprint, so the change that carries it reaches phones only
with a new store build (decision 155). This change, which must reach phones
by update (the newcomer's 90 days must be there before the pass window ends on
2026-12-03), leaves it at `ON_LOAD`; `NEVER` lands with the next store build,
and only from then are updates fully held. Until then an update with another
reducer caught at a start can still drop a copy, which Share nearby and the
quiet room then take again. An install file is the person's own choice
and the app does not install it, so it is warned of: on a phone holding a
copy, Share nearby's line that two apps are too far apart adds that no other
version should be installed until the phone reaches the internet, and the
progress screen says so once the copy is whole.

Reverse if: phones holding a copy stay offline long enough that held updates
leave them on a build with a bug that costs more than a copy taken again
(then look for updates whose runtime and reducer match, or let the person
choose), or field records show the start look missing updates that
`ON_LOAD` caught.
