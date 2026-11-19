# 24. Refusals carry a code, and membership refusals retry themselves

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: audit L1. A month of work refused because a role changed offline is
not lost (invariant 1) but was stuck. The server authorizes as of the
event's own clock within a window, and the client re-queues membership
refusals when a pull shows the actor's membership changed. Clock-ahead
refusals re-stamp the clock and keep the event ids. Invalid payloads never
retry.

Amended (2026-10-06, Carl Sauder): the server no longer authorizes as of the
event's clock; it decides by the membership it holds now (63), and the
membership-row and as-of paths are gone. The client re-queues `NOT_MEMBER`
and `NOT_ALLOWED` refusals when the organization stream changes a membership
or a role (`onMembershipChanged`), and re-queues `NOT_LISTED` ("language not
listed yet") on every push, since a new language's own events can reach the
server before the organization's `LanguageAdded`.
