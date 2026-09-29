# UX reference mocks

**History.** The screens now follow the partner demo in `ng-langquest-ux`
(docs/decisions.md 28, `docs/ux/demo-parity.md`). The mocks below record the
earlier one-next-action design; they are kept for the reasoning they hold
(the VAD takeover is still the recorder's full-screen mode), not as rules.

Interactive mocks that pin down how a screen should behave, for cases where
prose in PLAN.md is not enough. They are reference, not shipping code: nothing
here is imported into the mobile app. Open the HTML file in a browser.
Keep `icons.js` beside it; the local Lucide subset avoids a CDN dependency.

**See also:** [follow-ups.md](./follow-ups.md) — Remaining UX-vision alignment work after Inbox P0 fix (PR #4)

## Spoken Worldwide workflow

The [Spoken Worldwide workflow mapping](spoken-worldwide-workflow.md) extends
these notes with Harvest Mission Ethiopia's six-stage oral translation process:
first draft → community checking → revision → back translation → consultant
checking → final recording.

It maps participants to U/P personas, stages to existing and proposed views,
and each task to single-action steps. It also defines resource continuity,
back-translator source restrictions, draft selection, and final audio approval.
Proposed behavior and open decisions remain distinct from implemented coverage.
The current mock covers initial drafting, not this complete workflow.

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
- One yellow action at a time. The footer owns it on the hub; tiles retain
  their semantic colours. Production state must be derived from `workflow.ts` — never a stored status
  column, so a take syncing in from another device moves the yellow without a
  migration.
- Colour is never alone. Every tile pairs its hue with its Lucide icon, and a
  blocked control is grey, dashed and struck through so it reads dead in
  greyscale.
- Blocked controls stay on screen. The grid never changes shape between
  passages.
- Cross-session progress is visible: the key-terms ring counts terms with
  audio anywhere in the project.
- Passage recording starts with one centered, yellow microphone button.
  Tap it to enter the full-screen voice-detected session; tap stop to review.
  Review places redo, the neutral microphone, and yellow keep in one row.
  Key terms still use a circular hold-to-record button.
- Source playback stays beside the passage recorder. Pause, replay, or seek
  between parts without leaving the view. Starting recording pauses playback.
  Recording another part appends to the pending take; keeping composes the
  parts in order. The source chapter label identifies full-chapter audio.
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
2. Whether recording-red on the single-term button clearly communicates the
   same recording mode as the full-screen passage recorder.


## Walk through the reference

- Use the phone controls for setup → My Work → hub → task → hand-off.
- Record terms by holding the microphone for at least 200 ms, then releasing.
  Space or Enter supports the same hold gesture. Cancellation adds no progress.
- The reference run has two slides. Recorded terms update the project ring.
- Stop the simulated passage recorder, keep the take, then queue the hand-off.
  Cloud-off and a clock mean queued locally, not delivered or approved.
- Drag the cutoff or use its arrow keys. Home and End select its limits.
- Use the scenario buttons outside the phone to inspect fixture states directly.
  These fixtures can intentionally show states outside the current journey.
- Reload to reset the session. No microphone, audio playback, storage, or network
  submission occurs. Questions, notes, and alternative setup choices remain
  outside this study. Fonts are optional; icons load locally.

## Review findings and design decisions

| Before | After | Why |
| --- | --- | --- |
| Duplicate `wave` declarations prevent script execution | Waveform renderer and VAD element have separate names | Make every scenario load |
| Flex styling overrides the hidden takeover | Explicit hidden rule | Keep the passage visible outside recording |
| Icon CDN returns 404 | Local, licensed Lucide subset | Icons are essential to an oral interface |
| Static phone controls | Connected main journey and term progress | Let reviewers test transitions |
| Yellow tile and yellow footer compete | Footer owns the hub action | Give one clear next step |
| Orange means reference and active recording | Active term recording uses red | Keep mode meanings consistent |
| Hand-off ends at a blocked gate | Kept take → ready → locally queued | Show recovery and offline outcomes |
| Cutoff only supports dragging | Keyboard slider with an accessible name | Support alternative input |

The mobile app now implements this journey through real project events and
audio. See the [implementation notes](implementation.md) for coverage, content
gaps, and device checks. The mock remains independent of the workflow engine.
Before release, test icon comprehension and hold gestures with translators,
and supply recorded audio guidance in their language.
