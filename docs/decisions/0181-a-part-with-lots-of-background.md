# 181. A part with lots of background noise wears an orange warning, measured on the device from its loudness and the room between its words

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb's go on Clean up (2026-10-28, 179) took in the warning in his
mockup 12: a noisy part shows an orange triangle, and a tap shows the noise
and offers Clean up for that part. The options doc said the line would be
picked from real recordings, starting near −45 dB.
- **What counts as noisy.** The room between words, heard as it would be
  with the part at −16 LUFS (Apple Podcasts' level, Caleb 2026-10-27),
  louder than −40 dB (`loudnessModel.ts` `NOISY_DB`). Loudness is
  BS.1770's (K-weighted, gated). The room is the 5th percentile of the
  part's 25 ms slices, each slice's spread about its own middle so an
  offset is not taken for noise. On 118 parts of read recordings (FLEURS
  and LibriVox) cut as the recorder cuts them (140 ms before the first
  word, 300 ms after the last), it read at most 5.8 dB over the noise in
  Silero's speech-free stretches (19 parts in 20 at or under it), and
  about 3 dB under it at the middle.
  The first try, a tenth of 50 ms slices, read up to 25 dB high in parts
  with few pauses.
- **The line.** On the 105 FLEURS parts (Hausa, Yoruba, Vietnamese and
  Mandarin, read by native speakers outside a studio), −45 dB marked 54 %,
  −40 marks 26 % and −35 marks 11 %. A warning that says "lots of background
  noise" should not be on half of everything, so the line is −40. The
  trial's part 4, whose noise rose to −38 dB when it was turned up, is
  over it, and a café 5 dB under the voice is −25.
- **Where it is measured.** On the phone that records a part, from its WAV
  while it is encoded to AAC (`useRecorder`), kept by the hash of its audio
  on that phone (`loudnessStore.ts`); the web decodes any part. A phone has
  no AAC decoder in JavaScript, so on a phone a part recorded elsewhere, or
  before this change, has no measure and no warning: only a measured part
  is marked. The measure is never synced or sent. This is JavaScript only,
  so it reaches the builds that have Clean up (179) as an OTA update.
- **What it shows.** The triangle sits where the grey ear does. A part kept
  as recorded shows the ear instead, and a part `mayCleanUp` refuses (a
  cleaned part) shows neither. The note shows the part's bars, amber around
  the purple of the voice (each bar with twice the room's power taken out,
  since the room is read at its quiet end), and "Clean up Part N", which
  opens 179's sheet for that part alone.
Reverse if: partners' own parts show the line marks too many or too few,
people learn to ignore the triangle, or phones need every part measured
(the player that turns parts up to −16 LUFS will decode AAC on phones, and
can measure there).

Amended (2026-10-28, Caleb Koster): a phone now measures any part it has,
AAC included, in the microphone module (182), so a part recorded on
another device or before this change wears the warning too once the phone
shows it. That reaches phones with the store build that brings 182.
