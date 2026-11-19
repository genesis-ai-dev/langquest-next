# 183. Tutorial videos are filmed each night on GitHub, only those whose screens changed, and the job container brings them in

Date: 2026-10-28 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-28, thread "Plan tutorial videos and keep them
current") asked for the whole pipeline running and chose "GitHub films,
Cloudflare publishes": the filming runs where the local stack and a browser
are, with the Gemini key alone, and production's keys stay in production
(141, amended today).
- **Only what changed is filmed again.** Each night every video is tried
  without voice or film, one at a time, on a fresh local stack, and each
  step's screen is read out as text (Playwright's accessibility tree), once
  it stops changing and without the toast. With what changes from run to
  run though the app did not taken out (made-up addresses, sign-in keys,
  numbers, times, upload status, the order of names in a line and of
  things side by side: `e2e/tutorials/look.ts`), the steps hash to the
  video's look. A video is filmed again when its look differs from its last film's,
  or it has no film. A video that looks changed is tried again, up to twice,
  and is filmed when two tries agree on the new look or the third still
  differs. On 2026-10-28, two runs of all 47 English videos read the same for
  41 before the words were read once steady, without the toast, with things
  side by side sorted and after a projection pass; with them, 46 of 47 read
  the same, and the 47th ("Record a passage") read as before on the next two
  tries. The same day, on main with Clean up, seven videos looked changed
  (the ⋯ menu that replaced a bin), and two of them read differently on a
  second try: a part still saving, and a passage heard a moment earlier
  kept on the device or not yet. Since then a step is read once nothing on
  it is saving, and the app's words about saving, uploading and keeping on
  the device are taken out in the film's language (from its catalog); all
  seven then read the same. Videos for LangQuest staff (the Global Viewer's) are never filmed
  each night or put on YouTube: the channels are for the public (Caleb,
  2026-10-28).
- **The release is the hand-over.** The repository is public, so its
  `tutorials` release (a pre-release, never the latest) holds each video's
  newest film in each language, named by its hash; a manifest per language
  with what YouTube shows (the title, the lines said as the description,
  the playlist of who it is for: `e2e/tutorials/playlists.ts`) and each
  film's look; and each language's voice, so a line is paid for once. New
  films go up before the manifest that names them, older ones come out
  after (`e2e/tutorials/put-in-release.ts`).
- **Each description links to the same video in every other language**
  it is made in (Caleb, 2026-10-28), by a link to the app's Worker,
  `next.langquest.org/v/<language>/<video>`, which goes on to that video's
  newest version on YouTube, or to the language's channel while none is up
  (`ops_tutorial_watch`). A replaced version never leaves stale links
  behind, and no description is edited after upload, which would cost 50
  of YouTube's 10,000 daily units for each of up to 690 videos.
- **The intake job brings them in** (`server/tutorialIntake.ts`, the job
  container at 13:10 UTC): each film R2 lacks is downloaded, its hash
  checked, put through the Worker's service-only `PUT /api/tutorials/…`,
  which R2 checks again, and listed (`ops_tutorial_made`). The dashboard
  shows it for Publish (180); nothing filmed goes public without a person.
- **English each night to begin with** (`NIGHTLY_LANGUAGES`); a language
  joins once its voice can be made (Gemini's batch voice needs the paid
  tier). The Gemini key reaches GitHub through `npm run secrets --
  production`, from `.env.production`. Each language's job files a failure
  in Linear, as the guardrails nightly jobs do.
Reverse if: the look misses changes people notice in the films, or flags
changes nobody can see often enough to burden Publish; or the runners
cannot film reliably (then the job container gets a browser and the stack).

Amended (2026-10-29, Caleb Koster): the tutorial runs moved to the hour when
the fewest people on earth are at work, as Caleb asked: many of the people
who use the app are in Nepal, Nigeria, Thailand and India. By population
and time zone, 23:00 to 00:00 UTC has about 100 million people in working
hours (9 to 5) out of 7 billion: the Americas' west in the afternoon and
Australia's morning (India 4:30 AM, Nepal 4:45 AM, Thailand 6 AM, Nigeria
midnight). The publish run at 08:10 UTC had had about 5.9 billion, and the
intake at 13:10 UTC about 2.3 billion. The intake now
runs at 23:10 UTC and the publish job's daily run (180) at 23:40 UTC, on
YouTube's allowance for that Pacific day; the filming, on GitHub's machines
and touching nothing live, starts at 20:10 UTC so a night's films are in the
release by the intake. Every app language is now filmed each night, English
and French first (Caleb, 2026-10-29: every language is checked for changes
and the changed videos are filmed on the same night), since the Gemini key
is on Tier 1, which the batch voice needs. Five languages film at a time,
each about 50 minutes on a night without new films, so all fifteen finish
before the intake. A first night for a language, which films every video,
can finish after the intake; its films then come in the next day. So that
a line no one has translated yet (a script's new line, or what Ruth says in
the readings, which no language had) never stops a language, the job has
Gemini translate it first (`translate-lines.ts`, the same machine
translation as the committed lines, decision 81) and keeps the file to
commit. A change to the scripts or to how they are filmed is filmed when it
is merged into main, rather than at the next 20:10: a fix to the filming
should not wait a day, or for a person to press Run workflow, since the
agents that work on the videos cannot start or re-run a workflow.

Amended (2026-10-30, Caleb Koster): the intake no longer waits for 23:10
UTC: the filming tells the app when each language's films are in, and the
intake runs then, with the publish after it; the one scheduled intake is at
five past midnight in California, as YouTube's day begins (192).

Amended (2026-11-01, Caleb Koster): English alone is filmed for now
(`NIGHTLY_LANGUAGES: en`). The spotlight (decision 191) films every video
again, and Caleb looks at the English films before the other fourteen
languages are filmed; they come back, English and French first, when he
says the English ones look right.

Amended (2026-11-13, Caleb Koster): a video is filmed again when its script
changes too, and each film says why it was made. Caleb (2026-11-13, thread
"Make comments and screen changes update videos") named two reasons a video
changes, a comment on YouTube and a change to a screen or flow it shows,
and asked for every video a changed screen touches to be slotted for an
update, with the cause shown. The look sees only the words on screen, so a
fix to what a video says (the way a comment's fix comes in) was never
filmed. Each film in the manifest now keeps the commit it was filmed from,
its script (its file and the lines it says, hashed), each step's look and
its causes (`e2e/tutorials/why.ts`); a changed script films it again. A
change merged into main that touched the own code of a screen a video shows
(`e2e/tutorials/screens.ts`: what the screen's module imports, less what
four or more of the twenty modules share) slots the video; the night's try
films it when its words changed and clears the slot when they did not. A
slot does not film by itself: from 30 October to 13 November, 80 merges
would have slotted 15 to 46 of the 47 English videos on each day with a
merge, and YouTube takes about 100 uploads a day for fifteen languages.
Step pictures from two nights were compared to catch what the words miss,
and differ by themselves (a person's colour, a QR code, a waveform, a
toast), so they decide nothing. Each
language's `status-<language>.json` in the release gives every video's
film, causes, tonight's try and slots. The filming checks out main's whole
history to find the changes. Reverse if: slots cleared as the same turn out
to hide changes people see (then a person or Claude judges those slots), or
scripts change so often that films churn on YouTube.

Amended (2026-11-16, Caleb Koster): French and Spanish are filmed each night
again (`NIGHTLY_LANGUAGES: en,fr,es`). The English spotlight films are
current (all 46 the same on 2026-11-15), so the other languages can come
back, and their films from 1 November still show the old screens and the old
wide frame. Caleb chose two languages first (2026-11-16, thread "Explain
tutorial video failures and paused languages") over all fifteen at once: a
language's first night films all 47 videos again (its frame changed), so
fifteen would be about 700 films, about seven days of YouTube's uploads,
and more Gemini voice and Claude plan use for the frame check; two show a
fault in the translated films before it repeats in fifteen. The rest come
back after them. Reverse if: French or Spanish films fail or are held where
English passes (then they pause again until the cause is fixed).
