# 171. A phone can wear a disguise: a calculator or notepad icon, and in front of the app a calculator or notepad that the person's code opens

Date: 2026-10-26 · By: Caleb Koster · Status: accepted

Reason: some translators work where being found with a Bible translation app
is a danger. The old app had a disguise (v2, July 2026, PRs 900 to 907) and
Caleb asked for it in this one. It works as v2's did, with these choices:
- **Where.** Me → More settings → App icon (`src/disguise/DisguiseRow.tsx`),
  phones only: LangQuest's own icon, or one of five calculators or five
  notepads, our own drawings (`assets/disguise`). The row is called App
  icon, as v2's was, not Disguise.
- **Icon and code together.** Choosing a calculator or notepad asks for a
  code of 4 to 12 digits, then opens that calculator or notepad full screen
  to type it. The disguise goes on only once it has been typed there, so the
  try teaches how the app will open, with no text explaining it. v2 had the
  icon and an App lock switch apart; an icon without the lock opened
  LangQuest from "Calculator", and a lock without the icon was a calculator
  behind LangQuest's own icon, so here there is one choice. LangQuest's own
  tile takes it off.
- **What opens.** A disguised phone opens on a calculator that works or a
  notepad that keeps its note (`src/disguise/faces.tsx`), before sign-in and
  before anything of the app starts (`DisguiseGate`, around everything in
  App.tsx), so nothing of LangQuest shows, asks or sounds. The calculator
  opens the app as the code's last digit is typed, with no = to press; the
  notepad, on a line that is only the code, which then leaves the note. A
  wrong code does what a calculator or notepad would. Android's Back leaves
  it as it would a calculator.
- **Locks when left.** v2 locked again only when the app was closed. Here
  leaving the app (the app going to the background) puts the disguise back,
  so a phone handed over with LangQuest open behind another app opens on the
  calculator. The app stays as it was under it, so the code brings back the
  same screen, sheet or recording. Every modal draws the disguise over itself
  (`ModalCover`, `src/ui/coverContext.ts`), since a modal is above the app's
  own view. The cost: Android counts a permission prompt or the share sheet
  as leaving, so the code is typed again after one.
- **On the phone only.** Which look is kept in the app's key-value store,
  read at once at start; the code only as a salted SHA-256 in the Keychain or
  Keystore (`src/disguise/disguise.ts`). Nothing is sent and no connection is
  needed. Turning it on disconnects this phone's notifications (each would
  say LangQuest), tried again each time the app opens until the server has
  heard, and More settings offers none while it is on.
- **Icons need a store build.** `expo-alternate-app-icons` changes the icon;
  `./plugins/withDisguiseIcons` names each Android alias "Calculator" or
  "Notes" in the phone's language (`native.calculator`, `native.notes`) and
  gives each the app's link filters, since the usual launcher entry is
  turned off while a disguise is on. iOS cannot rename an app, so an iPhone
  shows the new icon over "LangQuest Next", and iOS says that the icon
  changed. A build made before this has no other icons and offers no App
  icon row.
- **Told, not hidden.** v2 hid the feature's names in its public source
  behind an XOR encoding. Apple now removes apps for hidden or undocumented
  features (App Review Guidelines 2.5.19, added 2026-10-16), so this code
  names it plainly, and the App Review notes describe it
  (docs/play-store-declarations.md). Google's Deceptive Behavior policy allows
  a home-screen change the person makes and can undo.
Reverse if: Apple or Google turns a build down for it (then the calculator
and notepad stay and the icon goes, or the reverse), people lose their codes
(then a way back through sign-in is needed, which the disguise must not show),
or typing the code after every permission prompt or share drives people to
turn it off (then leaving for a few seconds does not lock).

Amended (2026-10-29, Caleb Koster): no tutorial video, channel trailer,
YouTube reply or nightly suggestion shows or explains the disguise, or how to
turn it on or open it. Telling the stores is not teaching the public: a public
how-to teaches anyone who picks up the phone to see through it. The web app
the videos are filmed on draws no App icon row (`DisguiseRow.web.tsx`),
`e2e/tutorials/no-disguise.test.ts` fails on a video that names or lights it,
and the nightly look at the videos' feedback is refused whole when a reply or
suggestion names it (`server/tutorialFeedback.ts`, decision 186).

Amended (2026-11-03, Caleb Koster): an iPhone build has no disguise. Apple
refused iPhone build 48 twice on 2026-11-03 under App Review Guideline 2.5.19,
the second time after Caleb's reply, for "functionality that allows users to
change the app's icon to resemble a calculator or notes application", and
asked for the feature and all code related to it to go. This goes further
than "Reverse if" planned: the calculator and notepad go on iPhone too, not
only the icon, so that the rejection stops holding back every iPhone build
(few people use the app yet), and Caleb appeals to the App Review Board. The
iPhone app has no App icon row and no lock (`src/disguise/*.ios.ts(x)`, as the
web's), no other icons (`./plugins/withAndroidAppIcons` runs only
expo-alternate-app-icons' Android steps) and not its native module
(`expo.autolinking.ios.exclude` in `apps/mobile/package.json`);
`test/disguiseIphone.test.ts` holds it. An iPhone that wore a disguise on
build 45 opens on LangQuest once it updates, and what that build kept (look,
note, the code's hash) is cleared, so a later build cannot put it back on by
itself. Android's build is unchanged (`expo prebuild` writes the same Android
project), and the iPhone pictures stay in `assets/disguise`. Reverse if: the
App Review Board allows the icons (then the iPhone gets the disguise back,
and the App Review notes describe it again).

Amended (2026-11-05, Caleb Koster): an iPhone build carries nothing of the
disguise, not even its words. Apple refused build 50 (2026.1103.2251) on
2026-11-05 under 2.5.19 with the same letter, from "code in the submitted
binary". Build 50 had no other icon and no native module, but it still
carried the disguise's words in the app's catalogs (all 16 languages, such as
"Makes LangQuest look like a calculator or a notepad on this phone"),
Android's ten icon names and their pictures' paths in the settings Expo copies
into every build (app.json's options for `./plugins/withAndroidAppIcons`),
and the iPhone's stand-in files in `src/disguise`. Caleb's call of 2026-11-03
(no calculator or notepad on iPhone) meant all of that, so:
- The disguise's words are in `src/disguise/i18n`, not `src/i18n`;
  `src/disguise/disguiseWords.ts` adds them to the language showing
  (`addWords`), and only Android's files import it.
- App.tsx and More settings reach the disguise through `src/shell/AppCover`,
  `AppIconRow` and `useNotificationsOffered`: their `.android` files import
  `src/disguise`, their own files (iPhone and web) are empty. The `.ios` and
  `.web` files in `src/disguise` are gone, and `AppIconRow.tsx` is the web's
  empty row that the 2026-10-29 amendment relies on.
- `./plugins/withAndroidAppIcons` holds the icon list and names each alias
  (it took in `./plugins/withDisguiseIcons`), so app.json names only the
  plugin. `expo prebuild` writes the same Android project as before.
- An iPhone no longer clears what build 45 kept: no iPhone ran a build that
  did, since build 50 was refused. An iPhone build that has the disguise
  again must not take that up as its own.
This is not hiding it: the iPhone app does not have the feature, and the code
names it plainly, as before. `test/disguiseIphone.test.ts` follows every
import an iPhone build bundles and fails on a file of `src/disguise`, or a
name, string or word of the disguise there, in its catalogs, or in the
settings Expo embeds; an export of the iPhone app (`expo export --platform
ios`) had none on 2026-11-05. Android is unchanged.

Amended (2026-11-07, Carl Sauder): a disguised Android phone is offered
Share nearby, with limits (Carl's answer 15; 231 has them in full). The
radios never run behind the cover: opening the screen does nothing, a press
starts it, ten minutes or "Up to date" stops it with no listening bursts,
and going to the background stops it for good, so only a new press after the
code restarts it. One warning comes before any permission prompt, because
Android's prompts name the app whatever icon the phone shows, and
`radios.joinHotspot` is false, since the hotspot's dialog names it too.
"Hold teammates' recordings" is off by default there. Its code goes through a
`.android` seam and its words stay in `src/disguise/i18n`, as the amendment of
2026-11-05 asks, so iPhone and web builds carry none of it. The broadcast has
nothing fixed the app picks, but its form may tell a determined scanner, and
the system's own names and address are not the app's to hide. Caleb should see
this, since this is his entry.

Amended (2026-11-10, Carl Sauder): Scan a code's camera never runs behind the
cover either. A phone that wears a disguise locks it on going to the
background and keeps the app mounted under it, so a link opened then (an
invite, or a Let someone in link with someone on the phone) landed on Scan a
code under the cover, and the screen opened the camera at once, or asked for
it in a prompt naming the real app, over the calculator. The screen now waits
until the code lifts the cover before it opens or asks (`cameraOnOpen`), and
draws the camera only while nothing covers the app (`cameraShows`), so coming
back covered to an open scanner turns it off (security review, 2026-11-10).
Caleb should see this, since this is his entry.
