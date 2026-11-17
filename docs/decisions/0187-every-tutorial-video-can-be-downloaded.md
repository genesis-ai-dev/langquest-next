# 187. Every tutorial video can be downloaded from LangQuest, by a link that lasts and from a page of them all; YouTube's descriptions give both

Date: 2026-10-29 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-29, thread "Plan tutorial videos and keep them
current") asked that every video be available to download from LangQuest,
with download links to LangQuest on the videos on YouTube, kept up to date
along with the videos. The pipeline plan had promised it (real downloads and
links that never break), and nothing had been built. YouTube offers no file
to keep: its offline download works in about 125 countries, stays inside the
YouTube app and needs it to reconnect every 48 hours, and some countries
block YouTube. Decided:
- **A lasting download link per video and language**:
  `next.langquest.org/v/<language>/<video>.mp4`
  (`apps/web/worker/tutorialVideos.ts` `handleDownload`) goes on to the
  newest version a person chose with Publish (`ops_tutorial_download`), as a
  file to keep (`?download` on the R2 file, named
  `langquest-<video>-<language>.mp4`). While none is chosen, or when the
  database cannot say, it opens the language's videos page. Like the watch
  links (decision 183) it is asked about at most every five minutes.
- **The chosen version, not the uploaded one**: Publish is the person's
  choice (decision 180); a download follows it at once instead of waiting for
  YouTube's 100 uploads a day, which takes a week for the first full set. A
  new version can be downloaded before YouTube has it.
- **A page of them all**: `next.langquest.org/videos`
  (`apps/web/worker/videosPage.ts`, `ops_tutorial_list`) in the reader's
  language (`?lang=`, else the browser's), grouped by who each video is for,
  each with Download and its size, Play (the file in the phone's own player,
  so no YouTube is needed) and Watch on YouTube once a version is up. Written
  by the Worker like the review and connect pages, its words in the 15
  catalogs of `apps/web/worker/i18n/`; cached five minutes.
- **YouTube gives both**: each video's description has a download line under
  the app's address (`e2e/tutorials/playlists.ts` `youtubeText`), and each
  channel's description links the page (`server/youtube.ts` `channelAbout`),
  in the channel's language (`WORDS.download`, `WORDS.allVideos`). A
  description is set when a version is uploaded and never changes after, so
  the link had to be one that outlives versions. Changing the channel's
  description changes its look, and the publish job puts it on each channel
  once.
- **Nothing in the app changes**: the help mode play button and Me's videos
  from the pipeline plan are a later change, with the store answers it
  needs.
Reverse if: R2's egress stops being free and downloads cost more than they
help; or the videos move to a host that gives lasting files itself.
