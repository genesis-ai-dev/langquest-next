# The Tutorial videos page opens on what waits on the admin, each thing a card with its buttons; a reply is copied there and posted by a person

Date: 2026-11-19 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-19, thread "Make tutorial videos dashboard page
clear") looked at the videos list of the ops dashboard and could not tell
what he was to do: "All I'm seeing is big blocks of unwieldy text and no
options to do anything about it." What waited on him was behind a `!` at the
right of a video's row, in one app language at a time; the timeline's marks
were dots, squares and diamonds whose key had scrolled away; a film's cause
named screens by their id in the app's flow (`my_work`, `settings_home`); and
the card for a reply had a comment and a reply with nothing to press. This
keeps the lists of decisions.md 186 (amended 2026-11-13) and the dashboard's
layout (docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md), and
changes how the first part of the page is laid out
(`apps/admin/src/pageVideos.ts`). Decided:
- **Four tabs with counts, opening on Waits on you** when something does:
  Waits on you (each thing an admin must answer, in every app language, most
  urgent first), Automatic (what Claude looks at next and the workers' jobs,
  which need no answer), All videos, and Changes made. The four numbers at
  the top go: the tabs' counts say the same. Paused languages are a standing
  state, not a thing to answer, so they are a line under All videos and are
  not counted as waiting.
- **Every card has its control.** A suggestion has Accept, Reject and Edit;
  a change Claude could not make has Try again, which sends the same change
  as an instruction that names it in full, beside the box to tell Claude
  what to do instead; a reply has the two steps below.
- **A reply is copied on the page and posted by a person on YouTube.** The
  card shows the comment as the viewer's words and the reply in a box to
  change; step 1 copies the reply and opens the comment on YouTube, step 2
  is Done, beside No reply needed. Caleb chose this (2026-11-19) over a
  button that posts through the channel: decisions.md 186 keeps a reply in a
  person's own hand because a comment is untrusted, and posting comments
  would be a new use of YouTube's API while Google reviews the request for
  more quota. The answer is kept on the comment (migration
  `20261119171500_tutorial_reply_done.sql`, action `tutorial-reply`), so the
  card leaves for every admin and the page says only what is so.
- **A mark says what it is.** Each kind of thing on a timeline has a small
  picture in its colour (a film, an upload, a comment, a suggestion, an
  answer, a change, a hold, a failure); the key lists only the kinds on the
  page, with their names, and stays at the top while the list scrolls;
  pointing at a mark says its name, when, and what. A day too narrow for
  pictures shows dots. The mark at the left of a row says the video's state
  at a glance, and a button under its name opens what waits on someone.
- **One name for each thing, and no id from the code.** A screen is said by
  its name (`screenName` in `sources/videos.ts`: `my_work` is My work), and
  a video's state has the name its card has (Change failed, Reply to post,
  Film held, Suggestion to answer).

Considered: posting the reply from the dashboard (above); leaving the cards
on each video's row only (the admin must then look through every language);
a server-side check of the comment's thread to see that a reply was posted
(it would cost quota units for each comment and still say nothing for No
reply needed).

Reverse if: admins post replies often enough that the copy step is in the
way and Google has granted the quota (then post through the channel, with a
new decision), or the tabs hide something people need at first sight.

Amended (2026-11-21, Caleb Koster): a paused language whose connected
channel has no video at all now has its own card under Waits on you
("Tagalog: 0 videos on YouTube", kind `empty`), and its chip under Each
language counts it. Before, Tagalog was one name in the grey paused line,
the same as the twelve paused languages whose older videos are on YouTube,
and Caleb could not find why its channel was empty. The page also calls
`tl` Tagalog, the app's name, where the browser said Filipino.
