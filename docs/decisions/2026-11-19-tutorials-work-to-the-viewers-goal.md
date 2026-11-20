# Every agent that writes or reviews a tutorial works to the viewer's goal

Date: 2026-11-19 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-11-06) asked whether anything tells the agents that a video
must help a person reach their goal end to end, and not only say which button
to tap. Nothing on `main` did: the frame check looks for what is drawn wrong,
and the nightly look finds what is out of date. Kieran's standard
(`docs/tutorial-teaching.md`, PR 334) waited on questions about six scripts.
- **The standard goes in now, ahead of those six scripts.** It adds to its first
  promise that a video orients the viewer and carries them through the whole job.
- **Agents are told.** `AGENTS.md` makes it the rule for anyone writing or
  changing a script, and the nightly look (`tutorial-review` skill) weighs its
  `script` suggestions against it.
- **It suggests and never holds.** No check stops a film over it, as a person
  decides each suggestion.

The decision was made on 2026-11-06 and waited in a pull request (PR 358); it
takes the date it reached `main`, as the log is in the order it was written.

Reverse if: people watching a real task do as well with videos that only name
the buttons.
Considered: a new nightly score of every video (more cost, and an AI check of
teaching stated false things about the app in Kieran's review).
