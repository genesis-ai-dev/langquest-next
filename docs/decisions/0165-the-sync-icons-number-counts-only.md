# 165. The sync icon's number counts only what this device has to send; its ring also turns while others' recordings download

Date: 2026-10-23 · By: Carl Sauder · Status: accepted

Reason: the header's sync icon (d5515aae) counted events, uploads and
downloads in one number, and named it "N to send". A phone with one note
waiting said "Offline, 26 to send" while 25 recordings came down, which is
untrue, and the nightly UI suite caught it (NAV-095, WEB-027; LAN-96).
Counting sends only would have hidden downloads from the header: a phone
still receiving would look idle, and someone could go offline before their
team's recordings had arrived. Carl chose (2026-10-23):
- **The number and the spoken name** count events (language and
  organization) and recordings not yet uploaded: "Live, 2 to send"
  (`iconCounts` in `apps/mobile/src/sync/syncStanding.ts`).
- **The ring** turns for anything in flight, recordings coming down too.
  With nothing to send and recordings coming down, the name says
  "Live, receiving recordings" and help mode says the ring is downloads.
- **The Sync screen** keeps "To send" and "To receive" apart, as before.
Reverse if: people read a turning ring with no number as stuck, or ask how
many recordings are still coming (then the icon gets a second count).

Amended (2026-11-07, Carl Sauder): a teammate's recording held here and
not yet on the server counts in the number and the spoken name as waiting to
upload, because it is true of this phone (`docs/nearby-sync-plan.md` 5.8):
`iconCounts` adds the language's `holding` to `pendingUp`, as do Sync's
upload line and More settings' sync line. The sign-out check and the leave
guard still count only the person's own (`pendingUp`, `useUnsent`), since a
teammate's file neither holds a session on the phone nor goes up as its
person (60 as amended). Sync also says "Holding N for teammates" whenever the
phone holds some, even after the organization turns nearby off.
