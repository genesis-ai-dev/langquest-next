# 100. "Join your team" has no Back to Sign In, unlike the partner demo

Date: 2026-10-13 · By: Carl Sauder · Status: accepted

Reason: the demo's flow has an edge from the intent chooser back to Sign
In. In the app the person is already signed in there, so Back would only
look like signing out without the unsent-work check of 12. Sign out is its
own action on that screen. The edge is dropped deliberately, listed in
`DROPPED_EDGES` (`apps/mobile/src/flow.ts`), and the parity test checks that
it is a real demo edge the app does not have (NOORG-003).

Reverse if: the demo's flow gets a signed-out chooser. Then the edge
belongs back.
