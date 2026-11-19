# 223. A language's discovery key rotates as a one-way hash chain, and a phone hands a newer one on once

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's answer 13. A fixed discovery key would give a removed member
or a taken phone a radar for the team for the life of the language (plan
5.5). So a language has generations, `key(g - 1) = SHA-256('lq-nearby-gen-v1'
|| key(g))` from a random seed at generation 10,000, so an older key can be
worked out from a newer one and never the reverse
(`packages/core/src/nearbyGenerations.ts`, `_discovery_generation` in the
migration, a golden vector holding them equal). The server makes one lazily,
only in the certificate call for a language the phone named, at most one a
day, when the newest is over 90 days old or older than a removal covering
the language or a revocation; there is no timed drop, because a timer
strands long-offline teams on wrong dates. An answer holds the newest key
and a `floor` (the highest generation at least a year old), and a phone
stores one entry per language, `{ gen, key, floor, direct }`, in the
Keystore under `nearbyFindKeys:<profileId>`, sealed with that person's
session at sign-out (168 as amended). Discovery keys come only for languages
this phone has opened (37). A phone that got its key from the server hands
it to a teammate after Hello, one hop, only once its fold has seen the
removal that made it; a phone that got its key by hand-on never passes it
on. The limits that remain: a phone the new generation has not reached stays
recognisable under the old key; a scan-only phone on an old key cannot meet
a newer one until it syncs; someone holding an old key can draw a connection
from a phone that scans down to it, or read the chain of a phone still on
it; and an informer who is still a member is unaffected.
Reverse if: the real-phone test finds a team stuck on old generations after
a trip to town, or the security review finds the hand-on reaches a removed
member.
