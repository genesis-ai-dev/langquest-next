# 15. Device identity and clocks are persisted

Date: 2026-09-15 · By: Ryder Wishart · Status: accepted

Reason: the fold's last-writer-wins registers depend on HLCs being unique
across devices and monotonic on each one. The first mobile build used the
same device id everywhere and forgot its clock on restart; on a phone whose
clock was corrected backwards, a user's newer decision lost to their older
one. Now `ensureDeviceId` mints one id per install and the client persists
the last clock. The reducer also breaks exact HLC ties by event id, so even a
future id collision cannot make state order-dependent.
