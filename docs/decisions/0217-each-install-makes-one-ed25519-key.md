# 217. Each install makes one Ed25519 key for nearby sync, and the server keeps it per person

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: with no server to ask, identity has to be arranged while online,
and authorship has to survive being carried by a third phone and the relay
(`docs/nearby-sync-plan.md` 5.5). So a phone makes its own Ed25519 key the
first time someone on it belongs to an organization with nearby sync on
(220), and signs its batches, its proof at Hello and its certificate
request with it. One key per install, not per person: one install key
stays, so two organizations' phones can still be matched on profile id,
device id and that key. Until phase 5 key making and the certificate call
are Android only, behind `.android` files
(`apps/mobile/src/server/nearbyKey.android.ts`; the plain stub answers that
there is none), because iPhones are out of scope and App Store answers are
not in this plan. The randomness comes from `expo-crypto`, because Hermes
has no global `crypto.getRandomValues`; Ed25519 on the phone is
`@noble/curves`, beside the `@noble/hashes` the app already has
(`src/nearby/nearbyCryptoModel.ts`, checked against core's golden vectors in
`apps/mobile/test/nearbyCryptoModel.test.ts`). The key is in the Keystore,
which Android's backups leave out, so a restored phone makes a new key. The
server keeps `install_keys` with primary key `(public_key, profile_id)`,
because one key can serve several people on a shared phone, and `install_id`
is only the `deviceId`, a label with no uniqueness: a first-come rule would
let a member take an id before its owner certifies. At most 5 new keys per
person in 24 hours, refreshing a known key never counts, and nothing is
evicted, so a reinstall cannot strand anyone and a stolen token cannot push
out the real phone's key (`nearby_certificate_facts`,
`supabase/migrations/20261112010000_nearby_identity.sql`). The request is
proved by a signature over `{ profileId, deviceId, publicKey }` with no
time in it, since field clocks are wrong and a proof is useless without that
person's token. Rows go with the account (46) by cascade. The install key
sits outside decision 168's seal (Carl's answer 5, 168 as amended). It is a
new identifier kept on the server, so the Play Store's "Device or other IDs"
answer covers it (`docs/play-store-declarations.md`).
Reverse if: the real-phone test finds a restored phone keeps its key, or
Ed25519 in Hermes is too slow for one check per batch (plan section 11).

Amended (2026-11-16, Carl Sauder): iPhones make and keep the key too (256).
On an iPhone it lives in the Keychain for this device only, which neither an
iCloud backup nor a move to a new iPhone carries, so a restored iPhone makes a
new key as a restored Android does. The key file is now `.native`, for both
phones; the web still has none.

Amended (2026-11-16, Carl Sauder): on an iPhone the key is in the Keychain
after the first unlock and for this device only
(`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, `deviceOnlyStorage` in
`apps/mobile/src/server/secureStorage.ts`), as the sessions are after the
first unlock, so a read while the phone is locked does not find it missing
and replace it. An iPhone's Keychain also outlives the app, unlike Android's
Keystore, so a reinstalled app would find the old key with none of the
batches it numbered, and teammates would skip the new ones under the same
numbers. So the app's own storage marks the key this install made, and a key
without the mark is replaced (`nearbyKey.native.ts`). A restore onto the same
iPhone brings back both, with an older count, which is answer 2's known
weakness as on Android.
