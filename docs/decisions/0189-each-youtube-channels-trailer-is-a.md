# 189. Each YouTube channel's trailer is a 48-second film of today's app in its language, made each night when it changes, and the publish job sets it

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked for the team film "From the ground up" to be made again with
today's screens, in each app language, as each channel's landing video, and
for its count to say over a million. Decided:
- **Made from the app, as the videos are** (`e2e/tutorials/trailer/`): a
  capture opens the app in the film's language as the UI tests do and keeps
  Chrome's screencast frames with when each moment starts and where its parts
  are; a page draws every frame from the time alone, on the original's
  timeline and score, cropping those frames into cards; Chromium renders it,
  four moments to a frame for motion blur. No editor and no hand-made screens,
  so the film stays true as the app changes, and the fifteen languages are
  one script.
- **Its own words** (`words.json`): nineteen lines in the fifteen app
  languages. The count is a round number passed, "1,000,000+" as of
  2026-10-29 (`CLIPS`, `AS_OF` in `trailer.ts`).
- **Made again only when it changed** (decision 183): its look is the words
  of the seven screens it shows, made steady by `look.ts`, with its page,
  renderer, capture, score and words; a new look is captured again and made
  when it holds. It goes into the release and the manifest as the video
  `trailer`, so the intake, Publish, the downloads and the links to the other
  languages take it as they take a video.
- **The channel's trailer**: once it is up, the publish job puts it first in
  the playlist for everyone and sets it as the trailer for people who have
  not subscribed (`brandingSettings.channel.unsubscribedTrailer`,
  `server/youtube.ts` `brandChannel`), keeping the channel's other settings.
  A channel's look (decision 184) includes its trailer once one is up
  (`ops_youtube_channels` says which video the newest became), so a trailer
  that could not be set at once is set on the next run. It goes up without YouTube's "altered or synthetic" label, which the videos
  carry for their made voices: the trailer has no voice, only the score and
  the app's own screens.
- **The original's score** (`score.m4a`, 48 seconds, copied without
  encoding it again): the film's timing is built on its beats.
Reverse if: YouTube drops channel trailers or the API's setting for them; or
the trailer's look changes most nights without the app changing, which would
spend a channel's uploads.
