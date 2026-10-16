# 17. Accessibility and field use (A11Y)

Translators record outdoors, on low-end Android phones, often with little
reading. Some use a screen reader, large text, or Arabic. These tests hold
the app to the field rules in PLAN.md section 12:
- touch targets of at least 48 pt, and 56 pt for primary actions
  (`target` in `theme.ts`);
- text of at least 13 pt;
- status colours that never carry meaning alone;
- one main action per screen.

**Key screens.** Several tests say "on each key screen". The key screens
are:
- Sign In
- Join your team
- My Work
- the language map
- a book's chapters
- the passage record
- the recording workspace and its Publish screen
- Review it: Listen, Questions (only when the check has questions, as the
  Consultant Check does) and Decide
- back translation
- the study
- Ask someone
- Me
- the language page
- Members, then Invite

## Screen readers

### A11Y-001 Every control on the key screens has a spoken name and role
Roles: TRANS, REV, COORD · Priority: P0 · Platforms: iOS, Android · Run: Manual

Preconditions: VoiceOver (iOS) or TalkBack (Android) is on.

Steps:
1. On each key screen, swipe through every element from the top.

Expected:
- Every control is reached.
- Each control speaks a name that says what it does, for example "Record", "Stop recording", "Publish Version 1" or "Help: explain this screen", and a role: button, switch, adjustable or tab.
- No control is spoken as just "button" or by an icon name.
- Decorative icons are skipped.
- The reading order follows the screen top to bottom: header, then body, then footer.

### A11Y-002 Tabs announce where they go and their counts
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Manual

Preconditions:
- The screen reader is on.
- VIEW has at least one unread update.

Steps:
1. As TRANS, swipe to each tab.
2. Sign in as VIEW and swipe to the Inbox tab.
3. On My Work as TRANS, swipe to the bell.

Expected:
- Step 1: each tab speaks its label ("Work", "Map", "Me"), says it is a tab, and says whether it is selected.
- Step 2: the Inbox tab speaks its unread count.
- Step 3: the bell speaks "Updates" or "Updates, {n} new".

### A11Y-003 Toasts are announced, and Undo stays up longer
Roles: TRANS · Priority: P0 · Platforms: iOS, Android · Run: Manual

Preconditions:
- The screen reader is on.
- P-DRAFT is open in the workspace.

Steps:
1. Delete Part 2.
2. Time how long the toast stays.
3. Move focus to "Undo" and activate it.

Expected:
- Step 1: the reader speaks "Part 2 deleted. Undo available.".
- Step 2: the toast stays about 14 seconds, double the 7 seconds it stays without a screen reader.
- Step 3: the part is back. The reader speaks "Undone.".

### A11Y-004 The split divider and the cutoff line can be moved without dragging
Roles: TRANS, REV · Priority: P1 · Platforms: iOS, Android · Run: Manual

Preconditions: The screen reader is on.

Steps:
1. As TRANS, in the workspace, focus the divider.
2. Swipe up, and then down, on the divider.

Expected:
- Step 1: the divider speaks "Divider between reference and your recording", is adjustable, and gives the hint "Drag up or down to give either one more room".
- Step 2: each swipe moves one snap. The value is spoken: "Source 35%", "Reference as one line" or "Recorder as one line".
- (The "Sound cutoff" line went in decision 112; there is nothing to adjust while recording.)

### A11Y-005 Recording state is never only visual
Roles: TRANS, REV · Priority: P0 · Platforms: iOS, Android · Run: Manual

Preconditions: The screen reader is on.

Steps:
1. In the workspace, start recording, speak, pause, then stop.
2. In a back translation, start a session and speak for two parts.

Expected:
- Step 1: the record button changes its spoken name from "Record" to "Stop recording" and back.
- Step 2:
  - The status is read politely: "Part 1. Recording…", then "Part 1. Listening for you · pause between parts" (decision 112).
  - The elapsed time is readable, for example "Recorded for 0:12".
- The reader's own speech is not recorded into the take. Check by playing the take.

### A11Y-006 Players can be used with a screen reader
Roles: REV · Priority: P1 · Platforms: iOS, Android · Run: Manual

Steps:
1. In Review it, focus the player's timeline and adjust it.
2. Activate "Back 10 seconds", then play/pause.
3. Activate "Note", which reads "Add a note at this moment".

Expected:
- The timeline is adjustable and speaks where you are.
- Each button speaks its name.
- The note sheet opens with focus inside it. Closing it returns focus to "Note".

### A11Y-007 Sheets and dialogs hold focus
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Steps:
1. Open each of these:
   - "Ask someone"'s due date
   - "Report or block"
   - the Language sheet
   - "Leave this question unanswered?"
   - the Background sheet in Review it
   - the lost-files alert (decision 92, phones only), which covers every screen and closes
     only with "I understand"
2. Swipe past the last element of each sheet. On the web, press Tab instead.

Expected:
- Focus stays inside the sheet until it is closed.
- Escape (web) or the reader's back gesture closes it. The lost-files alert
  is the exception: only "I understand" closes it.
- Focus returns to the control that opened it.

### A11Y-008 Help mode works with a screen reader
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions: The screen reader is on.

Steps:
1. On the passage record, activate "Help: explain this screen".
2. Activate the third numbered part.
3. Activate "Turn help off".

Expected:
- Step 1: the parts are reachable in number order.
- Step 2: the tooltip's text is read. "Listen" is offered where a recording exists. The part's action is not performed.
- Step 3: help turns off, and controls act again.

## Size, text and colour

### A11Y-009 Touch targets meet 48 pt, and primary actions 56 pt
Roles: TRANS, REV, COORD · Priority: P0 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On each key screen, dump the view hierarchy (`maestro hierarchy`). On the
   web, read each pressable's box (role button, tab, link, switch, checkbox,
   radio, slider; 1 CSS px is 1 pt at phone width).
2. Measure every pressable element's frame.

Expected:
- Every pressable is at least 48×48 pt. Count the hit slop where one is set.
- The screen's main action is at least 56 pt high. These include "Publish Version N", "Send feedback", "Looks good", "Ask {target}" and "Create Organization".
- The record button is at least 56 pt. It is 72 pt in the footer and 120 pt on microphone setup.
- Adjacent targets do not overlap.

Web (`e2e/ui/17-accessibility.spec.ts`): walks Sign In, Join your
team, My Work, the language map, Luke's chapters, the passage record, the
workspace (empty, and with P-DRAFT's two parts), Publish, Something else?,
Ask someone (to record P-S), Me, Review it (Listen and Decide on
P-SUBMITTED; Listen and Questions on P-CHECK), back translation (P-BT), the
language page, Members and Invite. React Native Web ignores `hitSlop`, so the
web measures the frame; controls with a hit slop in the source are listed in
the test's `HIT_SLOP` and reported, not failed. Overlap is checked between
targets in the same scroll area (a fixed footer over a list can be scrolled
apart).

Fixed (2026-10-13), found on the web:
- The player's timeline ("Where you are in …", `clipPlayer.tsx` `track`) is
  372×32 on Publish, Review it's Listen and back translation.
- In the workspace with parts, "Play Parts 1–2" and "Hide the parts" are
  44×48 (`simple/recorder.tsx` `iconTap` width 44).
- A one-line verse in the workspace's Bible (Luke 14:6) is 398×32
  (`simple/reference.tsx` `verse` has no minimum height).

Phone plan (for the coordinator; not scripted, Maestro runs only on the
shared devices):
1. Run each key screen's way in as a short flow (reuse `common/launch.yaml`,
   `common/sign-in.yaml`, and the selectors from the web walk above: tabs by
   `tab-*`, the main action by `primary-action`, the record button by
   `record-button`), ending with the screen showing.
2. At each screen run `maestro --udid <device> hierarchy > <screen>.json`
   (iOS frames are in points; Android bounds are in pixels, divide by the
   density from `adb shell wm density` / 160).
3. A small script walks each JSON: every node that is clickable
   (`clickable: true` on Android, an `accessibilityTraits` of button, tab,
   link or adjustable on iOS) with a frame under 48×48 is an offender, unless
   it is in `HIT_SLOP` (add the slop); `primary-action` and `record-button`
   must be at least 56 high; pairs of clickable siblings whose frames overlap
   are listed.
4. Compare with the web list above: the same controls should offend on the
   phones, except where `hitSlop` makes up the difference.

### A11Y-010 Text never falls below 13 pt
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. On each key screen, read every text element's font size from the
   hierarchy. On the web, the computed font size of every visible text.

Expected: No text is under 13 pt at the default text size.

- Fixed (2026-10-13): the player's "10" (Back 10 seconds) and "Note"
  are 11 pt on Publish, Review it's Listen and back translation
  (`clipPlayer.tsx` and `simple/review.tsx` `sideLabel`).
- Fixed (2026-10-12): the workspace's Back 10 "10" was 11 pt
  (`simple/parts.tsx` `roundWord`, now 13).

### A11Y-011 The largest text size keeps every screen usable
Roles: TRANS, REV, COORD · Priority: P0 · Platforms: iOS, Android · Run: Manual

Preconditions:
- iOS: Larger Accessibility Sizes, at the largest size.
- Android: font size and display size at maximum.

Steps:
1. Walk each key screen.
2. Do one full job: record and publish, then review.

Expected:
- No text is cut off without a way to read it: it wraps, or the screen scrolls.
- The main action and ✕ are reachable on every screen.
- The footer is not pushed off screen with no scroll.
- In the workspace, the record button is reachable at every divider snap.
- Toasts and their Undo stay readable and tappable.

### A11Y-012 Colour never carries meaning alone
Roles: TRANS, VIEW · Priority: P1 · Platforms: iOS, Android · Run: Manual

Preconditions: The device is set to grayscale: iOS Color Filters, or Android Simulate monochromacy.

Steps:
1. Look at:
   - the map's book bars
   - a book's chapter states
   - the passage record's step marks
   - "Looks good" / "Needs changes"
   - the sync chip
   - the Inbox unread dots

Expected:
- Every state can still be told apart by an icon, a mark or words. Examples:
  - chapters show ✓, • or nothing
  - steps show a check, a flag or a dash
  - unread rows show a dot
- A blocked or unavailable control looks blocked without colour.

### A11Y-013 Contrast holds in light and dark appearance
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Steps:
1. Screenshot each key screen in light appearance, then in dark appearance.
2. Check text and icon contrast with a contrast tool.

Expected:
- Body text is at least 4.5:1.
- Large text and icons that carry meaning are at least 3:1.
- No screen has dark text on a dark background, or the reverse.

Automated companion on the web (test "A11Y-axe" in
`e2e/ui/17-accessibility.spec.ts`): axe (WCAG 2 A and AA) on every
key screen of A11Y-009, failing on serious or critical findings. It does not
replace this test: axe cannot judge colour over images or in dark appearance.

- Fixed (2026-10-13): every radio (Ask someone's people, Invite's
  roles, the Questions scale) has no `aria-checked`, and every slider no
  `aria-valuenow`: React Native Web ignores `accessibilityState`, and
  `accessibilityValue` carries only `text`. The question dots in Review it
  ("Question 1 of 4") put a label on a plain View.

### A11Y-014 Readable outdoors in bright sun
Roles: TRANS · Priority: P2 · Platforms: Android · Run: Device

Preconditions: A mid-range Android phone at the brightness it picks automatically, outdoors in direct sun.

Steps:
1. Record and publish a passage.
2. Find a passage on the map.

Expected:
- The tester can read the passage name.
- The tester can tell whether recording is on, and tell "Publish" from "Record".
- These hold without shading the screen.
- Note any colour pair that washed out. The two reds are the open question in `docs/ux/README.md`.

## Other ways in

### A11Y-015 The web app works by keyboard alone
Roles: TRANS, REV, COORD · Priority: P1 · Platforms: Web · Run: Auto

Steps:
1. Without a mouse, sign in, open My Work, then open P-SUBMITTED.
2. As REV, review it to "Looks good".
3. As COORD, open Manage → Members → Invite.

Expected:
- Tab moves through controls in reading order, with a visible focus ring.
- Enter or Space activates.
- Adjustable controls (the divider, the timeline, the cutoff line) respond to the arrow keys, Home and End.
- Nothing needs a hover.
- Every job finishes.

- Fixed (2026-10-13): on the web the adjustable controls cannot be
  reached by Tab at all: the workspace divider (`recording/SplitPane.tsx`)
  and the player's timeline (`clipPlayer.tsx`) are Views with no tabindex,
  and their increment/decrement actions are screen-reader actions only, so
  the arrow keys, Home and End do nothing.
- Fixed (2026-10-13): Enter in Sign In's password field does not sign
  in; Tab to "Sign In" and Enter does (`kit.tsx` `Field` takes no
  `onSubmitEditing`).

### A11Y-016 Reduced motion
Roles: REV · Priority: P2 · Platforms: iOS, Android · Run: Manual

Preconditions: Reduce Motion (iOS) or Remove animations (Android) is on.

Steps:
1. Start a back translation recording session.
2. Move between tabs on a wide window.

Expected:
- The pulsing dot and bars do not animate, or animate minimally.
- Recording state is still clear from colour, icon and words.
- Screens change without crossfades.

### A11Y-017 Hardware keyboard and switch control on a tablet
Roles: TRANS · Priority: P2 · Platforms: Wide (iPad) · Run: Manual

Preconditions: An iPad with a hardware keyboard, Full Keyboard Access on.

Steps:
1. Record and publish a passage using only the keyboard.

Expected: Every step can be reached and activated.

## Languages and right to left

### A11Y-018 Arabic lays the app out right to left
Roles: TRANS, COORD · Priority: P1 · Platforms: iOS, Android, Web · Run: Manual

Steps:
1. Me → Language → "العربية".
2. Let the app restart. On native it restarts once.
3. Walk the key screens.

Expected:
- Layout mirrors:
  - back arrows point right
  - lists align right
  - the tab bar runs right to left
- Progress bars fill from the right.
- Audio timelines and Back 10 / play keep the media convention: time runs left to right, as platform players do. Record the convention the build uses, and check it is the same on every player.
- Help mode numbers parts right to left along each line.
- Bible text in a left-to-right language stays left to right inside the right-to-left screen.
- The app restarted at most twice: once for the language, and once more for the direction.

### A11Y-019 Every interface language fills the key screens without gaps
Roles: TRANS · Priority: P1 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. For each language, choose it from Me → Language:
   - English, Español, Português (Brasil), Français, العربية
   - Kiswahili, Hausa, አማርኛ, हिन्दी, বাংলা
   - नेपाली, Bahasa Indonesia, 简体中文, ไทย, မြန်မာ
2. Screenshot My Work, the passage record, the workspace, Review it and Me.

Expected:
- No screen shows a raw key, such as `work.home.nextForYou`.
- No screen shows English mixed in, except names and Bible text.
- Labels on buttons and tabs are not cut off mid-word.
- Scripts render with the right font: Ethiopic, Devanagari, Bengali, Thai and Myanmar, with no tofu (□).

Web: the test picks each language from Me → Language and reads My Work, the
passage record, the workspace and Me as TRANS, and REV's back translation
(Review it's Listen needs a request to REV that A11Y-015 uses up). It fails
on a raw key in any text or spoken name, and on any whole text that is an
English catalog word the language translates. Cut-off labels and fonts stay
a person's check on the screenshots.

### A11Y-020 Choosing the phone's language picks the app's
Roles: GUEST · Priority: P2 · Platforms: iOS, Android, Web · Run: Auto

Steps:
1. Set the device language to Swahili and fresh-install the app. On the
   web, open it in a browser whose language is `sw`.
2. Set the device language to Chinese (Traditional) and fresh-install the
   app. On the web, a browser whose language is `zh-TW`.

Expected:
- Step 1: Sign In is in Kiswahili ("Ingia"). Its language chip names it.
- Step 2: the app is in English, because zh-Hant has no catalog. The Language sheet offers "Same as this phone" ("Same as this browser" on the web), with "Now English".

Web is automated. Changing a simulator's language needs a device restart,
so on phones this runs by hand.

## Low-end devices and hard conditions

### A11Y-021 A low-end Android phone keeps up
Roles: TRANS · Priority: P1 · Platforms: Android · Run: Device

Preconditions:
- A 2 GB RAM Android phone on Android 10 or later, with the language's whole template (Luke and more) on it.

Steps:
1. Cold-start the app.
2. Open the Map, Luke, then a passage.
3. Record for 5 minutes in one session, with pauses.
4. Publish.

Expected:
- The cold start reaches My Work within 5 seconds of the splash.
- Scrolling the map and the chapters does not stutter visibly.
- The level meter keeps moving during the 5-minute recording.
- No parts are lost. The part count matches the pauses.
- Publish completes without an "Application not responding" dialog.

### A11Y-022 One-handed use on a large phone
Roles: TRANS, REV · Priority: P2 · Platforms: iOS, Android · Run: Manual

Steps:
1. Hold a 6.7-inch phone in one hand.
2. Record and publish, then review to "Looks good".

Expected:
- The main actions (record, "Publish", "Next: …", "Looks good", "Send feedback") sit in the footer, within thumb reach.
- ✕ and ? are the only top controls needed, and neither is needed for the main path.

### A11Y-023 Spoken help works offline
Roles: TRANS · Priority: P2 · Platforms: iOS, Android · Run: Device

Preconditions:
- The app was opened once online, in a language that has recorded help lines.
- If no language has recorded lines yet, this test is not applicable; note it in the run sheet.

Steps:
1. Turn on airplane mode.
2. On the passage record, turn on help and tap a part.
3. Tap "Listen".

Expected: The line plays from the phone, without a connection.

### A11Y-024 Interruptions while recording keep what was said
Roles: TRANS · Priority: P0 · Platforms: iOS, Android · Run: Device

Steps:
1. Start recording in the workspace and speak.
2. Cause each interruption below in turn:
   - an incoming phone call
   - an alarm
   - plugging in, then unplugging, wired headphones
   - connecting a Bluetooth headset
   - pressing the power button

Expected:
- Recording stops cleanly at the interruption.
- Every part spoken before it is kept, and the draft lists it.
- After the interruption, tapping record starts a new part with no error.
- With a headset, the device records from the headset's microphone, or says it cannot, with no silent recording.
