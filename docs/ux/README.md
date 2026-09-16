# UX reference mocks

Interactive mocks that pin down how a screen should behave, for cases where
prose in PLAN.md is not enough. They are reference, not shipping code: nothing
here is imported, built, or tested. Open the file in a browser.

## `one-next-action.html`

The slideshow workflow: a passage hub that branches once, feeding runs of
single-action slides. Covers both avatars (PLAN.md section 12) and the VAD
recording takeover.

**What it fixes.** Every atomic task becomes a run of slides with exactly one
action per screen, so a translator is never choosing between five things. The
passage hub is the only screen that forks.

**Rules it encodes** — these are the reason the file exists, and a change to
any of them should update the mock too:

- Words are optional on every avatar U screen. The only text is a passage
  reference. Instructions are audio, never prose.
- One yellow at a time, derived from `workflow.ts` — never a stored status
  column, so a take syncing in from another device moves the yellow without a
  migration.
- Colour is never alone. Every tile pairs its hue with its Lucide icon, and a
  blocked control is grey, dashed and struck through so it reads dead in
  greyscale.
- Blocked controls stay on screen. The grid never changes shape between
  passages.
- Cross-session progress is visible: the key-terms ring counts terms with
  audio anywhere in the project.
- Record is a mode, so it gets a mode control — a circular hold-to-record
  button, not the yellow next-step bar.
- The VAD session takes the whole screen and stays red start to stop, so "you
  are recording" never flickers. Capturing versus ignoring is a subtle lift:
  brighter ground, pulsing dot, solid rather than translucent bars.
- The VAD cutoff is a line dragged across the waveform, never a number.

**Sources.** Tokens are `apps/mobile/src/theme.ts` verbatim; icons are the set
in `apps/mobile/src/ui.tsx`. The VAD takeover is modelled on the parent
repository's `FullScreenVADOverlay.tsx`, `WaveformVisualization.tsx` and
`useVADRecording.ts` (60-bar ring buffer, captured bars scale at exponent 0.6
against 2.5 for monitoring, a discarded segment reverts its bars, defaults of
0.1 threshold / 1000 ms silence / 200 ms minimum segment). That repository is
reference only — do not import from it.

**Open questions**, both wanting a real translator rather than an argument:

1. Whether the two reds are far enough apart to read on a bright screen
   outdoors. If not, lean harder on the bars and panel brightness rather than
   widening the red gap.
2. Whether orange-while-holding on the single-term record button is confusing,
   given orange otherwise means reference material.
