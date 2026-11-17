# 2. Intent events with per-type merge rules, not a CRDT library

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: the domain's writes are per-actor appends and a few registers. Two
merge shapes cover everything. A library adds a dependency and a mental model
for no gain. Reverse if: more than a handful of event types need non-trivial
merge behaviour.
