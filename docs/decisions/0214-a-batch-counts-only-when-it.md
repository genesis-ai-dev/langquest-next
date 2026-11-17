# 214. A batch counts only when it is whole, gaps stay open, and the signer's own floor closes them

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: with numbered batches (213) a teammate could close a number by
leaving events out, and a phone holding part of a batch could close it for
the next phone (plan 5.3, from the security review). A number counts only
when every id in its manifest is here under that digest, under a later batch
of the same signer (a restamp), redacted here, refused for good by this
phone's door after arriving with a matching digest, or found on the server by
the sweep; a digest mismatch never counts. Until then the rows are kept and
folded, the number stays open, and every later partner sends the batch again
with known ids dropping out, so the re-send is the asking and there is no ask
message. A sender sends every batch the receiver has not counted, lowest
first, and a receiver records a number above a gap as a range. Each manifest
carries `floor`, the signer's word that none of its batches at or below it
has a row still pending or nearby on its phone; a receiver sets
`mark = max(mark, floor)`, so a signer can hurt only its own entry. When a
sync moves the floor, `signUnsigned` signs a batch with no events to carry
it, and each phone keeps each signer's newest manifest after its rows go, so
the floor travels on. A signer's stored manifests have a budget of their own
(`NEARBY_BUDGET.maxManifestBytes`, 50 MB), and a manifest with no row under it
replaces that signer's last, so a flood of empty manifests holds one row. If
an author's phone is lost its gap stays open, which costs extra sessions and
nothing else. Measured in the fleet's `fiveInRoom` (seeds 1 to 5 alike), with
nobody working after the first meeting: one phone's trip to town moved its
summary, and the next meeting took 12 pairings (8 finished, 4 met a busy
phone) and 0.14 MB of claims and holdings before every room stopped; a
meeting after that took none.
Reverse if: open gaps make rooms in the field keep talking without moving
anything.
