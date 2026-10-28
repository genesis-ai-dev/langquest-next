// "Work without internet", for everyone: Grace sees what her phone keeps, the
// internet goes, she records a part anyway, and it is sent by itself when the
// internet comes back.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, shows } from './workspace';

const tab = (page: Page, name: string) => page.getByRole('tab', { name }).locator('visible=true').first();
const cloud = (page: Page, name: RegExp) => page.getByRole('button', { name }).locator('visible=true').first();

export const workWithoutInternet: Tutorial = {
  id: 'work-without-internet',
  title: 'Work without internet',
  as: 'TRANS',
  names: recordAPassage.names,
  // A part of Luke 13:31-35, said into the microphone.
  speech: ['again.wav'],
  steps: [
    {
      screen: 'my_work',
      part: (page) => cloud(page, /^Live/),
      say: 'LangQuest works without internet. This cloud shows whether you are connected. A green dot means your work is sent as you go.',
      help: 'help.sync.live'
    },
    {
      screen: 'my_work',
      part: (page) => tab(page, 'Me'),
      say: 'Tap Me.',
      tap: true,
      until: (page) => button(page, /^Ready for offline/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'settings_home',
      part: (page) => button(page, /^Ready for offline/),
      say: 'Ready for offline shows how many passages this phone keeps, to work on anywhere.'
    },
    {
      screen: 'settings_home',
      part: (page) => tab(page, 'Work'),
      say: 'Back to My Work.',
      tap: true,
      until: (page) => id(page, 'primary-action').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'my_work',
      first: (page) => page.context().setOffline(true),
      part: (page) => cloud(page, /^Offline/),
      say: 'When the internet goes, the dot turns amber. Keep working. Everything you do is kept on this phone.',
      help: 'help.sync.offline'
    },
    {
      screen: 'my_work',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Start, and record as usual.',
      tap: true,
      until: (page) => shows(page, 'path-step-record'),
      stay: 0.6
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      tap: true,
      until: (page) => shows(page, 'record-button'),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'record-button'),
      tap: true,
      speak: 0
    },
    {
      screen: 'workspace',
      atSpeech: 8.9,
      part: (page) => id(page, 'record-button'),
      tap: true,
      until: (page) => shows(page, 'live-part-1'),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Tap the tick to keep it.',
      tap: true,
      until: (page) => shows(page, 'publish-button'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'saved-mark'),
      say: 'Your recording is kept on this phone.',
      help: 'saved.draftHelp'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'upload-bar'),
      say: 'This bar says what is waiting to upload.'
    },
    {
      screen: 'workspace',
      first: (page) => page.context().setOffline(false),
      part: (page) => id(page, 'upload-bar'),
      say: 'When the internet comes back, it uploads by itself. There is nothing to do.',
      until: (page) => page.getByText('All uploaded', { exact: true }).locator('visible=true').first().waitFor({ timeout: 60_000 }),
      stay: 2.5
    }
  ]
};
