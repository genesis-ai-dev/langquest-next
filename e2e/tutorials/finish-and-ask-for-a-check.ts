// "Finish and ask for a check", for translators: what comes after "Record a
// passage". Off camera, Grace records Luke 13:31-35 in three parts; on camera
// she taps Done, sees the next check and its people, and asks them.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, recordOffCamera } from './workspace';

export const finishAndAskForACheck: Tutorial = {
  id: 'finish-and-ask-for-a-check',
  title: 'Finish and ask for a check',
  as: 'TRANS',
  names: recordAPassage.names,
  speech: ['passage.wav'],
  before: (page, mic) => recordOffCamera(page, mic, 3),
  steps: [
    {
      screen: 'workspace',
      part: (page) => id(page, 'publish-button'),
      say: "Here's how to finish a recording and ask for a check. When every part is recorded, tap Done.",
      help: 'recording.recorder.doneHelp',
      tap: true,
      until: (page) => page.getByText('Next check', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('button', { name: /^Play/ }).locator('visible=true').first(),
      say: 'This is your last look before it goes out. You can listen to the whole version once more.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByText('Say something about it', { exact: true }).locator('visible=true').first(),
      say: 'To tell the team something about this version, say it here. They hear it with your recording.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByRole('radio', { name: /^Peer check/ }).locator('visible=true').first(),
      say: 'Next comes the check to ask for, with the people who do it. Tap another check to ask for that one instead.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByPlaceholder('Ask something specific').locator('visible=true').first(),
      say: 'You can add a question for them to answer.',
      type: 'Is verse 34 easy to follow?',
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Add question'),
      say: 'Then tap Add question.',
      tap: true,
      stay: 1
    },
    {
      screen: 'workspace',
      part: (page) => [button(page, 'Someone else'), button(page, 'Send later')],
      say: 'Tap Someone else to choose another person. Send later keeps your version without asking anyone yet.'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'primary-action'),
      say: 'To ask the Peer check team, tap here.',
      tap: true,
      until: (page) => id(page, 'toast').waitFor({ timeout: 30_000 }),
      stay: 1.5
    },
    {
      screen: 'passage_record',
      part: (page) => page.getByRole('button', { name: /^Peer check, asked/ }).locator('visible=true').first(),
      say: 'Your version is finished, and the team sees it on My Work. This row shows who was asked.',
      stay: 1.2
    }
  ]
};
