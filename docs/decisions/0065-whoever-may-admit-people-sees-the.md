# 65. Whoever may admit people sees the name of each person asking to join

Date: 2026-10-07 · By: Carl Sauder · Status: accepted

Reason: an admin cannot decide on a join request without knowing who is
asking. Profile names were readable only between people who share an
organization (`profile_visible`), and a requester is not a member until
admitted, so every request showed the colour-and-shape placeholder.
`profile_visible` now also lets a caller read the profile of anyone with a
pending request to an organization where the caller holds `invite_members`
at organization level, the same test the `join_requests` read policy uses
(`20261007140000_admins_see_requesters.sql`). The name shows from the
request until it is decided; after that the person is a member (and visible
as one) or, if turned away, no longer visible. `pendingRequests`
(`apps/mobile/src/invites.ts`) reads the names with the requests, since a
request can arrive after the app read everyone's names.
Reverse if: requesters need to stay anonymous until admitted; then the
request itself should carry the name the person chose to give.
