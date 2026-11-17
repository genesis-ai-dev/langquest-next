# 77. A voice note's format goes in the log when it is not m4a

Date: 2026-10-09 · By: Ryder Wishart · Status: accepted

Reason: a voice note is named only by the event that uses it (30), and none
of those events has a format field, so core called every voice note m4a.
A browser that cannot record MP4 (Chrome, Firefox) stores its take as WAV
(58), at `<hash>.wav`. Review comments, directions, reasons, notes and
responses recorded there were then looked for as `<hash>.m4a`: the browser
could not read its own file to upload it or play it back, and no other
device or the agent API (70) could fetch it. What changed:
- `v1.AudioFormatSet { hash, format }` says a voice note's format, once per
  hash: the earliest stands and the server refuses a second (75), so nobody
  re-labels someone else's note. The app appends it ahead of the event
  that names the note, in the same batch, when the file on this device is
  not m4a and the log does not say so yet (`useLanguage.ts`, core `audioFormatsFor`). The
  device that has the file is the one that knows its format; `BlobStore`
  keeps each file's extension (`formatOf`).
- Core `referencedBlobs` reads it for every voice-note field
  (`voiceNoteOf` lists them), so uploads, downloads, playback and read
  links use the real name. Without the event a voice note is m4a, as
  phones record it, so nothing already in the log changes meaning.
- Whoever may append an event that names a voice note may append this one.
  `REDUCER_VERSION` is 13 for the new state field.
Rejected: v2 of the seven events that carry a voice note (seven new shapes
for one missing field); converting a browser's take to AAC (no encoder in
Firefox, and a muxer to ship); recording at `<hash>.m4a` whatever the bytes
(58: a phone's player trusts the label); probing the server for either
extension (a round trip per file, and nothing for the uploader).
Reverse if: every supported browser records MP4 (then web voice notes are
m4a and the event is no longer appended), or voice notes get an event of
their own that carries the card, as recordings do.
