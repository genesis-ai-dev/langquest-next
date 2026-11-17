# 219. A certificate is a chain of signed links, checked with no server

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: phones must accept a newcomer vouched for by a teammate (section 14,
from phase 6), so a certificate is a chain: the first link is the Worker's
signature, and each later link is signed by the key named in the link
before, in a versioned format (`worker@1`, `invite@1`;
`packages/core/src/nearbyChain.ts`, plan 5.12 Chains). Each signed text has
a domain prefix and includes the previous link's signature, so links cannot
be spliced and a signature made for one purpose cannot be replayed for
another. `checkChain` refuses a kind it does not know before any verify, and
more links than `maxLinks`. Until phase 6 issues any, every chain has one
link, but phones check two-link chains from phase 2. `Verify` and `Sha256`
are passed in, so the same check runs on the Worker's `crypto.subtle` and on
the phone's `@noble/curves` and `@noble/hashes` (104). Batches are carried
for months, so a batch's chain is checked with expiry skipped; Hello checks
expiry against `max(wall, last hlc)` with no not-before, because
`HlcClock.last` never goes back. A newcomer's membership comes from their
chain only until this phone's fold has any entry for them, so a removal
sticks.
Reverse if: a link kind the field needs cannot be added without phones
refusing it, or the security review finds a splice.
