# Localization

The app's own words are in the person's language (LAN-42, decisions.md 80).
English is the source. Library documents (templates, flows, reference
material, study guides) are the organization's content and are shown as
written (decision 36); so are names people typed and anything stored in the
event log.

## How a word reaches the screen

- `apps/mobile/src/i18n/en.json` holds every word, nested by area
  (`account.signOut.title`). The other catalogs beside it (`es.json`,
  `ar.json`, ...) hold the same keys.
- Code says `t('account.signOut.title')`, with `t` from `src/i18n`. Keys are
  typed from `en.json`, so a wrong key fails `npm run typecheck`.
- `apps/mobile/test/i18n.test.ts` (part of `npm test`) fails when:
  - a word is written straight into the code where a person would see it
    (text in JSX, a string in a shown prop such as `label` or `title`, or a
    string anywhere that reads like prose: two words, or one capitalised
    word); `npx tsx apps/mobile/test/uiText.ts` lists them;
  - `t()` runs at module scope, before the language is known;
  - a key is used but not in `en.json`, or in `en.json` but used nowhere;
  - a catalog lacks a key, has one English does not, has the wrong plural
    forms for its language, or drops a placeholder or tag.

## Writing words

- **Whole sentences, with placeholders.** `t('passage.recordedBy', { name })`
  with `"Recorded by {{name}}"`, never `'Recorded by ' + name`: each language
  puts the name where it belongs. Name placeholders for what they hold.
- **Counts.** `t('map.passages', { count })` with `passages_one` and
  `passages_other` in English; `{{count, number}}` formats the number for the
  language. Other languages have the forms their language needs (Arabic six,
  Chinese one); the test knows which. Never build plurals by hand (`${n}
  passage${n === 1 ? '' : 's'}`).
- **Dates, numbers, sizes** go through `src/i18n/format.ts` (`formatNumber`,
  `formatDay`, `formatAgo`, `formatClock`, `formatBytes`, ...), never
  `toLocaleString('en-US')` or month tables.
- **Bold or linked words inside a sentence** use `Trans` from `src/i18n`:
  `"Tap <b>Start</b> to begin"` with
  `<Trans i18nKey="work.tapStart" components={{ b: <Text style={bold} /> }} />`.
- **Never at module scope.** A table of labels is a function (or a `switch`)
  so it is read in the language showing.
- **Help counts.** `accessibilityLabel`, help mode's details and screen intros
  are words too.
- **Short and plain.** The words are read by people new to phones and then
  translated; shorter English translates better.

## What is not translated

Mark a string that a person never reads with an `i18n-ignore` comment on its
line or the line above, saying why:

- ids, storage keys, log labels (the first argument of `noteExpected`,
  `reportError`, `failureMessage`), test ids;
- words written into the event log or sent to the server: translate them
  where they are shown, not where they are stored;
- a language's name in its own script (the language picker).

Developer-only files may skip the check with `i18n-ignore-file` and a reason
in their first lines (`DevMenu.tsx`, `dev.ts`, and the Bible text samples).

## Words from core and the server

`packages/core` stays English and pure. `src/coreText.ts` says its words in
the language showing: review states, the shipped kinds of review (unless an
organization renamed them), a passage's one-line state, core's command
errors, licenses and the books of the Bible. A server message (a Supabase
error) is shown through a key for its code, or a general message.

## Right to left

Arabic lays the app out right to left. On a phone the app restarts once to
change direction (`src/i18n/start.ts`); React Native mirrors rows and swaps
left and right. Icons that point along the line (chevrons, arrows, send,
undo) mirror in `Ico`; media controls do not. New styles use `start`/`end`
(`marginStart`, `paddingEnd`) rather than `left`/`right`, so the web mirrors
too.

## Languages

`src/i18n/languages.ts` lists them, each with its own name, direction and
whether a fluent speaker has reviewed it. Me → Language (and the globe on the
sign-in screen) offers every language; a draft says so. The phone's language
is followed only for reviewed catalogs, so nobody is switched into a machine
draft without choosing it.

To add a language: add it to `languages.ts`, add `<code>.json` with every key,
add its line to `catalogs.ts`, and add it to `supportedLocales` for
`expo-localization` in `app.json` (a new build). The test says what is
missing.

To release a draft: a fluent speaker reads the whole app in it, corrects the
catalog, and their name and the date go in its `reviewed` field.
