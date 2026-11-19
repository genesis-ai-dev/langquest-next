# A tutorial video that speaks of another video names it, says that it is linked in the description below, and its description links it

Date: 2026-11-19 · By: Caleb Koster · Status: accepted

Reason: some lines sent the viewer to a video without a name or a link:
"start a new one. Another video shows how.", "The next videos show how to
translate a passage, and how to check one." The viewer had no way to find
that video. Caleb: "Our videos need to say more than just look at how to do
this in another video, as one of the videos did that I observed. If the video
is referencing another video, then the video should say, "This video is
linked in the description below," and then the video creation pipeline should
actually put a link to that video in the description for that video."

- **What the voice says.** A line that speaks of another video names it by
  its title and ends with where its link is: "The video 'Start an
  organization' shows how. That video is linked in the description below."
  A line that names more than two videos counts them and leaves the names to
  the description.
- **What the script says.** The step lists the videos that its line names
  (`videos` in `e2e/tutorials/tutorial.ts`). A video names only videos that
  exist, that are made for the public, and that are made in every language
  the video itself is made in. While a planned video is not made, a line
  names the videos that exist in its place.
- **What the description has.** `youtubeText` (`e2e/tutorials/playlists.ts`)
  puts the group "Videos named in this video:" straight after the first
  sentence, before the download links of decision 191, because that is where
  a viewer whom the voice sent there looks. Each line is the named video's
  title in the video's language and its lasting link in the same language
  (`/v/<language>/<video>`, decision 183), so a description never changes
  when the named video gets a newer version.
- **Other languages.** `translate-lines.ts` gives Gemini the titles of the
  named videos, so a line says a title as that video's own title has it.
- **What holds it.** `e2e/tutorials/look.test.ts`: a line with the word
  "video" lists its videos and ends with "linked in the description below.";
  no line says "another video" or "the next videos"; each named video exists.

This extends decision 191 (a description of one line and its links) with one
more group of links. It does not change the rule that a description never
writes out what the voice says.

Reverse if: YouTube stops making links in descriptions clickable for these
channels; or YouTube lets a channel put a link to another video on the video
itself through its API (cards and end screens can be set by hand only), and
that link serves the viewer better than the description.
