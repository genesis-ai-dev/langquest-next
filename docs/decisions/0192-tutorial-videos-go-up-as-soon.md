# 192. Tutorial videos go up as soon as they are filmed: the filming tells the app, the intake chooses the wide films itself, and the publish follows each intake

Date: 2026-10-30 · By: Caleb Koster · Status: accepted

Reason: on 2026-10-30 Caleb saw the ops dashboard waiting for him to tick
the new videos before they went up, and asked: "I want everything,
including the updated YouTube pages, published as soon as everything is
ready. We won't wait for a scheduled time". Until now a night's films
waited for the intake at 23:10 UTC, then for a person's Publish (180), then
for the publish run at 23:40 UTC (183, amended): up to a day behind the
filming, and never without a person. Decided:
- **The filming says when its films are in.** Each language's job in
  `tutorials.yml`, once its new films are in the release, posts to the
  app Worker's `/api/tutorial-filmed` (`e2e/tutorials/films-in.mjs`,
  `apps/web/worker/tutorialFilmed.ts`), which starts the intake. Only that
  workflow, run from main, gets in, with the OIDC token GitHub gives the
  job, as for the nightly look (186): the workflow still holds no key to
  production. The first job of each run says it too, for films a run
  before it put in without saying (one cut off, or one from before this).
  An intake already running takes the films in once more when it ends.
- **The intake chooses the wide films itself** (`ops_tutorial_made`
  `p_choose`, migration `*_tutorial_choose_on_intake.sql`): a film made
  wide (191) is chosen for YouTube as it is listed, with a time and nobody's
  name, so no Publish is needed. A tall film left from before, whose refilm
  failed, would go up as a Short, so it still waits for a person's Publish,
  which stays on the dashboard for that and for putting one up again.
- **The publish follows each intake** (`AFTER` in
  `apps/web/worker/jobsModel.ts`); if it is running, it runs once more when
  it ends. A run that makes a playlist gives it its row on the channel's
  home page at the end of the same run, not the next.
- **One scheduled time, as YouTube's day begins**: an intake at five past
  midnight in California (07:05 UTC in summer time, 08:05 in winter), with
  the publish after it, takes in what the filming could not say and puts
  up what the day before had no room for. The intake at 23:10 UTC and the
  publish at 23:40 UTC are gone. The filming keeps its 20:10 UTC start.
What stays: YouTube's limits (180, amended): 100 uploads a day for the
project and a lower limit for each new channel, so replacing every video
in every language still takes over a week; the publish goes on with the
rest each day.
Rejected: choosing every film, tall ones too (a tall one goes up as a
Short, whose links cannot be clicked, 191); an intake every hour in place of
the filming saying so (most runs would find nothing, and each publish after
it spends units looking at every channel); keeping the intake and the publish
at 23:00 to 00:00 UTC (183, amended): Caleb asked for no scheduled time,
and that hour delayed a night's films by up to a day.
Reverse if: films go up that should not have (then the intake stops
choosing and Publish is the way again), or the publish runs after each
language spend so much of YouTube's day on looking at the channels that
videos wait for it.

Amended (2026-10-30, Caleb Koster): a tick from before this went live no
longer puts a video up (migration `*_tutorial_old_ticks.sql`). Caleb's
Publish of 2026-10-29 chose tall films; where a video's wide film did not
come out that night (some Spanish ones), its tall one was still chosen and
newest, so the publish would have put it up as a Short. Such a choice now
counts as none: the job skips it, the dashboard lists the video as not
chosen, and a person's Publish can choose it again. No row is changed.

Amended (2026-10-30, Caleb Koster): a new film goes up only once its stills
look right. Caleb paused videos and found mistakes in many (a line of a
card's border left dimmed outside the lit box) and asked that every paused
frame be looked at by AI, in the filming, efficiently. `nightly.ts` sends
each film made that night to Gemini (`frame-check.ts`,
`gemini-flash-latest`): a still in the middle of each line said, where the
part is lit and the camera is in, and the first and the last, 1280 wide,
all of a film's stills in one request (about 15,000 tokens, under a cent).
A film with something wrong, or whose stills could not be looked at, is
held: it does not go in the release, the video keeps its last film (on
YouTube too), the language's job fails and so is filed in Linear, and the
run's summary lists what is wrong at which moment, with the stills in the
job's artifact. Rejected: every frame (30 a second; the stills are what a
viewer pauses on, and a mistake between them is on screen for a moment);
Gemini's Batch API (half the price, but its requests are capped at 20 MB
inline, a night's stills are more, and it waits minutes); Claude (the
filming already holds a Gemini key and pays per token; Claude in Actions
signs in with a person's plan). Reverse if: the check holds films that are
right more than now and then (then it reports without holding), or misses
what people find.

Amended (2026-11-01, Caleb Koster): Claude looks at the stills, not Gemini.
Google charged US$230 on the Gemini key in the week every language was
filmed again (the ring, then the spotlight), and the frame check was about
US$175 of it: six runs showed 2,879 films to `gemini-flash-latest` at its
full price, and Gemini thought about as many tokens as it was sent (38
million), billed as its answer, so a film cost about 6 US cents, not under
one. Caleb asked to use the Claude plan's token the repository already
holds for the look at the videos' feedback (`CLAUDE_CODE_OAUTH_TOKEN`,
decision 186), with Sonnet. `frame-check.ts` runs Claude Code (its version
pinned in `tutorials.yml`) as Sonnet thinking at high effort, with no
tools, settings or MCP servers, and the same stills in one look a film; it
counts against the plan's five-hour and weekly limits instead of a bill,
and each language looks at two films at a time. Tried on 2026-11-01 on the
stills Gemini held in run 19 and on clean spotlight screens: Sonnet found
the cut-off words and, once the prompt asked it to check each heading
against what the voice says, the wrong part number; it missed some ring
outlines Gemini named (the ring is gone), and it found app glitches Gemini
had passed (a Spanish role name broken mid-word, "1 listos"). The job's
summary gives what Claude would cost on the API and what Gemini bills for
the voice and translations. Rejected: Gemini's Batch API with less thinking
(about a sixth of the price, still billed). Reverse if: the plan's limits
stop the check or get in the way of the team's own use of Claude, or Sonnet
holds films that are right more than now and then.
