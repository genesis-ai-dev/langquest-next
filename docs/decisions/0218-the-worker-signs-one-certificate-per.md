# 218. The Worker signs one certificate per person and organization, naming that organization alone

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a teammate's phone must know, offline, that a key belongs to a
member and what they may do (plan 5.5). `POST /api/nearby/certificate`
(`apps/web/worker/nearby.ts`) signs, for each organization that has nearby
on where the caller is a live member, a link binding the install key to the
person and device and naming that organization alone, valid for a year.
Hello, batches and a join grant carry only the session's organization's
certificate, because they rest in plain SQLite on every teammate's phone,
and a person's other organizations are no teammate's business (`_org` is
members only). A link carries resolved privileges per scope, not role ids,
because an older fold may not know the role, and the organization stream's
newest seq at signing, so a certificate decides only when it is newer than
the phone's fold (`peopleWithChains`), and someone added last week is not
turned away. A year: shorter revokes faster, but risks stranding
long-offline teams. A phone asks after an organization pull, once a day, on
a membership change, when `nearbyRevokedSeq` says it is behind, or the first
time a language with no key opens (`useNearbyIdentity`,
`apps/mobile/src/nearby/nearbyIdentity.android.ts`), keeps a chain only once
it checks against the Worker's bundled public keys, and replaces
`nearbyChain:<profileId>` whole, never merged, so a turned-off
organization's goes. The certificate route asks `session_is_live` uncached,
because decision 118's 30-second cache would let a phone whose sessions were
just ended make a new key. The Worker's private key is `NEARBY_SIGNING_KEY`,
a secret of its own and not derived from the service key, since rotating
that would strand offline phones; its public keys ship in the app's public
settings with key ids (`EXPO_PUBLIC_NEARBY_CERT_KEYS`, equal to the
Worker's `NEARBY_CERT_KEYS`), so it can rotate, and a retired key id stays
listed. The phone remembers when it last had an answer and its membership
then, in one meta row (`nearbyCertAsked:<profileId>`), so "once a day"
holds across launches.
Reverse if: certificates expire on teams that were offline less than a year,
or a teammate learns of another organization from what a phone carries.

Amended (2026-11-07, Carl Sauder): a chain the phone cannot check no longer
strips what it holds. Once the Worker's key rotates, a phone still on a
build without the new public key refuses every new chain, and replacing
`nearbyChain:<profileId>` whole dropped its chains and so its discovery keys.
Now, for an organization whose new chain fails the check, the phone keeps
the chain it held for that organization, and that organization's discovery
keys as held, while the held chain still checks against its bundled keys, as
after a 429 or 503. An organization the answer does not name goes as before,
so turning one off still reaches the phone. This is what makes
`scripts/nearby-signing-key.sh --rotate` safe for phones built before it.
