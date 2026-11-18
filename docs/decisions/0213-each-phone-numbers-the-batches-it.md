# 213. Each phone numbers the batches it signs, and a teammate counts what it received by signer and number

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's answer 2 (2026-11-06): a batch counter, not clocks. A plain
clock vector cannot say what a teammate has received: `restamp` moves a
device's clock backwards, and a shared phone pushes one device's events out
of clock order, so a clock entry can claim an event that is on neither side.
So clock code and 15 stay as they are. Each phone signs up to 200 of one
author's events at a time with its install key, under a manifest listing
each event's id and digest (`packages/core/src/nearbySigning.ts`), so any
subset can be checked against it; `n` comes from this key's own counter,
never from a number a teammate sent. The vector records, per stream and per
signer's install key, a mark and a short list of ranges above it, in device
meta, written in the same commit as the events it counts, and it outlives
pruning. The security review keyed it by install key rather than device,
because a `deviceId` is only a label its caller chose (Carl's answer 21
kept that). Only a verified manifest moves an entry: pulled events and
claims never do, nor Have or anything else unsigned. A phone signs what is
unsigned before it broadcasts a summary (`SyncClient.signUnsigned`). Known
weakness, accepted with the answer: a phone restored from a backup could
reuse numbers, and teammates would skip those batches until the server has
them.
Reverse if: the real-phone test finds a phone restored from a backup keeps
its install key (plan section 11).
