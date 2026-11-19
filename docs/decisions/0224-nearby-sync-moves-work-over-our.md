# 224. Nearby sync moves work over our own link on Android's own APIs: Bluetooth LE to find, Wi-Fi Direct to move, a local-only hotspot if that fails, and Bluetooth for events if neither comes up

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: the link has to work on Android phones without Google Play services,
including in China, with iPhones a lower priority (Carl, 2026-11-06;
`docs/nearby-sync-plan.md` section 4). Nearby Connections needs Play
services, and a team can mix phones with and without them, so every phone
needs the same link anyway. Bluetooth LE is the radio every phone shares
and is fine for finding each other and for events, but at a reported 20 to
70 KB/s an hour of one person's audio (58 MB, decision 106) would take 14 to
48 minutes. So, in this order: phones find each other over Bluetooth LE; a
short Bluetooth exchange runs the key exchange and Hello and says who
hosts; one phone hosts a Wi-Fi Direct group the other joins by name and
passphrase (`WifiP2pConfig.Builder`, Android 10 and later, silent to join),
asking for 5 GHz only when both report it; if Wi-Fi Direct will not come up
a local-only hotspot is tried next, with a system dialog on the joining
phone; and failing both, events still move over Bluetooth while audio
waits (`arrangePlan`, `packages/sync/src/nearbySession.ts`). Android first:
an iPhone has no Wi-Fi Direct API and comes in phase 5, with the protocol
unchanged. The module, `apps/mobile/modules/nearby-link`, is mechanism only:
it does nothing at construction, names no API 29 class in its fields,
logs nothing, takes every tunable as an argument from JavaScript (a Kotlin
edit needs a store review), carries its permissions in its own
`AndroidManifest.xml` so `app.json` and the iPhone fingerprint do not move,
and rejects with an enumerated list of codes (`src/codes.ts`), a drop as
sync's `OfflineError`. Text guards hold it to no logging, nothing fixed in
an advert, no Play services and declared permissions
(`apps/mobile/test/nearbyNative.test.ts`). What it costs is that we own what
Nearby Connections would have handled: more native code, our own
encryption, and the differences between phone makers, none of it tried on
China-market phones yet; Carl chose to build the whole branch and let the
real-phone test decide, so the risk is that the native work is redone or
dropped, while the model, identity and delivery work does not depend on the
radio. `NearbyLink` leaves room to add a faster path later.
Reverse if: the real-phone test finds the link does not hold up on
China-market phones or 2 GB Androids (plan section 11), or it is much slower
than Nearby Connections between phones that have Play services (then that
becomes a second `NearbyLink`).

Amended (2026-11-07, Carl Sauder): a Wi-Fi Direct group's server is bound
to the group's own address, but a local-only hotspot's cannot be: no public
API names its interface, and another app can share the same hotspot, so its
server listens on every network the phone is on, and a stranger there
could connect first and take the link. So a hotspot hands up every
connection in turn (`Hosted` with `candidates`, `nextLink`), the session
tries each at once, and the link is the one that proves the attempt's keys
(its first frame opens); the rest are closed, a candidate that never proved
them takes nothing down, and only once one has is a later connection
refused. Each attempt's link is secured with keys of its own, from the
Wi-Fi keys and its place in the plan, which the `host` message now names
(plan 5.12, Session keys).

Amended (2026-11-08, Carl Sauder): every hotspot candidate shares its
attempt's keys and starts its nonces at zero, so a `ready` or goodbye sealed
on a stranger's connection repeated the real link's nonces under the same
AES-GCM key (final security review). The joiner now sends `ready` first and
the host seals nothing on a link until the joiner's `ready` has opened, and
the native link sends no goodbye on a link whose other side has not proven
the keys (`LinkSession.close`), so only the proven link ever seals under an
attempt's keys.

Amended (2026-11-10, Carl Sauder): on a hotspot, where every connection is a
candidate under one attempt's keys, only the first candidate to open a frame
counts as proven; any other ends at its first frame, unproven and with no
goodbye (`LinkSession.firstProof`), so a copied `ready` cannot make a second
link seal under the same key and nonce. The host also drops a candidate that
sends no `ready` within `replyMs`, so four silent connections from another
app on the phone no longer hold every place for the whole attempt
(pre-merge security review).

Amended (2026-11-16, Carl Sauder): iPhones come in, on the same protocol
(256): an iPhone's advert goes out alone, it joins an Android's local-only
hotspot, or its Wi-Fi Direct group as a plain client, and two iPhones use
Apple's own direct Wi-Fi (`awdl`). The Kotlin now hands up a teammate's
advert heard with no scan response (`onAdvert`), the module's one native
change for iPhones, so this costs an Android store build as well as the
iPhone's.
