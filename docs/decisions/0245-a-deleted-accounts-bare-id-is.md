# 245. A deleted account's bare id is kept, so no chain can bring it back

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: a newcomer's id follows from their key (241), so a chain kept on a
phone could make an account with the id of one deleted since, and
`accountdeleted:` events are written only for live memberships, so the log
cannot say who was deleted (docs/nearby-sync-plan.md 14.1, step 6).
`_delete_account` now also writes the bare id to `deleted_profile_ids`, a
table only the service role reads, and `nearby_join_state` refuses any id
in it. It holds the id alone, which names nobody once the account is gone,
so account deletion (46) and Data safety stay true (section 9). Migration
`20261112050000_nearby_join.sql`.
Reverse if: deletion must leave no trace of an id at all, then refuse ids by
another proof.
