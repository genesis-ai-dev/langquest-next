# 98. An organization always keeps someone who can manage roles

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: nothing stopped an admin removing themselves, demoting the last
admin, or taking Manage roles off the only role that had it. Then nobody
could give it back except support. The UI test suite found it (PEOPLE-026).
The server refuses any membership or role change that would leave no
org-scope member with a live role holding Manage roles
(`_grant_refusal`, `20261013150000_keep_a_role_manager.sql`,
`server/grantsSmoke.sql` 11). Core `leavesNoRoleManager` mirrors it, so the
member page says "You are the only one who can manage roles" and offers no
Remove or demotion (`screens/org.tsx`). Removing yourself while another
admin remains is still allowed, as before (75).

Reverse if: organizations need to be handed back to support on purpose.
Then that is a support tool, not a gap in the rule.
