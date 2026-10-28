// "Record a passage", for translators: from My Work to the parts kept as a
// draft, ending on Done (the next video, "Finish and ask for a check", starts
// there). The speaker reads Luke 13:31-33 in French (Louis Segond 1910), the
// made-up language's stand-in, a pause after each verse.
import type { Tutorial } from './tutorial';
import { button, id, shows } from './workspace';

export const recordAPassage: Tutorial = {
  id: 'record-a-passage',
  title: 'Record a passage',
  as: 'TRANS',
  names: {
    org: 'Riverside Translation Team', org2: 'Hillside Bible Fellowship', languages: { A: 'Lumari' },
    people: { TRANS: 'Grace', COORD: 'Daniel', REV: 'Ruth', TREV: 'Peter', ADMIN: 'Samuel', LADMIN: 'Esther', VIEW: 'Joseph' }
  },
  speech: ['passage.wav'],
  steps: [
    {
      screen: 'my_work',
      part: (page) => [page.getByText('Next for you', { exact: true }).locator('visible=true').first(), id(page, 'primary-action')],
      say: "Here's how to record a passage. My Work shows what's next for you.",
      stay: 0.3
    },
    {
      screen: 'my_work',
      part: (page) => id(page, 'primary-action'),
      say: 'Daniel has asked you to record Luke thirteen, verses thirty-one to thirty-five. Tap Start.',
      help: 'work.lead.startHelp',
      tap: true,
      until: (page) => shows(page, 'path-step-record'),
      stay: 0.6
    },
    {
      screen: 'passage_record',
      part: (page) => [id(page, 'path-step-record'), page.getByText('Then ask for the peer check').locator('visible=true').first()],
      say: 'First you record the passage in your own language. Then you finish it, and ask for a check.'
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap Record.',
      tap: true,
      until: (page) => shows(page, 'record-button'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      // The card and the verses showing above the divider (13:33 is under the parts).
      part: (page) => [button(page, 'Play Luke 13:31–35'), button(page, 'Add a note here'), page.getByRole('button', { name: /^Verse 13:32\./ }).locator('visible=true').first()],
      say: 'The Bible for this passage is at the top. Read it, or tap play to hear it, before you speak.',
      help: 'reference.passageText.listenHelp'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'record-button'),
      say: "When you're ready, tap the red button and start speaking. Pause between parts: each part is kept by itself.",
      help: 'recording.recordButton.recordHelp',
      tap: true,
      speak: 0
    },
    {
      screen: 'workspace',
      atSpeech: 6.2,
      say: 'Solid bars are your voice being kept. Faint bars are quiet.',
      help: 'recording.recorder.nextRecordingHelp'
    },
    {
      screen: 'workspace',
      atSpeech: 27.4,
      part: (page) => id(page, 'record-button'),
      say: "When you've finished, tap stop. What you said is kept, part by part.",
      help: 'recording.recordButton.stopHelp',
      tap: true,
      until: (page) => shows(page, 'live-part-3'),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'live-parts'),
      say: 'Each box is one part.'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'live-part-1'),
      say: 'Tap a part to hear it.',
      help: 'recording.recorder.stoppedHelp',
      tap: true,
      tapAt: (b) => ({ x: b.x + b.width / 2, y: b.y + 40 }),
      stay: 5.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Tap the tick to keep your parts.',
      help: 'recording.recorder.leaveHelp',
      tap: true,
      until: (page) => shows(page, 'publish-button'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'saved-mark'),
      say: "Your recording is kept on this phone as you go, and only you can see it until you finish. There's nothing to save.",
      help: 'saved.draftHelp'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'publish-button'),
      say: 'When every part is recorded, tap Done to finish this version and send it to its next check. The next video shows how.',
      help: 'recording.recorder.doneHelp',
      stay: 1.2
    }
  ]
};
