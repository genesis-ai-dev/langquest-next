# 125. Parts split by the room and the voice the microphone hears, nothing said is thrown away, and there is no microphone setup

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Spoken's tester found parts of what she said cut off (LAN-82).
Supersedes 71's microphone setup by ear (demo ADR-037) and, of 106, the
sustain rule and the "too short to keep" message. The detector decided what
to keep: a part started only when a frame passed a fixed cutoff (0.1, about
-20 dB, unless setup had been run), kept about 0.2 s before that, cut half
the pause off its end, and threw away a part with under 0.25 s above half
the cutoff. Setup measured the room for 3 s, never the voice, and its floor
(0.04) was what most rooms got. A real v2 phone recording's speech is
mostly quieter than -20 dB; in the web app, 40 s of speech 6 dB softer made
no part at all. Replaying real speech through both rules: today lost 2.7 to
3.9 % of a drafting session (soft starts, one-word answers) and all of it 6 dB
softer; the new rules lost none. Chosen with Caleb after the report and the
live demo (2026-10-16):
- **Where parts split, not what is kept.** `modules/microphone-energy/src/splitter.ts`,
  ported line for line to `Splitter.kt` and `Splitter.swift` (the three give
  the same parts on the same frames). It learns the room (the quietest
  3-frame median of the last 8 s; exact zeros from a microphone starting are
  not the room) and the voice (the loud end of each part said). A part
  starts at a frame halfway from room to voice, or after 0.3 s of sound out
  of the room; its head reaches back to where the sound rose out of the room,
  up to 3 s, never into the part before. It ends after the pause (1 s,
  growing to 1.5 times the person's own mid-speech pauses, up to 2.5 s) and
  keeps 0.3 s after the last sound. Only sound shorter than a syllable
  (0.12 s: a tap, a bump) makes no part, and nothing is said about it.
- **Nothing to set.** The room, voice and pause are kept on the device
  (`mic-heard:v1`, `src/mic/heardLevels.ts`) so a session's first words are
  judged right. Microphone setup (its screen, Me's row, the workspace link,
  the "parts are coming out very short" box) is gone; so are the cutoff line
  and pause chips (already gone with 124's recording view).
- **What is heard shows while recording.** The live waveform boxes each part
  with its number from the moment it starts (`recording/LiveParts.tsx`,
  built here and carried by 124's PR), with the room as a faint band and
  sound kept in no part shown as not kept; two fingers pinch it nearer or
  farther (about 2 s to 30 s; the bars only grow or shrink).
- **Tapping stop keeps the last word.** A tapped take runs on until the voice
  falls back to the room, up to 0.6 s.
Considered: keeping setup as a fallback (v2's settings were too technical,
and a wrong setting can no longer lose anything, only change where parts
split); recording the whole session and cutting it when the person is done,
with box edges dragged and parts dropped before that (shown in the demo,
left for its own change); a third-party audio library (v2's FFmpegKit was
retired in 2025).
Reverse if: parts run together where other people talk nearby (their voices
are out of the room), taps or bumps start parts often, or a phone's frames
are so long that the head reaches too far (iOS can tap 100 ms buffers; the
splitter counts in that phone's own frames).

Amended (2026-10-16, Caleb Koster): a part is now sound out of the room that a
speech model also calls speech, and the room is how loud it usually is rather
than the quietest moment, so a cafe or a fan is not boxed (135). Without the
model the rules above hold exactly.
