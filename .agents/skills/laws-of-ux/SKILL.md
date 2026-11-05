---
name: laws-of-ux
description: The Laws of UX (Fitts, Hick, Jakob, Miller, Doherty, Tesler, Postel, Peak-End, Von Restorff, Zeigarnik, Gestalt grouping and others) applied to this field-use mobile app. Use when designing or reviewing a screen, choosing layout, button size or placement, deciding how many options to show, writing empty/loading/error states, or explaining why a UI choice is better. Pairs with ux-heuristics (Nielsen, Krug) and react-native-accessibility.
license: MIT
---

# Laws of UX for field use

**The partner demo in `ng-langquest-ux` is the specification for screens**
(PLAN.md section 12, `docs/ux/demo-parity.md`, and the demo's
`docs/design-principles.md`). Use these laws to make choices the spec leaves
open, to review work, and to argue a case to the UX team. Do not use them to
diverge from the demo on your own; raise the question instead.

Users: low-tech, mixed literacy, many languages, weak or absent connectivity,
low-end Android phones, often outdoors, often mid-conversation with a
community. Everything below is tuned for them.

## Targets and motion

- **Fitts's law**: the time to hit a target grows with distance and shrinks
  with size. So: 48pt minimum targets and 56pt primary actions (project rule;
  larger than the 44pt many guides quote). Put the main action within thumb reach at
  the bottom. Keep destructive actions small and away from the main one.
- **Doherty threshold**: feedback within about 400 ms keeps people engaged. Every
  tap gets an immediate visible response. The local fold makes the result instant;
  never wait on the network to show that an action happened. Show progress for
  anything slower.

## Choices and memory

- **Hick's law**: decision time grows with the number and complexity of
  choices. One next step and one main button per screen (design principle 10);
  secondary actions behind "More".
- **Choice overload**: long option lists stall people. Cap lists with "Show
  more"; suggest a default.
- **Miller's law / working memory**: people hold only a few items at once.
  Chunk passages by book and chapter; never make someone remember something from a
  previous screen; repeat the context (which passage, which version) where the
  action is.
- **Cognitive load**: every extra label, colour or icon costs attention. Remove
  before adding. For mixed literacy, pair each icon with a short label and prefer
  listening to reading where the content is audio.
- **Serial position effect**: first and last items are remembered best. Put
  the most important item first; put the main action last in the flow.

## Familiarity and models

- **Jakob's law**: users expect your app to work like the others they use
  (WhatsApp, the phone's recorder). Use platform patterns: back gesture, bottom
  actions, standard share sheet, familiar record/stop/play icons.
- **Mental models**: a passage's record works like a medical chart (design
  principles). Keep that metaphor consistent: history accumulates, nothing
  disappears, departures carry a reason.
- **Tesler's law** (conservation of complexity): complexity has to live
  somewhere. Keep it in the system (derived status, suggested next step, flows
  configured by the organization), not in the translator's head.
- **Postel's law**: be liberal in what you accept and strict in what you send.
  Accept messy input (spaces in invite codes, mixed case, partial search terms),
  normalize it, and give precise feedback.
- **Paradox of the active user**: people skip instructions and start
  tapping. Teach in place (empty states that show the first action), not in a
  tutorial.

## Grouping and emphasis (Gestalt)

- **Proximity and common region**: things that belong together sit together,
  inside one card. The passage card groups its status, version and next step.
- **Similarity**: the same meaning always looks the same. Status colours never
  change, and never carry meaning alone; add an icon or word (project rule).
- **Uniform connectedness**: lines or containers show sequence, as in review
  flow steps.
- **Von Restorff effect**: the one thing that differs is noticed. Reserve
  strong emphasis for the single primary action or the single blocker; if
  everything is highlighted, nothing is.
- **Prägnanz**: people read complex shapes as the simplest form. Prefer plain
  shapes and icons that stay legible at small size in sunlight.

## Motivation and memory of the experience

- **Goal-gradient effect**: effort increases near a goal. Show progress as
  counts (recorded, cleared each step, done) so people see how close they are.
- **Zeigarnik effect**: unfinished tasks stay on the mind. My Work lists what
  is waiting on you and what you left half-done; make resuming one tap.
- **Peak-end rule**: people judge an experience by its most intense moment and
  its end. Make the end of a recording or review feel complete (confirmation
  toast with Undo), and make failures gentle ("Saved on this phone. It will send
  when you're connected.").
- **Aesthetic-usability effect**: polished interfaces are perceived as easier
  and are forgiven more. Consistency with the kit (`theme.ts`, `kit.tsx`)
  is the cheapest polish.

## Review checklist

1. Can the main action be found in under two seconds, and is it at least 56pt and
   within thumb reach?
2. Is there exactly one primary button?
3. Does every tap respond immediately, offline included?
4. Does the screen answer: where am I, what just happened, what is mine to do
   next?
5. Is any meaning carried by colour alone?
6. Would someone who reads poorly still get through it (icons with labels, audio
   where the content is audio)?
7. Does it still work with 1,200 chapters, and at the largest system font size?

## Sources

- Jon Yablonski, *Laws of UX* (O'Reilly) and https://lawsofux.com/
- Nielsen Norman Group articles on Fitts's law, Hick's law and Jakob's law:
  https://www.nngroup.com/
- Walter J. Doherty and Ahrvind J. Thadani, "The Economic Value of Rapid Response Time" (IBM, 1982)
