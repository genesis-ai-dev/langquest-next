# 90. A phone wakes sync when its network comes back, and with no signal polls at most every half hour

Date: 2026-10-12 · By: Carl Sauder · Status: accepted

Reason: the fleet simulator showed a phone out of signal woke sync every
five minutes, the scheduler's backoff ceiling, for as long as the app was
open: about 280 times a day on a phone that may be out of reach for weeks.
On a phone nothing woke sync when the network returned (`wake.ts` listened
for that only on the web), so the poll was the only way back. Carl chose
(2026-10-12, LAN-47) to do both: wake on the operating system's network
state (`expo-network`, `apps/mobile/src/networkWake.ts`, at most once in
ten seconds while the signal comes and goes), and let the offline backoff
go on to 10 and then 30 minutes (`SyncScheduler`). The poll stays as the
safety net, since a phone can report a network that cannot reach the
server (a captive portal, a SIM with no data left); it no longer carries
the latency. `expo-network` adds no Android permission and collects
nothing (`play-store-declarations.md`). Fleet `village-small`: 2,962 wakes
with no signal instead of 16,799, and work reached the server as fast.
Reverse if: phones are seen not to report a returning network, so work
waits for the half-hour poll (then a shorter ceiling, or a reachability
check of our own).

Amended (2026-10-13, Carl Sauder): losing the network wakes sync too: a
browser's `offline` event, and on a phone the connected-to-disconnected edge
(`wakeOnReconnect`'s `onLoss`, at most once in ten seconds). The attempt
fails at once, so My Work says "Offline" when the signal goes, instead of
40 to 50 seconds later when the live channel times out (SYNC-002, SYNC-007).
It costs one failing attempt per loss.
