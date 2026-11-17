# 184. The publish job keeps each YouTube channel's description, banner and list of the others; held comments are counted on the dashboard and moderated in Studio

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Plan tutorial videos and keep them
current") asked that each channel be set up in its own language, with its
own look, a description and links to the other language channels, and that
inappropriate comments be held for review.
- **The publish job sets each channel's look** (180, `server/youtube.ts`
  `brandChannel`): a description in the channel's language with the app's
  address (`WORDS`, machine translations as the app's catalogs are, 81),
  the channel's language, a banner with the app's mark and "Tutorial
  videos" in that language (`apps/mobile/public/youtube`, drawn by
  `e2e/tutorials/banners.ts`), and the list of the other 14 channels. The
  channel's other settings are sent back as they were. It runs before any
  upload, only for a channel whose hash of all of these (`brandOf`)
  differs from the one last put on it, so it costs about 150 of the day's
  10,000 units once, and again only when the words or a banner change.
  The picture is the one thing YouTube's API cannot set; it is set by hand
  in Studio (`docs/admin.md`).
- **Held comments are counted, not moderated, on the dashboard.** Each
  channel holds comments that may be inappropriate (a Studio setting, set
  by hand). The publish job counts each channel's held comments once a day
  (up to 500), and the dashboard shows each count linked to that channel's
  comments in Studio, with a line in Needs attention when any wait.
  Approving and removing stay in Studio, as moderating stays out of the
  dashboard (162).
Reverse if: YouTube's API stops taking a channel's description, language
or banner; or held comments come often enough that going through Studio
channel by channel is a burden (then the dashboard approves and removes).

Amended (2026-10-29, Caleb Koster): YouTube refused Hausa's look
(`brandingValidationError`) with its language and again without it, and
kept only that code, so nobody could see why. A refused look now goes on
without the channel's own settings as well (its keywords and country, sent
back unchanged until now and cleared then), keeping only the description and
the trailer; one still refused keeps the field YouTube named beside the code
(`ops.youtube_channels.brand_failed`), never YouTube's message.
