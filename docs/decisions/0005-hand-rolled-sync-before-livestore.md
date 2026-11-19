# 5. Hand-rolled sync before LiveStore

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: the core is a reducer, a SQLite cache, and two endpoints. LiveStore is
pre-1.0 and its one-log-per-store model only fits now that the partition is
the project. Reverse if: the reactive query layer or multi-tab handling
becomes a real cost, once LiveStore is stable.
