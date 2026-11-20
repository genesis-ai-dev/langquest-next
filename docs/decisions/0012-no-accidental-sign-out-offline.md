# 12. No accidental sign-out offline

Date: 2026-09-14 · By: Ryder Wishart · Status: accepted

Reason: queued events belong to the signed-in user and cannot be sent under
anyone else. Sign-out lives behind a confirmation screen that refuses while
anything is queued or the device is offline, and shows why with icons
rather than words. The old header sign-out icon became the menu.

Amended (2026-09-28, Caleb Koster): being offline alone no longer refuses sign-out, and a
server refusal of this actor never traps them (PLAN.md section 11 step 4).
What refuses is work this session could still deliver: queued project and
org events, account changes and audio not yet uploaded. The screen says
which.

Amended (2026-10-03, Carl Sauder): on the web, signing out from "What brings
you here?" waits for queued account changes too, since there sign-out
forgets the browser (11, amended); a phone signs out there as before.

Amended (2026-10-05, Caleb Koster): on a phone, unsent work no longer
refuses sign-out; it is handed over and still goes as its author (60). The
count is only the signed-in person's own work, never another person's on the
same phone (`pendingCountBy`). The web keeps the refusal.
