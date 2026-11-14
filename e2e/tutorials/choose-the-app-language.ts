// "Choose the app's language", for everyone: Grace opens Language on Me,
// picks Arabic (the app starts again, right to left), and goes back to her own
// language (English, or the film's: the picker names each in itself).
// After each restart the app shows "Loading your work…" under My Work's
// title, then opens Me again, where it was: a step waits for Me's Language
// row, so its screen reads the same every night (it was read at either one,
// and the video was filmed again with nothing changed, 6, 8 and 9 Nov).
import type { Page } from 'playwright';
import { UI_LANGUAGES } from '@langquest-next/core';
import type { Tutorial } from './tutorial';
import { FILM_LANGUAGE, asIs, escape } from './ui';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).locator('visible=true').first();
const radio = (page: Page, name: RegExp) => page.getByRole('radio', { name: asIs(name) }).locator('visible=true').first();
const own = new RegExp(`^${escape(UI_LANGUAGES.find((l) => l.code === FILM_LANGUAGE)!.name)}`);

export const chooseTheAppLanguage: Tutorial = {
  id: 'choose-the-app-language',
  title: "Choose the app's language",
  as: 'TRANS',
  notIn: ['ar'],
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Me'),
      say: "Here's how to choose the language LangQuest speaks to you in. Tap Me.",
      tap: true,
      until: (page) => button(page, /^Language/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^Language/),
      say: 'Tap Language.',
      tap: true,
      until: (page) => radio(page, own).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'settings_home',
      part: (page) => page.getByRole('radio').locator('visible=true').first(),
      // As many as the list has (Tagalog made it sixteen, LAN-223).
      say: `There are ${UI_LANGUAGES.length} languages. The first one follows the language of your phone.`
    },
    {
      screen: 'settings_home',
      part: (page) => radio(page, /^العربية/),
      say: 'Tap one. Here, Arabic. LangQuest starts again in it, and your work waits safely while it does.',
      tap: true,
      // Back on Me, in Arabic: the tab bar shows while the app still loads, its Language row only once it is on Me.
      until: (page) => button(page, /^اللغة/).waitFor({ timeout: 120_000 }),
      stay: 1.5
    },
    {
      // The whole screen, turned around.
      screen: 'settings_home',
      say: 'Arabic reads from right to left, so the whole app turns around.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^اللغة/),
      say: 'To change it back, tap Language again,',
      tap: true,
      until: (page) => radio(page, own).waitFor({ timeout: 10_000 }),
      stay: 0.4
    },
    {
      screen: 'settings_home',
      part: (page) => radio(page, own),
      say: 'and choose.',
      tap: true,
      until: (page) => button(page, /^Language/).waitFor({ timeout: 120_000 }),
      stay: 2
    }
  ]
};
