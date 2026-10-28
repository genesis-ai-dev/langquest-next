# Tutorial videos

Short how-to videos, one per thing a person does in LangQuest ("Record a
passage", "Invite your team"), in every app language. Each is a script in
`e2e/tutorials/` that the app plays through on the web export, filmed frame by
frame, with a computer voice saying the script's lines. Decision 177 says why
they are made this way.

## Making them

```sh
npm run db:start
npm run library:seed -- --sources --timings library/timings/bsb-fs
bash e2e/ui-web.sh &                                   # the web export on :8787
npm run tutorials                                      # every video, every app language
npm run tutorials -- --language es record-a-passage    # one video, in Spanish
npm run tutorials -- --dry --language ar               # a picture of each step, no voice or film
```

Videos land in `e2e/results/tutorials/<language>/<id>.mp4`; each film's
frames, sound and log are in `e2e/results/tutorials/films/<language>/<id>/`.
A step that cannot finish leaves `failed-step-<n>.png` and
`failed-step-<n>.txt` (the screen's accessibility tree) there.

Gemini needs a key: `GEMINI_API_KEY`, or a network that adds it to requests
to generativelanguage.googleapis.com. The key's Google project must have
billing on, since the Batch API is not offered on the free tier. The key is
kept encrypted in `.env.production` (`npm run env:update -- production
GEMINI_API_KEY`); run with it as `npx dotenvx run -f .env.production -fk
.env.keys -- npm run tutorials`.

## The parts

| File | What it does |
| --- | --- |
| `all.ts`, `<id>.ts` | the scripts: who is signed in, the world they start from, each step (what is lit, what is said, what is tapped) |
| `film.ts` | plays one script against the web export and keeps every frame with its time, when each line is said, what the speaker says into the microphone and what the app plays aloud |
| `compose.ts` | puts a film together as an MP4: the frames in a phone (or a browser window, for web videos) under the title, and the sound evened to -16 LUFS |
| `gemini-voice.mjs` | says lines with Gemini's text-to-speech, through the Batch API |
| `translate-lines.ts` | translates each video's title and lines into `lines/<language>.json` |
| `readings.ts`, `make-readings.ts` | what the people in the videos say, and saying it into WAV files |
| `ui.ts` | finds what a script names in English on a screen in any app language |
| `make-videos.ts` | `npm run tutorials`: all of the above, three films at a time |

## Voice

The narration is Gemini's `Sulafat` voice; Grace (who reads the made-up
language, in French) is `Leda` and Ruth (who reviews, in the film's language)
is `Aoede`. A line's recording is named by its words, so only changed lines are
said again. Gemini allows a project 100 speech requests a day outside the
Batch API; the batch has no daily cap, costs half, and takes a few minutes a
job. It has no place for a speaking style, so the voice is a little quicker
than one asked to be unhurried. Jobs of more than about 100 lines come back
with many lines turned down ("Precondition check failed"), so
`gemini-voice.mjs` sends 100 at a time and sends the turned-down lines again.

## Other languages

A script is written once, in English. In another language:

- **What is said** comes from `lines/<language>.json`, keyed by the English.
  `translate-lines.ts` fills in what is missing with Gemini, told the app's own
  words for what each line names (from `apps/mobile/src/i18n`), so the voice
  says "Toca Guardar" when the button says "Guardar". Like the app's catalogs
  (decision 81), these are machine translations.
- **What is found on the screen** is translated as it is looked for. `ui.ts`
  patches Playwright's `getByText`, `getByRole` names and the rest: a script's
  `'Save'` or `/^Parts 1–4, 4 parts · /` is looked up in the English catalog
  and becomes what the film language's catalog says, with its values (numbers
  in that language's digits, names as written) in their places, or the
  English. Names that are data rather than the app's words (a library item,
  a person) stay as written; `asIs()` marks one the catalogs would otherwise
  translate.
- `notIn` on a script skips a language it cannot be made in ("Choose the
  app's language" switches to Arabic, so it is not made in Arabic).

## On YouTube

Each app language has its own YouTube channel (decision 180). A version filmed
is kept in R2 by its hash and listed on the ops dashboard's Tutorial videos
section, where a person watches it and chooses to put it up; the publish job
uploads it. Connecting the channels and publishing are in `docs/admin.md`
("Tutorial videos on YouTube").
