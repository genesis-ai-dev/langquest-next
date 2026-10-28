// "Choose the app's language", for everyone: Grace opens Language on Me,
// picks Arabic (the app starts again, right to left), and goes back to English.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).locator('visible=true').first();
const radio = (page: Page, name: RegExp) => page.getByRole('radio', { name }).locator('visible=true').first();

export const chooseTheAppLanguage: Tutorial = {
  id: 'choose-the-app-language',
  title: "Choose the app's language",
  as: 'TRANS',
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
      until: (page) => radio(page, /^English/).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'settings_home',
      part: (page) => [page.getByRole('radio').locator('visible=true').first(), page.getByRole('radio').locator('visible=true').nth(4)],
      say: 'There are fifteen languages. The first one follows the language of your phone.'
    },
    {
      screen: 'settings_home',
      part: (page) => radio(page, /^العربية/),
      say: 'Tap one. Here, Arabic. LangQuest starts again in it, and your work waits safely while it does.',
      tap: true,
      until: (page) => tab(page, 'أنا').waitFor({ timeout: 120_000 }),
      stay: 1.5
    },
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tablist').locator('visible=true').first(),
      say: 'Arabic reads from right to left, so the whole app turns around.'
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'أنا'),
      say: 'To change it back, tap Me again,',
      tap: true,
      until: (page) => button(page, /^اللغة/).waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^اللغة/),
      say: 'then Language,',
      tap: true,
      until: (page) => radio(page, /^English/).waitFor({ timeout: 10_000 }),
      stay: 0.4
    },
    {
      screen: 'settings_home',
      part: (page) => radio(page, /^English/),
      say: 'and choose.',
      tap: true,
      until: (page) => tab(page, 'Me').waitFor({ timeout: 120_000 }),
      stay: 2
    }
  ]
};
