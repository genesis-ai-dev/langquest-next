# 31. An event may need any one of several privileges

Date: 2026-09-28 · By: Caleb Koster · Status: accepted

Reason: the demo lets whoever ran a community check log it, translator or
reviewer (its design principle 5), and lets any contributor set a step
aside. One privilege per event type cannot say that. `EVENT_PRIVILEGE` may
name a list, and SQL `event_privilege` returns it comma-separated for
`may_emit` to test by overlap; `scripts/record-parity-sql.ts` holds the two
together. Reverse if: roles become fine-grained enough that each such act
has its own privilege.
