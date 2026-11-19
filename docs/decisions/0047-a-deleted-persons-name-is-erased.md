# 47. A deleted person's name is erased from the log, the one edit the log allows

Date: 2026-09-30 · By: Caleb Koster · Status: accepted

Reason: creating an organization wrote the creator's name (their email's
local part) into `v1.OrgMemberAdded.displayName`, so deleting the account
could hide the name (a `v1.Redacted`) but not remove it, and the privacy
policy says the name is deleted. Two changes, chosen over disclosing that
the name stays. Names stop entering the log: Create Organization saves the
creator's profile name instead (`profiles`, which deletion removes), and
`createOrganization` no longer takes one; the field stays in the event type
so old events fold. And the one name already in the log can be erased:
`events_immutable` now lets through a single kind of update, removing
`displayName` from an `OrgMemberAdded` whose `profileId` is the person
being deleted, only while `_delete_account` has set
`langquest.erase_profile` to them, and only if nothing else in the row
changes. Every other update and every delete is still refused
(`server/delete-account-smoke.sql`). The event is also redacted, so phones
that already hold it stop showing the name, and that organization's
snapshots are dropped to be rebuilt from the log. Copies on phones keep the
bytes until the app is removed; the fold never shows them. Partly supersedes
16.
Reverse if: event integrity comes to depend on payload bytes (a hash chain
or signatures), which would need erasure designed in (for example,
encrypting personal fields with a per-person key and deleting the key).

Amended (2026-10-06, Carl Sauder): with the catalog restarted at `v1` (63),
no event type has a `displayName` and nothing in the log holds a name, so
`events_immutable` has no exception any more: the log refuses every update
and delete, and account deletion only appends `MemberRemoved` events.
