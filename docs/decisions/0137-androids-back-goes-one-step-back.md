# 137. Android's Back goes one step back, inside a screen's steps too, and leaves the app only from the first screen

Date: 2026-10-16 · By: Caleb Koster · Status: accepted

Reason: Caleb (2026-10-16): "Sometimes I find myself in the middle of a
multi-step process and the android back navigation will exit me from the
entire process (not what I intended). Also, on some pages back will
completely exit the app (shouldn't be a thing)." Two causes. A tab is
opened by a reset, so a tab's page (Map, Manage, Me, Inbox, Reports), the
practice passage and a link to the scanner had nothing under them, and Back
left the app. And many screens show their steps in place (New language, Get
ready's questions and their pages, reviewing's stages and questions, a
study's steps, the recording view, Divide your own way, invites, a new
template), which the navigator cannot see, so Back popped the whole screen.
What was built:
- **One listener answers Back** (`shell/useRootBack.ts`, added by the
  component that draws the navigator, so it is asked before the navigator's):
  a step open on the screen goes back one step; else the screen underneath
  comes back; with nothing underneath, Back goes to the person's first
  screen (their home, "Join your team", or Sign In signed out) and leaves the
  app only from there, or from the welcome a first sign-in shows
  (`shell/backModel.ts`), and only when pressed twice: the first Back there
  shows "Press Back again to leave LangQuest", and a second one while it
  shows (3.5 seconds) leaves (Caleb, 2026-10-16: "have it say press back
  again to leave"). A Back arrow with nothing under it goes to the first
  screen too.
  `test/hardwareBack.test.ts` keeps every other `BackHandler` listener out.
- **A step registers its own way back** with `useHardwareBack(active, onBack)`
  (`ui/hardwareBack.ts`): the newest step open on the screen showing answers
  first, by when it opened, so a page inside a wizard answers before the
  wizard. Each does what that step's own Back does: the Back under New
  language's steps (and a page of its question first; while it is being
  added, the same "please wait" as ✕), the question before in Get ready and
  in a review (then the stage before; Listen leaves, and the draft stays),
  the step before in a study (as it was reached) and "Back to the guide",
  the recording view's ✓ (it keeps every part), the helps or the verse
  picked in Divide your own way, then its header's arrow. ✕ still leaves a
  task at once.
- **A sheet of several steps** takes `onBack` (Add a Bible, Report, the
  license's "This can't be undone", the lesson on breaking up material):
  Back goes to its step before; otherwise Back closes a sheet, as before.
- Help mode turns off on Back, as its ? does.
Not covered: iOS has no Back button, and its edge swipe still pops a screen
past its steps. NAV-061 now expects the first screen, then the message,
not leaving the app at once.
Reverse if: people expect Back on a tab's page to leave the app, as before,
or find stepping back through a long task slower than they want (✕ still
leaves it at once).

Amended (2026-10-28, Caleb Koster): iOS follows the same rule as far as a
swipe can. While a step registered with `useHardwareBack` is open, the
screen's back swipe is off (`useSwipeBackOff`, iOS only), so only the
header's arrow goes back, one step, and no swipe pops the screen past its
steps. Task screens (`TASK_SCREENS` in `shell/chromeModel.ts`: recording,
back translation, reviewing, a study, Get ready, New language, Ask someone)
take the swipe only from the screen's edge, so a drag on a waveform or a
slider is never a Back. From the UI audit Caleb asked to have fixed
(findings 4 and 16).

Amended (2026-10-28, Caleb Koster): two ✕s no longer leave at once,
because what they leave cannot be had again. New language's ✕ (and Back on
its first step) asks "Leave without adding ‹language›?" once a name or an
answer is in, with Keep going first (`org.tsx`, finding 45). The sign-in
code page for someone with no email asks "Leave the code?" before its Back
or Android's Back throws away a code nobody has scanned, since the code
cannot be shown again; Done, which says they have it, leaves at once
(finding 96). Every other ✕ still leaves a task at once.
