# 239. An author's phone does not tell teammates of a refusal; their copies settle at the server

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: an event the server refused from its author is shown refused on the
author's phone, but a teammate's copy stays folded until that teammate
reaches the server, when the sweep or delivery settles it
(docs/nearby-sync-plan.md 5.7 and section 6). The first design had the
author's phone tell teammates at their next exchange, and they would drop
it, but a dropped id is unknown again and can come back from a third phone,
so that message is not built. It can be added later as an ability with no
new protocol version.
Reverse if: teams offline for long see refused work on their screens long
enough to matter.
