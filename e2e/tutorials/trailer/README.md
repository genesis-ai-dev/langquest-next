# The channel trailer

A 48-second film about LangQuest Next, in each app language, that each
YouTube channel shows to people who have not subscribed yet (decisions.md
189, `docs/tutorial-videos.md`). It is the October 2026 team film "From the
ground up", made again on today's app: the same score and timeline, with the
app's own screens in the six steps.

| Time | What it shows |
| --- | --- |
| 0–5 s | The count: audio clips recorded with LangQuest, rolling up to 1,000,000+ |
| 5–15 s | Each one deserves a safe place; rebuilt from the ground up; the name |
| 16–36 s | Six steps on the app: Listen, Speak, Offline, Heard, Kept, Decides |
| 36–42 s | The count again, a square for every thousand clips |
| 42–48 s | The name, the line, langquest.org |

## The parts

- `capture.ts` opens the app as the UI tests do, in the film's language, and
  films what the six steps show: Grace listens to Luke 13:31-35, records it
  with no signal, gets it up when she is back in range, finishes it and asks
  for the Peer check, then opens a passage's history; Samuel, starting an
  organization, picks who may use its work. Chrome's screencast keeps every
  frame with its time (`frames/`); `capture.json` says when each moment
  starts and where its parts are on the screen; `steps/` keeps the words of
  the screens the film shows, for its look.
- `film.html` draws every frame from the time alone (`window.__seek(t)`):
  the night, the words landing, and the app's frames cropped into cards.
- `render.ts` loads the page in Chromium with the capture, the language's
  words and its fonts (from Google Fonts, only the letters it needs),
  screenshots each frame, blends four moments into each for motion blur
  (`--sub 4`), and lays `score.m4a` under it.
- `words.json` is everything the film says, in each app language; "*...*"
  is the accent colour.
- `trailer.ts` is the film's look, the count and its date (`CLIPS`,
  `AS_OF`), and its title and description on YouTube.

## Each night

`nightly.ts` captures it after the videos. When its look (the steps' words
made steady as a video's are, `look.ts`, with the files above and the
language's words) is not the look of the film the release keeps, it is
captured again, as a video's dry run is, and made when the new look holds.
It goes in the language's manifest as the video `trailer`, first in the
playlist for everyone. The publish job uploads it like a video, without
YouTube's "altered or synthetic" label (no voice is made), and makes it the
channel's trailer (`server/tutorialPublisher.ts`).

## By hand

```sh
# The local stack and the export served, as for the UI tests (docs/testing.md).
TUTORIAL_LANGUAGE=fr npx tsx e2e/tutorials/trailer/capture.ts       # e2e/results/trailer/fr
npx tsx e2e/tutorials/trailer/render.ts --lang fr --stills 3,17.8,28.5  # PNGs to look at
npx tsx e2e/tutorials/trailer/render.ts --lang fr --sub 4               # the film
npx tsx e2e/tutorials/nightly.ts --language fr --release <dir> --out <dir> trailer
```

The capture needs Grace's English readings
(`e2e/results/tutorials/speech/en`, `make-readings.ts`): her parts then fall
the same way in every language.

To change the count, change `CLIPS` and `AS_OF` in `trailer.ts`; every
language is made again that night.
