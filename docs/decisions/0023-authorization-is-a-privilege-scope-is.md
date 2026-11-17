# 23. Authorization is a privilege, scope is on the membership

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: UX spec A38. Roles are named privilege sets; a membership grants a
role at org, project or lane scope; an event needs one privilege
(`EVENT_PRIVILEGE`, mirrored in SQL `event_privilege`). The five fixed roles
are seeded as roles with the spec's privilege sets and `effectiveRole` maps
any privilege set back onto them, so workflow steps, eligibility and storage
policies keep speaking `Role`. Reverse if: partners never define a custom
role; then the seed roles are simply all there is. (An event may now need
any one of several privileges: 31.)

Amended (2026-10-06, Carl Sauder): scope is `org` or `language` (63);
the project and lane levels are gone, and a person holds one role per scope.

Amended (2026-10-09, Carl Sauder): a grantor grants only what they hold (75).
A role given, invited to or admitted to may carry no privilege the grantor
lacks at that scope; a role changed or removed must be one they could have
granted; a role defined or retired likewise. Holding Invite is no longer
enough to make someone, or oneself, Owner.
