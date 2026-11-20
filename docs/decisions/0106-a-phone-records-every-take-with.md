# 106. A phone records every take with the microphone module, keeps a part going down to half the cutoff, and keeps AAC

Date: 2026-10-14 · By: Caleb Koster · Status: partly superseded by 125

Reason: supersedes 13 in part. Decided 2026-10-12, logged as 106 when it reached main after the restructure. Recording on v3 felt flaky to Caleb, and v2's users had complained
of parts cut out. The detector was v2's unchanged (13), so the causes were
around it, plus one rule v2 had added in January (its #683). A replay of real
speech through `vadCore.ts` (the port of the native rules) showed the rule
at work: a real v2 recording played 3 dB quieter lost both of its parts.
Chosen, all on Caleb's word:
- **A part keeps going down to half the cutoff** (`sustainMultiplier: 0.5`,
  `src/recording/vadModel.ts`, both native modules and `vadCore.ts`).
  Starting still needs the cutoff; once a part is open, a frame above half of
  it counts as voice, for the pause and for the "too little to be speech"
  rule. v2 kept parts going at half the cutoff until #683 replaced that with
  one level for everything. In the replay nothing was lost; parts split a
  little less often, because soft sound fills some pauses.
- **A part too short to keep is said**: the module still deletes a part with
  under 250 ms of voice, and both workspaces now say so, and count it toward
  the "parts keep coming out clipped" hint (`useOnTooShort`).
- **The screen stays on while the microphone is recording**
  (`expo-keep-awake`), as v2 did (its #805). The recorder stops when the app
  leaves the foreground (45), so without it the screen timeout ended
  hands-free sessions. The microphone permission prompt no longer counts as
  leaving.
- **The microphone stays open while the source plays.** Playing the source
  pauses the detector only (`pauseVad`; the open part is kept, untrimmed),
  and when the source stops the detector starts again at once
  (`resumeVad`), with what was heard meanwhile dropped from its head start.
  Before, the recorder stopped and restarted from cold, which lost the first
  words said after the source. While a session holds the microphone,
  playback leaves the audio session in recording mode
  (`holdMicrophone` in `audioSession.ts`) and the source players keep the
  session active when they pause (`LISTEN_PLAYER`), which on iOS would
  otherwise stop the microphone.
- **A phone records hold-to-record takes with the microphone module too**
  (supersedes 13's second recorder on phones): the take is the module's own
  segment, opened as soon as the microphone is, so it no longer waits for
  expo-audio to prepare, and a phone never has two recorders open (Android
  before 10 lets only one capture at a time). Moss Doerksen made the same
  change in v2 on a branch that was never merged. A browser still records
  takes with expo-audio (MP4 where it can).
- **A phone keeps AAC.** A finished WAV is re-encoded to AAC in MP4 (mono,
  128 kb/s, hold-to-record's old bitrate) by the module (`encodeAac`:
  MediaCodec on Android, AVAudioFile on iOS) before it is stored: about
  0.96 MB a minute instead of 5.3 MB. The journal names the AAC copy before
  the WAV is deleted; if encoding fails the WAV is kept. The web keeps WAV.
  Every reader already takes both (58).
- Android reads whole 2048-sample frames from a 0.37 s buffer, and meter
  events no longer make the capture loop wait for the main thread, so a busy
  phone does not drop audio. The cutoff line and the level bars are drawn on
  one scale (`meterHeight`), so a bar reaches the line exactly when the
  detector hears it.
Reverse if: parts run together in noisy rooms (the room's noise reaching
half the cutoff; raise `sustainMultiplier`), AAC encoding fails or is too
slow on low-end phones (keep WAV there), or iOS stops the microphone during
source playback anyway (go back to stopping it, and restart with a larger
head start).
