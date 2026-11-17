# 1. Event log over state replication

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: every recurring failure in LangQuest v2 and Codex traces to merging
mutable state. See PLAN.md section 2. Reverse if: a use case appears that needs
real-time co-editing of one artifact, in which case add a CRDT for that
artifact only.
