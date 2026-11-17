# 180. Tutorial videos go on YouTube, one channel per app language, connected once from the ops dashboard; a person's Publish chooses what goes up

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-27 and 2026-10-28, thread "Plan tutorial videos and
keep them current") chose a YouTube channel for each app language, as
BibleProject has, one Publish press on the ops dashboard to put new videos
up, and YouTube's API only, never a browser driven for it. He made the 15
channels and the OAuth client (`docs/tutorial-videos.md`).
- **One channel per app language**, made by hand: YouTube's API cannot make
  one. Their ids are in `server/youtube.ts`. Each is connected once from the
  dashboard: Google's page asks which channel, and its refresh token goes
  into Vault (`youtube_refresh_<channel>`), which only the service role reads
  back. The state Google carries is signed with the OAuth client's secret
  and names who pressed Connect, so nothing is kept while they are on
  Google's page and only they can finish, within 15 minutes. A channel that
  is not one of LangQuest's is refused and its token handed back.
- **A person chooses what goes up.** Each version filmed is kept in R2 by
  its hash (`tutorials/<language>/<tutorial>/<sha256>.mp4`, served publicly
  at `/api/tutorials/…`) and recorded (`ops_tutorial_made`). The dashboard
  lists each video's newest version not on YouTube, with Watch, and a Global
  Viewer on an aal2 session chooses which go up (OpsActions, 162). A video
  changed by mistake never goes public by itself.
- **The publish job runs in the job container (141)**, started by Publish
  and at 08:10 UTC each day while chosen videos wait. YouTube allows the
  project 100 uploads a day for all channels together, and 10,000 units for
  the rest (a video and its playlist place cost about 100), so the first
  full set of about 705 takes a week. Each video is recorded as up the
  moment it is, so a later failure never puts it up twice.
- **YouTube cannot replace a video's file**, so a new version is a new
  video: it takes the old one's place in its playlist, and the old one is
  unlisted with a first line linking the new, so its links and comments
  keep working. A replacement does not notify subscribers.
- **An upload says what it is**: public, not made for kids, and marked as
  synthetic media, since the voice is a computer's (177).
Reverse if: YouTube's limits or review make publishing this way
impractical, or partners need the videos where YouTube is blocked (then
next.langquest.org serves the same files).

Amended (2026-10-29, Caleb Koster): each channel has a day's limit of its
own as well as the project's 100, counted over the last 24 hours and lower
for a new channel. Caleb's first Publish (242 videos, 2026-10-29) put up 10
in Arabic and stopped: YouTube said Arabic's channel was at its limit
(`uploadLimitExceeded`), and the job took that as the project's day. Now
only that channel waits for the next run and the others go on; the project's
`quotaExceeded` still stops the run. The job puts up English first, then
French, as Caleb asked (they matter most), then each other language in turn
by its place in the plan; it had gone by language code, so Arabic went
first. A video chosen more than a day ago counts as stuck on the dashboard
only while its channel has put up nothing in that time, since a hundred a
day across fifteen channels takes a week by design.

Amended (2026-10-30, Caleb Koster): a person's Publish is no longer needed
for a wide film: the intake chooses it as it takes it in, and the publish
follows each intake (192). Publish stays for a tall film and for putting a
video up again.

Amended (2026-11-02, Caleb Koster): a video's playlist place and its old
version's unlisting were tried once, right after its upload, and a step that
did not work stayed undone. On 2026-11-02 the Hausa channel had no playlist,
so none of its videos was in one and an old version of a video still showed
beside the new one, and seven other channels each had a video outside its
playlist. YouTube would not make Hausa's playlist in Hausa: the run's first
error was `localizationValidationError`, which YouTube gives only for a
playlist's or a channel's language, and every channel's look had gone on.
Others were YouTube busy for a moment (`SERVICE_UNAVAILABLE`, 2026-10-29 to
11-01). Now a playlist YouTube will not take in its language
is made without one, and each run, before its uploads, puts every channel's
playlists in order from what the database says is up (`ops_tutorials_up`):
each video's newest version in its playlist in the plan's order, no older
version in one, and every older version unlisted. A channel in order costs a
few units of the day's 10,000; each thing put right costs 50, and the job
run counts them (`tidied`).
