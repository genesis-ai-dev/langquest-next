# 256. iPhones share nearby: the advert goes out alone and is known by its salt, two iPhones meet after one tap per opening and over Apple's own direct Wi-Fi, and an iPhone joins an Android's network as a plain client

Date: 2026-11-17 · By: Carl Sauder · Status: accepted

Reason: sharing between an iPhone and an Android, and between two iPhones,
comes first for iPhones; joining offline on an iPhone is optional and later
(Carl's answer 25, `docs/nearby-sync-plan.md` section 7, phase 5). An app on
an iPhone can advertise only service UUIDs and a local name, and Apple
documents that its scan response holds only the name, so an iPhone cannot
send Find's scan response (tag, summary, echo; 224). It sends the advert
alone and serves the same GATT service under it. A phone that hears such an
advert (`onAdvert`) keeps it in the room under `@` and its salt
(`ALONE_TAG`, `packages/sync/src/nearbyRoom.ts`) and echoes that salt, so an
iPhone can check an Android's echo and connects to an Android only once
echoed, as Androids do. Reading more before connecting would take the very
connection the echo exists to stop, so nothing is read. An Android leaves an
iPhone on its own generation to connect; one ahead on its key offers the tap
it already had (answer 21), because the iPhone behind cannot hear it. An
iPhone cannot get an echo from another iPhone, or from an Android on older
code, so it shows "A teammate may be nearby" and one tap covers every such
teammate until the screen closes (answer 26); of two iPhones that both
tapped, the lower salt connects. With no summary to compare, a phone heard
alone is tried once per salt. To move files, an iPhone, which can host
nothing an Android can join, joins an Android's local-only hotspot, or its
Wi-Fi Direct group as a plain client by name and passphrase
(`NEHotspotConfiguration`), with a system prompt each time; the group is
offered only when both Hellos list `join-direct`, so a phone on older code
and its partner still work out the same plan. Two iPhones use Apple's own
direct Wi-Fi through Network framework (`awdl`), the host listening as a
Bonjour service under a one-time name it sends in `host`, of the type
`_nlink._tcp`, which `Info.plist` fixes. `awdl` and `joinDirect` are fields
of `arrange`'s radios that older phones drop, so the protocol stays at 1 and
the carried file's name does not change. What it costs: an iPhone cannot
choose when its Bluetooth address changes, so two of its salts can be linked
through one address until iOS changes it; the Bonjour type is fixed and on
the air while a link comes up, as Android's `DIRECT-` name is; new work
between two iPhones can wait up to one rotation; an Android cannot see an
iPhone's summary, so it can say "Up to date" while an iPhone in range still
has something, until the iPhone connects; and the Kotlin change costs an
Android store build and a carried build (246). Nothing merges before a
real-phone test with iPhones and Androids (answer 27).
Reverse if: the real-phone test finds an iPhone does send a second service
UUID in its scan response (then it sends Find whole and the taps go), iPhones
cannot join an Android's hotspot or group reliably, or `awdl` is too slow or
too unreliable between iPhones (then Wi-Fi Aware, or Bluetooth alone for
events).

Amended (2026-11-16, Carl Sauder): in the app, an iPhone's `arrange` says
`awdl` and `joinDirect` as its module does, `joinDirect` only while
`NEARBY_RADIO_TUNABLES.joinDirect` allows it, so an update can turn it off if
the real-phone test finds it does not hold (`radiosFor`,
`apps/mobile/src/nearby/nearbyRunModel.ts`). The screen shows one "A
teammate may be nearby" for every teammate an iPhone cannot get an echo
from, since its one tap covers them all; a phone known only by its salt has
no name and shows as "A teammate". An iPhone does not serve a newcomer's
starting copy, which stays with joining offline on Android
(`src/nearby/nearbyCopySource.ts` and `.android`).

Amended (2026-11-16, Carl Sauder): the Swift (`apps/mobile/modules/nearby-link/ios`)
differs from the Kotlin where an iPhone does. When Bluetooth goes off or is
refused while Find runs it says so (`onFindError`, `BLUETOOTH_OFF` or
`NO_PERMISSION`) and starts Find again under a new salt when Bluetooth comes
back; the Android-only tunables (`advertiseInterval`, `scanMode`,
`emptyScanFilter`, `connectable: 'after-hearing'`) are read and do nothing,
since an iPhone's advert is always connectable; and an iPhone's GATT server
cannot end a central's connection, so closing a pipe it serves drops it here
and refuses further writes. An iPhone's own name, as set in Settings, is
probably readable over GATT by anyone who connects, as Android's was before
`setDiscoverable(false)`; the real-phone test checks it (plan section 11).

Amended (2026-11-17, Carl Sauder): phase 5 merges before its real-phone
test, not after it (plan answer 28, replacing answer 27). The test runs on
the store builds the merge makes, from TestFlight and Play's internal testing
as soon as each is built, before either store approves it. Only Carl's
organization has nearby on in production, so only its phones can open Share
nearby, and Android's nearby merged the same way (#403). What every other
phone takes is the module linked into the app, which makes no Bluetooth
manager and asks for nothing until Share nearby asks for Bluetooth or starts
Find; the branch's app passed the phone smoke flows on the iPhone simulator
and the Android emulator. Before the merge, the App Store's answers go in
(`docs/app-store-declarations.md`: export compliance, App Privacy's Device
ID, `nearby` on LangQuest Sample). The cost: a Swift or Kotlin fix the test
finds needs another store build and review, not an update, and an App Review
that cannot reach Share nearby may hold later iPhone builds.

Amended (2026-11-19, Carl Sauder): the first real-phone test of two iPhones (build 60) found nothing in 30 to 60 seconds, because the tap was offered only after the minute a phone waits for an echo, which can never come from an iPhone. Between two iPhones it is now offered after 10 seconds (`tapAfterAloneMs` in `packages/sync/src/nearbyRoom.ts`); an iPhone still waits the minute for an Android, whose echo may yet come. Room records also count the bare adverts heard (`alone`, migration `20261119233000_diag_nearby_alone.sql`), since `heard` counts only full matches and read as nothing heard between two iPhones.

