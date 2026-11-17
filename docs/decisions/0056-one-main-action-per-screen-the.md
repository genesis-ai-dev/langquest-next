# 56. One main action per screen, the passage path runs top to bottom, and recording splits the screen with the source

Date: 2026-10-02 · By: Caleb Koster · Status: accepted

Reason: new people were meeting 8 to 15 kinds of action at the same weight on
the passage record, the recording and review screens, the admin homes and
Settings (the count is in the UX proposal, `UX-FEWER-CHOICES.md`). Caleb chose
Hick's law and progressive disclosure as the rule: each screen has one main
action, at most one or two secondary ones, and everything rarer one labelled
tap away, never deeper (LAN-28). The partner demo took this first (its
ADR-029 and ADR-030, "What's new" v0.7; decision 28 keeps the app on the
demo), and the app follows it:
- **Passage record** (`screens/passage.tsx`, `passage/journey.tsx`): the path
  runs top to bottom, the recording first (play it, open it, flip between
  versions to see which reviews led to which version), then each step as a
  box closed to one line; the current step starts open with each kind's one
  main button and More, and the screen opens scrolled to it (LAN-22).
- **Send to the usual reviewer**: publishing never sends anything; afterwards
  the author's main button is "Send to ‹team or person›". Review teams now
  have a kind (`v1.ReviewTeamKindSet`) and a request can go to a whole team
  (`v2.RequestMade` with `teamId`; v1 is unchanged): any member may take it,
  the first review closes it, and anyone else may still do the step, with the
  record saying who did (comply or explain). `usualTarget` and `requestIsFor`
  in core decide who that is and whose a request is.
- **Recording splits the screen** (`screens/translate.tsx`,
  `recording/SplitPane.tsx`, LAN-23): the source (text, audio, key terms) on
  top, the recorder below, with a divider that snaps to 35/50/65%. Recording
  happens in the bottom pane instead of the full-screen takeover, so the
  source stays readable; playing the source pauses recording and recording
  resumes when it stops, a listen–speak–listen loop. This differs from the
  demo's Listen → Record → Publish stages on purpose: on a phone the source
  and the recorder fit together, and a team member can read while speaking.
- **Reviewing** is Listen → Questions → Your verdict, with one Background;
  Already happened keeps its extras under Add details.
- **My Work** leads with one Next card and a bell replaces the Inbox tab for
  everyone with a My Work. The admin homes lead with Invite people or Open the
  passage map, the rest under Setup. Map filters sit behind one Filter chip.
  Settings puts the likeliest rows first and the rest under Advanced;
  Delete account stays its own row in Settings, where the store answers and
  the App Review notes say it is.

The screen-by-screen path (what each screen shows, its main action, its
secondary ones and the way back) is written out in `docs/ux/screen-path.md`.
The core model the screens teach is the demo's `docs/core-model.md` (LAN-29).
Reverse if: testing with field users shows people can't find the actions
under More or Setup, or that the split recorder is too cramped on small
Android phones.

Amended (2026-10-08, Caleb Koster): the simple redesign (decision 71)
changes three parts of this entry. The record keeps one main action, but it
sits in the path's card, with "Something else?" and "Versions and history"
under it instead of the header's More and the Details cards. "Send to
‹team›" now comes straight after publishing, as a sheet that asks the usual
team for the next check. The recording split takes any reference on top
(Bible, guide, key words, notes, earlier versions) and settles on five snaps,
two of them one-line ends, instead of three.

Amended (2026-10-12, Caleb Koster): a kind's usual team is now the people
put on that check (decision 91), and "Send to ‹team›" reads "Ask the ‹check›
team"; Review Teams are no longer a screen of their own.
