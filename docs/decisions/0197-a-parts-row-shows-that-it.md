# 197. A part's row shows that it is playing, and how far, whichever player plays it: a band crosses the row from the left, and its play button turns solid with a pause

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: with Play all on, no one could tell which part was playing or
how far into it (Caleb, 2026-10-30, after Jasmine's Play all report: "there
should really be a playback progress bar that moves across the card as it
plays"). Each part's row has its own player and lit its bars only when its
own button played it; Play all on the parts card and the player above a
version's parts played the same recordings without the rows knowing. So
the players that play parts (`useClip`, `ClipPlayer`) say which recording
they play and where in it (`audio/nowPlaying.ts`), the newest player's
word standing, and each part's row reads it for its own recording
(`usePlayingPart.ts`), in the recorder, the parts with verses, and a
version's parts:
- **A tinted band, with a line along its bottom, crosses the row** from
  the left as the part plays (`recording/playingFill.tsx`). It runs on
  between the player's reports at the speed the recording plays, so a
  two-second part moves smoothly, and it stays where a pause left it.
- **The play button is solid primary with a white pause** while the part
  plays, whoever plays it, and pressing it pauses that player.
- **Play all's card head and a version's card** show the band for the
  whole recording.
The partner demo shows a playing take by its button and waveform only;
this goes further at Caleb's ask, on every row that plays a part. The
round play buttons for notes and feedback (`AudioClip`) are unchanged.
Reverse if: people take the band for something else (a selection, a
level), or it distracts while recording.
