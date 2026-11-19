# 177. Tutorial videos are filmed from scripts that play the web export, voiced by Gemini, and made in every app language from one English script

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Plan tutorial videos and
keep them current") asked for a short how-to video for each thing a person
does in LangQuest, in all 15 app languages, kept current as the app changes,
and said to make all of them (about 705) and the pipeline that keeps them
current (`docs/tutorial-videos.md`).
- **A video is a script, not a screen recording.** Each is a file in
  `e2e/tutorials/` that plays the app on the web export from the UI tests'
  fixture world (102): who is signed in, what is lit, what is said, what is
  tapped. Chrome's screencast keeps each frame with its time, and
  `compose.ts` puts the frames in a phone (or a browser window) with the
  voice, what the speaker says into the microphone and what the app plays.
  A changed screen is filmed again by running the script, in every language,
  with nobody recording.
- **One computer voice, Gemini's, in every language.** Gemini's
  text-to-speech speaks all 15 app languages in the same voice. Lines go
  through its Batch API (`gemini-voice.mjs`): outside it a project may make
  100 speech requests a day, and the batch has no daily cap and costs half.
  It takes no speaking style, so the voice is a little quicker than an
  unhurried one. A line's recording is named by its words, so only changed
  lines are said again.
- **Other languages come from the English script.** Lines are translated by
  Gemini, told the app's own words for what each line names, so the voice
  says what the screen shows; they are machine translations like the app's
  catalogs (81). What a script finds on the screen is translated as it looks
  (`ui.ts`): its English is looked up in the catalogs and replaced by what
  the film's language says, or kept where the screen shows data as written.
  The scripts stay one readable English text instead of fifteen.
- **The made-up language is read in French** (Louis Segond 1910) by another
  Gemini voice; what the reviewer says in her own words is said in the film's
  language.
Reverse if: partners find the computer voice or the machine-translated lines
hard to follow in a language (then those lines are recorded or checked by a
speaker), or Gemini stops offering batch speech.
