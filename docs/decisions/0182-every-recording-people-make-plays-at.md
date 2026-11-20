# 182. Every recording people make plays at −16 LUFS, from a copy made on the device the first time it plays

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb's go on the audio work (2026-10-28, thread "Build audio
clean up in the app") took in loudness evened on every part by default,
with no button, at −16 LUFS (Apple Podcasts' level, Caleb 2026-10-27).
Partners record on different phones, at different distances from the
mouth, so a reviewer turning the volume up and down between parts is the
common case.
- **A copy plays, the recording never changes.** What is uploaded, synced
  and reviewed stays as it was recorded (or cleaned, 179). The player plays
  a copy turned by `playGainDb` (`loudnessModel.ts`): −16 minus the part's
  loudness, never more than 24 dB up (`MAX_BOOST_DB`), since a part that
  quiet is mostly a phone held far away and turning it up further mostly
  turns up the room. A part within half a decibel of −16, or a silent one,
  plays as it is (`levelModel.ts` `needsCopy`). The noise warning (181)
  now reads the room as the part plays (`roomAsPlayed`), with that cap.
- **Peaks held at −1 dB.** Turned up whole, a quiet part's loud syllables
  would clip. A limiter (`levelModel.ts` `limiter`) looks 5 ms ahead and
  bends the gain down before a peak, so no sample goes over −1 dBFS and the
  gain never steps, which would click; it comes back over 100 ms. Holding
  peaks down takes loudness with it (a reading with syllables 20 dB over
  its loudness came out 2.7 dB short), so the copy is measured as it is
  made and made again turned up by what it fell short, at most 3 times in
  all; that reading ends within 1 dB of −16.
- **Made on the device, the first time it plays.** Nothing is uploaded and
  no event is written: every device that plays a part makes its own copy,
  and the measure is kept by the hash of the audio, as 181 keeps it. A
  phone writes a 16-bit WAV to its cache (`levelCopy.ts`, at most 150 MB,
  oldest first; the phone may clear it, and a copy is made again when the
  part next plays). The web keeps a WAV blob in the page's memory (48 MB),
  since a browser's player cannot turn a sound up and Safari on an iPhone
  ignores its volume. While one part plays, the next one's copy is made.
  If a copy cannot be made, the recording itself plays.
- **The phones run it natively.** A phone's JavaScript is too slow for
  every sample of a part, so the meter and the limiter are ported line for
  line to Kotlin and Swift (`Level.kt`, `Level.swift`, in the microphone
  module); `test/levelModel.test.ts` holds the TypeScript, and both ports
  were checked against it on seven test recordings (44.1 and 48 kHz, quiet,
  loud, peaky, short and silent), the same samples to the bit. The module
  decodes AAC too, so phones now measure parts they did not record (181).
- **What plays at even loudness**: parts, voice notes and spoken feedback,
  wherever they play (`levelStore.ts` `playable`), and Clean up's previews
  and the parts heard while recording, as passing copies of which only the
  last four are kept. Source audio, reference material, Bible audio and
  help play as they are: they are mastered by whoever published them. A
  part streamed from the server plays as it is until it is on the device.
- The native code is new, so this ships in a store build, not an OTA
  update.
Reverse if: people hear the limiter (a pumping or a dulled voice), the
first play of a long part waits noticeably on the phones we support, or
partners want parts played as recorded (then a switch in settings, not a
button on each part).

Amended (2026-10-30, Caleb Koster): a part whose loudness stands less than
5 dB over its own room (`VOICELESS_DB`) is room alone, a silence kept as a
part (194) or a voice lost in the room, and plays as recorded: turned up by
up to 24 dB, it would play its hiss as loud as a voice. Room alone measured
3.5 dB at most (white, pink and brown noise, mains hum, a fan); speech 6 dB
over its room, 5.6 dB at least. `Level.kt` and `Level.swift` take the same
line from `LEVEL`, so this too ships in a store build.

Amended (2026-11-04, Caleb Koster): a play waits for its copy at most half
a second (`READY_MS`), then plays the part as recorded; the copy goes on
and plays the next time. The first play of a part was the "Reverse if"
case: Caleb, on a Galaxy A05 right after recording two-second parts
(LAN-224), tapped Play on each and saw Pause for far longer than the part
with no sound, and the same in Clean up; on the web with the processor
slowed eight times, a part waited about a second and a part in Clean up
13 seconds. Caleb chose all four of these on 2026-11-04:
- **A spinner in place of Pause** until the first sound, in every player
  of the recordings people make (`PlayGlyph` in `ui/kit.tsx`, `loading`
  from `useClip`, AudioClip, ClipPlayer, the review chip). Tapping it stops,
  as Pause would.
- **Half a second, then as recorded.** Even loudness on a first play is
  given up only when the phone is slow; the next play is even.
- **The part tapped goes first.** Copies and measures (181) run one at a
  time (`levelTurns.ts`), as the microphone module does them on one thread;
  the part someone is waiting to hear goes ahead of the next part's copy
  and the other rows' measures.
- **How long plays wait is recorded**: the `audio` tally's `waits`,
  `waitMs` and `maxWaitMs` (docs/diagnostics.md), so the watch for user
  issues (202) shows them under a problem sent from a phone.
JavaScript only, so it ships in an OTA update.
