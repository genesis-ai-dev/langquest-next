# Only the general, introductory tutorial videos have a tune, and it plays quietly under the voice

Date: 2026-11-18 · By: Caleb Koster · Status: accepted

Reason: the tutorial videos had a voice and no other sound (decision 177).
"How LangQuest works" is the first video that shows the whole app and teaches
no taps. Caleb heard it with a cheerful tune under the voice and chose to
keep the tune, for videos of that kind alone: "Only have the tune for
general, introductory videos. More detailed videos, like those that already
exist, shouldn't have a tune." A person who watches a video of one task or
one setting follows the steps on a phone at the same time, and a tune would
compete with the voice there.

- **Which videos.** A script says `tune: true` (`e2e/tutorials/tutorial.ts`).
  `e2e/tutorials/look.test.ts` lists the videos that have it, so one more is
  a change someone chose.
- **How quiet.** `compose.ts` evens the voice to -16 LUFS, then puts the
  tune under it at about -32 LUFS, 16 dB below the voice (`tune.ts`:
  12 dB taken off the file). It comes in over 1.2 seconds and goes over the
  last 3.6. Caleb's words for the level: "nicely quiet behind the voice.
  Subtle."
- **Which tune.** "Carefree" by Kevin MacLeod (incompetech.com), kept in the
  repository as `e2e/tutorials/tune/carefree.m4a`. Its licence, Creative
  Commons Attribution 4.0, permits use on YouTube and in the downloads, and
  asks for its credit. The credit is the last line of the video's
  description on YouTube (`playlists.ts`) and a tag in the film itself
  (`compose.ts`), which goes with a download. The tune is the same in every
  language.

Reverse if: people say the tune makes the voice hard to follow, or a
partner asks for videos with no music; the tune's licence changes or a
platform refuses it; or the videos get a tune made for LangQuest.
