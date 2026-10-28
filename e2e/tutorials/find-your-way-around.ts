// "Find your way around", for everyone: Grace's three tabs. My Work (what is
// next, what comes after, what waits on others), the cloud and the bell; the
// Map; Me; and the ? on every screen.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

const tab = (page: Page, name: string) => page.getByRole('tab', { name }).locator('visible=true').first();

export const findYourWayAround: Tutorial = {
  id: 'find-your-way-around',
  title: 'Find your way around',
  as: 'TRANS',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => [page.getByRole('heading', { name: 'My Work' }).locator('visible=true').first(), id(page, 'primary-action')],
      say: "Here's a quick look around. My Work shows what to do next, and who asked you."
    },
    {
      screen: 'my_work',
      part: (page) => [button(page, /^Luke 13:22–30/), button(page, /^Luke 13:10–17/)],
      say: 'Under it is what comes after.'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, /^Waiting on others/),
      say: 'And here is work that waits on someone else.'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Live'),
      say: 'A green dot on the cloud means you are connected, and your work is sent as you go.',
      help: 'help.sync.live'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, /^Updates/),
      say: 'The bell has your updates: checks asked of you, feedback, and news from your team.'
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Map'),
      say: 'Tap Map.',
      tap: true,
      until: (page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'map_home',
      part: (page) => button(page, /^Luke\. /),
      say: 'The map shows every book, and how far each one has come. Tap a book to see its passages.'
    },
    {
      screen: 'map_home',
      part: (page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first(),
      say: 'Or type a passage to find it.'
    },
    {
      screen: 'map_home',
      part: (page) => tab(page, 'Me'),
      say: 'Tap Me.',
      tap: true,
      until: (page) => button(page, /^More settings/).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'settings_home',
      part: (page) => [button(page, /Name and photo$/), button(page, /^More settings/)],
      say: 'Me has your name, what this phone keeps for when there is no internet, and your settings.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^How LangQuest works/),
      say: 'How LangQuest works plays a short tour.'
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, 'Help: explain this screen'),
      say: 'And on every screen, tap the question mark to have it explained.',
      stay: 2
    }
  ]
};
