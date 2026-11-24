# A held film shows its wrong stills, ringed, and plays at their time

Date: 2026-11-24 · By: Caleb Koster · Status: accepted

Reason: Caleb looked at a "Film held" card on the ops dashboard's Tutorial
videos page (Change someone's role, French). It said only the frame check's
words ("0:09 (...): The Lumari row says '1 terminés' ..."). A "Change
failed" card next to it showed ringed pictures, because Claude's nightly
look picks pictures for a suggestion (decision 186, amended 2026-11-17).
The held film's card had none: the frame check kept its wrong stills only
in the filming run's artifact, and the held film was in no place a person
could play it. Caleb asked for a picture of the problem on each video card
where one fits, and a link to the video at the problem's time, on LangQuest
and on YouTube. Decided:

- **The frame check gives a box.** For each problem it also answers the box
  round it in its still, `[left, top, width, height]` as parts of the still
  (`e2e/tutorials/frame-check.ts` `foundOf`). A box outside the still is cut
  to it; none, or an empty one, is null, and the picture shows no ring.
- **The held film and its stills go into the release.** `nightly.ts` copies
  a held film and each wrong still into the run's output as
  `held.<language>.<video>.<hash>.mp4` and `held.<language>.<hash>.jpg`, and
  names them under the video's `heldFilm` in `status-<language>.json` (each
  still's time, line, picture hash, problems and boxes). They are never in
  the manifest, so the intake never lists them and YouTube never gets them.
  `put-in-release.ts` puts them in, and takes out held files the status no
  longer names. The workflow tells LangQuest when a night held a film, as
  when it made one.
- **The intake brings them into R2.** `takeInFilms` reads each language's
  status and brings each held film to `tutorials/<language>/<video>/<hash>.mp4`
  (the same door as a film, so it plays at `/api/tutorials/...`) and each
  still to `/api/tutorial-pictures/<hash>.jpg`, both checked against their
  hashes. The picture door now also takes a `PUT` with the service key, for
  the intake; before, only the review workflow's OIDC token could put one.
- **The card.** A Film held card shows each wrong still as a numbered,
  ringed picture with the problem as its caption (at most six), and the held
  mark on the timeline shows them with the held film to play. Every card
  about one video has a "Watch the video" line: the held film (not on
  YouTube), the newest film LangQuest keeps when it is not on YouTube yet,
  and the film on YouTube and its copy on LangQuest. Each has a link at each
  time the card is about (`#t=` on LangQuest's copy, `?t=` on YouTube), or
  one from the start. The label says which film a link plays ("the film
  before it" when a film was held), because the film on YouTube is not the
  one the frame check held, and its times can be a little different.
- A film held before this change has no `heldFilm`: its card shows no
  picture, and its times come from the frame check's lines ("0:09 ...").
  The next night films it again and holds it with its stills, or puts it up.

Not chosen: drawing the ring into the picture's bytes (the dashboard
already draws rings over a picture, and the bare still stays true); a
separate upload from the filming job with its own OIDC rule (the intake
already holds the key and the release is the one way films reach
production, decision 141).

Reverse if: the frame check's boxes miss the problem on most held films, or
the held films in R2 cost more than the stills are worth to the admins.
