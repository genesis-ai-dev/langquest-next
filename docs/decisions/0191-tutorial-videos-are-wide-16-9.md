# 191. Tutorial videos are wide (16:9), never Shorts; a description says what the video shows in one line, then its links; each channel's home page has a row of the other channels and one for each playlist

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-29 Caleb found the channels' video descriptions a mess
(the voice written out line by line, no space between the links), their
links not clickable, and a channel's page showing a single video and no
way to the other languages. The cause was the films' shape: a phone's
video was filmed on a tall 1080x1920 page, and YouTube makes any tall video
under three minutes a Short. 44 of the English channel's 45 videos were
Shorts: links in a Short's description are never clickable (since
2023-08-31), Shorts are listed on their own tab, and the channel's Videos
tab held only the one wide film (See reports on the web). Decided:
- **Every film is wide** (`e2e/tutorials/compose.ts`): the phone on the
  right of a 1920x1080 page, the app's mark and the video's title on the
  left; a film of the web stays in its window under the title. Wide videos
  are listed as videos, keep their links, and can be a channel's rows and
  trailer.
- **A description is read at a glance** (`e2e/tutorials/playlists.ts`
  `youtubeText`): the first sentence the voice says ("Here's how to record
  a passage."), then, each group apart: the download link, the page of
  every video and the app; then the same video in each other language.
  Never the voice line by line.
- **Every film is made again once** (`FRAME` in the release's manifest):
  a film without it is filmed again whatever its look, so the first night
  after the merge films every video in every language, and each new version
  replaces its Short as Publish puts it up. Only a video's newest version
  goes up (`ops_tutorials_due`, migration `*_tutorial_newest_due.sql`): a
  tall version chosen before is not put up once a wide one is made.
- **A channel's home page** (`server/youtube.ts` `setHome`), as BibleProject
  and others lay theirs out: under the trailer, the other 14 LangQuest
  channels in two rows of 7 (a row shows no more than 12; amended
  2026-11-03, when Burmese and Chinese were missing), then a row for each of its playlists, everyone's
  first (`server/youtubePlaylists.ts` `HOME_ORDER`). The publish job
  brings the rows up to date each run (2 of the day's 10,000 units when
  nothing changed); Connect lays them out at once.
What stays: a description's links are clickable only on a channel with
YouTube's advanced features (support.google.com/youtube/answer/9890437),
English and French on this date; the links under a channel's name can only
be set in YouTube Studio, not through the API.
Rejected: keeping tall films over three minutes (most videos are shorter,
and padding them wastes people's time); filming each video twice, tall for
Shorts and wide for the channel (twice the uploads, against YouTube's 100 a
day, and a Short still cannot link anywhere); a channel's own links in its
description in place of the channels row (YouTube shows a description
cut to one line).
Reverse if: YouTube lets a Short's description link out, or people watch
the videos mostly on phones held upright and ask for tall ones.

Amended (2026-10-30, Caleb Koster): the camera moves in. Caleb found the
wide videos "really blurry, difficult to see": the phone's screen is 452
pixels of the page's 1920, so the app's words are about 16 pixels tall, and
fewer on a phone or at a lower quality. He approved a sample of Record a
passage. Each step's lit part, where and when it was lit, is in the film
(`film.ts`, `focus` in `film.json`), and `compose.ts` draws the page twice as
big and moves a camera over it (ffmpeg's `zoompan`, from `camera.ts`): in on
the part, at most 2.2 times, so its words are about twice their size; back
out to the whole page where a step lights nothing, for the title at the
start and at the end. It holds still for a part already in the shot and
leaves out a shot under a second, so it moves only when the part moves. A
move takes 0.8 s and starts just before the part is lit. A part inside a
card with its own edge is lit with the card (`film.ts` `light`), so the
light no longer cuts through a card's border and leaves a dimmed line of it
showing (Caleb's still of the lit Record step), and a list that scrolls up
and down scrolls the part into view before it is lit (a list that hid what
overflowed sideways was held still, so the light and the camera pointed
below the screen). A zoomed video is made at 2560x1440: Caleb saw the
uploaded videos play at 240p, and our 1080p file was fine (checked), but
YouTube makes its sharper versions (VP9) only of an upload of 1440p or
more. `FRAME` is `zoomed`, so
every video in every language is filmed again once; the English and French
videos already up are replaced, about a day of YouTube's daily limit. The
trailer, drawn by its own page, keeps its film (`TRAILER_FRAME`). Rejected: filming the phone bigger and cutting the
title (a title beside the phone is what makes the page wide, decided above);
a second, magnified copy of the part beside the phone (two places to look).

Amended (2026-10-30, Caleb Koster): the ring and the camera after the first
zoomed night. The frame check (decision 192) held 217 of the first 219
zoomed films in English, French, Spanish, Portuguese and Arabic, most for
the ring: it crossed a field's label, a card's second line or the next
row's words, or went around the words in a button but not the button. Now
(`film.ts` `light`) words, an icon or a field that a script lights is lit
with the button or card drawn around it (not a bar or a sheet that reaches
the screen's edge, nor a box bigger than a sixth of the screen); what the
ring would touch is taken in when it is small and belongs to the part (a
label above it, a second line below), or when the ring has no room;
anything else (the next row, another card) stays out, and the ring moves in
onto the part's own edge, never onto its words. The camera never films an
empty screen (`camera.ts`): where half a close shot or more would be one
stretch of empty screen (a tab under a short page, a button at the foot of
an empty one, which Gemini called "a blank screen"), it steps back, to the
whole page when it would nearly be. The title and the app's mark fade out as the
camera first moves in and back as it goes out at the end, so the ends of
the title's words never show at the edge of a close shot. `FRAME` is
`zoomed-ring`, so every video is filmed again. The frame check is told that
what a team wrote or named (role names such as "Organization Admin", review
steps, templates, notes) may be in English in any language, and that a tab
may be lit on the way to what the voice says to open. Rejected: a looser
frame check (the ring problems it found were real, as Caleb's own still
was).

Amended (2026-10-31, Caleb Koster): the ring again, after the first night
on the rules above. The frame check held 45 of the 47 English films and 41
of the 44 French, again mostly for the ring: it cut through a card and left
the card's edge or corners showing just outside it, left a row's icon or
handle outside, or went around a bar, a heading or two rows where the voice
named one. The rules said what to take in; the ring now looks at what the
screen shows (`film.ts` `light`): every line of words, icon, field and
drawn edge, cut where a list hides it, as a viewer sees it. It goes around
the button or card the part is in, with a box drawn round it and little
bigger (a search field's box with its icon, a row's card with its handle),
or else around the nearest box out from it that it fits. On each side it
stands 6 points off where it can, and nearer, further or right on an edge
where that would cross words, an icon or an edge; it hides only the part's
own edge or the edge of a box it goes into, and never leaves an edge just
inside or outside it. The title comes back whenever the camera is out on
the whole page (`camera.ts` `titleShows`), not only at the end: a step
that lit nothing in the middle left the left of the page empty ("zoomed
out with the left side blank"). A field's focus outline is hidden in films
("a black outline around the text"). Four scripts lit the wrong thing
after the app changed (review checks, a new account's two ways in, a
language's settings, the invite's code and its other ways). The frame
check is told that the ring is lit before the tap, and that a ring around
a tab in the bar at the foot of the screen runs off its bottom edge.
`FRAME` stays `zoomed-ring`: held films are not in the release, so they
are filmed again anyway.

Amended (2026-10-31, Caleb Koster): the ring a third time, after the night
on the rules above passed only 3 of the 47 English films, 2 French and 4
Spanish. Most holds came from four things. A field's words were taken to
fill the whole field, so a ring that could not stand inside a field went
round the whole form and through the labels above its fields ("cuts
through the label 'Password'"); a field's words are now as wide and as
high as they show. A ring that crossed something tried each box further
out, up to a list, the bar at the foot of the screen or both buttons in
the corner; it now never takes a box much bigger (1.6 times) than the
part's own when that box has other things to tap in it (a link and the
sentence it ends are still lit together), and a bar round another button
with words is not taken as the part's own box (Skip beside Next question).
Its corners were always the same, so a card's rounder or squarer corners
showed past it ("the green corners of the Looks good button show outside
the ring"); they are now as round as the box's, stood off as far as the
ring. A border within 14 points of the ring, inside or out, reads as a
second ring ("a border line doubled just inside the ring") and is kept
clear of it, as an edge where a fill stops is within 8 points outside and
3 inside; words outside it stay 2 points clear, and words between it and
the part (a heading just above a card) count as crossed, since the ring
would go round them too. Where the ring cannot miss
everything, it stands beside an edge rather than across it, and it stands
as far off a part on one side as on the other where that crosses nothing
more (tight on one side, it reads as cutting into the part). It never goes
round a bar from one side of the screen to the other (the bar round the
main button), and a part under a button that floats over a list is
scrolled to the list's middle first. A part that leaves the screen (the
upload bar once all is uploaded) takes its ring with it, and a part as
tall as most of the screen
is shown on the whole page with the title (`camera.ts`), not as the whole
phone with an empty page beside it. A video whose setup leaves the app
still loading waits for its first part (a blank phone in the first still),
and a note at the foot of the screen that would cover the next part is
waited out off camera. A dozen scripts lit more or less than their line
names, or said what the screen does not show (Note, not Add a note here;
Next: decide, not Next); the frame check is told what the app draws itself
(a thin purple border round the card for the next thing to do, a quoted
verse's purple line, help mode's dimming). What it found in the app
itself, not in the films, goes to the team as app bugs; a film that shows
one stays held until the app is fixed.

Amended (2026-11-01, Caleb Koster): no ring; a spotlight. After the third
round, the night's films passed 4 of the 47 English, 2 French, 7 Spanish
and 5 Portuguese, again mostly for the ring: in most held videos one or two
stills showed it through a card's edge, a badge or the row beside the part,
or with square corners. Four rounds of placing a drawn ring each passed
under a tenth of the films. Now nothing is drawn round the part (`film.ts`
`light`): the rest of the screen dims and the part's own button, row or
card stays bright, exactly to its own edge and with its own corners, so the
dimming stops where the part does and crosses nothing beside it. A part
with no box of its own (a line of words, an icon) is lit 6 points round,
nearer on a side where that would take in other words, an icon or an edge.
Which box is the part's own is decided as above. The frame check is told
about the bright part instead of the ring. `FRAME` is `zoomed-spotlight`,
so every video, those already up with the ring too, is filmed again.
Rejected: the camera's zoom alone with nothing lit (a small button among
many is hard to find), and a fifth round on the ring.

Amended (2026-11-01, Caleb Koster): the spotlight after its first night.
35 of the 46 English films passed Claude's frame check; 5 were held for
where the light went. Several parts lit as one box cut a button between
them (the filter's chips where they wrap, By email beside Share as a link);
a part's handle was lit with its whole row; a play button was lit as its
tap area, as tall as the row and past the card on the last row; and three
scripts lit less than the voice names (the heading of a request to join,
the microphone row above the typing box, the first ready-made template).
Now (`film.ts` `light`) several parts lit as one box take in whole each
button, line of words or icon its edge would cut, up to a third of the
screen, so a box that wraps differently in another language cuts nothing
either; a slider (a part's handle) is a button of its own; a button with no
box of its own whose words and icons are all on one box it holds is lit as
that box (the play button's round face); and the three scripts light what
the voice names. `FRAME` stays, so only the held videos, and any whose
screens changed, are filmed again.

Amended (2026-11-01, Caleb Koster): the spotlight's second night. Of the
10 English films made again with it, 4 passed. A part's row was lit with
its whole list: the + on the line between two parts is a small round face
on a tap area as tall as a row, so taking in the tap area cut the next
row's verse space, and taking that in cut the next +, down the list. Now
a button is taken in by what shows of it (its own box, or the face it
shows; one with neither by its words and icons alone), and a button's box
the edge only grazes, by under a quarter of its height or width, is not
cut. Invite your team lights every language while the voice says to
choose one, and the content template lights the question it asks again
before Next is tapped. Two holds were Claude reading the app wrongly, so
the frame check's prompt now says what a passage's step marks mean (a
grey skip-forward sign is a check set aside) and that the recording
clock counts the silence a part is cut from.

Amended (2026-11-13, Caleb Koster): a change that only makes films look
better leaves `FRAME` as it is, so no video is filmed again for it alone.
The title picture (`compose.ts`) was cut at its lines' boxes, so the foot
of a g, p or y on a title's last line was cut off in 22 of the 46 English
films; a YouTube viewer saw it. The picture now takes in room around its
letters. Changing `FRAME` would have filmed all 46 English videos again
(46 frame checks and 46 uploads) for that alone. Instead each film gets it
when it is filmed again for another reason (a screen it shows changed, or
a person named it), so such changes can wait in old films until then.
Reverse if: viewers keep pointing at a fault that only a new film fixes.
