# 81. The app's words come from catalogs in the app, in the language chosen on the device or the phone's; English is the source

Date: 2026-10-09 · By: Caleb Koster · Status: accepted

Reason: field teams who do not read English could not use the app (LAN-42);
every word was written into the screens. Chosen (`docs/localization.md`):
- `i18next` and `react-i18next`, with one JSON catalog per language in
  `apps/mobile/src/i18n/` and English the source. Fifteen languages: LAN-42's
  thirteen (`en`, `es`, `pt` in Brazilian wording, `fr`, `ar`, `sw`, `ha`,
  `am`, `hi`, `bn`, `ne`, `id`, `zh-Hans`) and Thai and Burmese from
  LangQuest v2's list. Dates and numbers through `Intl`; plurals by each
  language's own rules (`src/i18n/plurals.ts` stands in where the engine has
  no `Intl.PluralRules`).
- The language is a setting of the device, not an event: Me → Language (and
  a globe on the sign-in screen) keeps it in expo-sqlite's key-value store,
  read before the first screen draws, or the browser's localStorage. Nothing
  to sync and no migration; people sharing a phone share it. Without a
  choice the phone's language is followed (`expo-localization`) for any
  catalog approved for release (`approved` in `src/i18n/languages.ts`). The
  fourteen first catalogs are machine translations Caleb approved as they
  are: the teams who read them are the reviewers there are, and they can
  only say what reads wrong once the app speaks their language. A language
  added later may stay a draft until approved: anyone may pick it, it says
  it is a draft, and the phone's language never switches to it.
- Arabic lays the app out right to left; on a phone the app restarts once to
  change direction (`src/i18n/start.ts`).
- "No hard-coded words" is a test, run by `npm test` and before a push:
  `apps/mobile/test/i18n.test.ts` fails on a word written into the code
  where a person would see it, a key used but missing or defined but unused,
  and a catalog that lacks keys, adds keys, has the wrong plural forms or
  drops a placeholder. `t()` keys are typed, so a wrong key fails the
  typecheck.
- `packages/core` stays English and pure; `src/coreText.ts` says its words
  (review states, shipped kinds unless renamed, a passage's state, command
  errors, licenses, book names). Library documents (36), names people typed,
  and words stored in the event log are shown as written.
- Emails go in the sender's app language: the invite now (the phone sends its
  language; `apps/invite-email/src/i18n/`), and the password reset email's
  words are ready for Forgot password.
- Help mode speaks recorded lines per language: files named by a hash of the
  language and the words, listed and served by the Worker
  (`/api/help-audio`, `npm run help-audio`), kept on the phone once heard.
  A line nobody has recorded shows as words, read aloud on the web.
This departs from `docs/languoids.md`'s proposal that interface translations
be library items an organization publishes: bundled catalogs work offline
from the first launch and need no server; a published localization could
later sit over them. Push notifications' words are still written in English
by the database (the Inbox shows its own words by kind).
Reverse if: translators need to change words between app releases (then the
library localization), or people want their language to follow them to
other devices (then an event in the person stream).
Amended (2026-11-04, Caleb Koster): Tagalog (`tl`) is the sixteenth language
(LAN-223), a machine translation released as approved, as the first fourteen
were. Phones and browsers call it Filipino, so its locale is `fil` (iOS's
folder, `Intl` dates, numbers and plurals) while Android's folder is
`values-tl` and the library's code `tgl`. Its invite email, web pages, Bible
book names, library labels and YouTube words come with it. It has no YouTube
channel yet, so it stays out of `CHANNELS` (`server/youtube.ts`): no video
description links to it and none is filmed in it until the channel exists.
