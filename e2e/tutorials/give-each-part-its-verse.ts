// "Give each part its verse", for translators: the verse space at the start
// of each part's row. Off camera, Grace records Luke 13:31-35 in five parts:
// verse 31, verse 32 in two parts, verse 33, and verses 34 and 35 together.
// On camera she taps the spaces, gives Part 3 the same verse as the part
// above, and holds Part 5's space to choose two verses. The speaker reads in
// French (Louis Segond 1910), the made-up language's stand-in.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, divider, id, partRow, recordOffCamera, verseSpace } from './workspace';

const tile = (page: Page, verse: number) => page.getByRole('button', { name: new RegExp(`^Verse ${verse}$`) }).locator('visible=true').last();

export const giveEachPartItsVerse: Tutorial = {
  id: 'give-each-part-its-verse',
  title: 'Give each part its verse',
  as: 'TRANS',
  names: recordAPassage.names,
  // 31 | 32 (first half) | 32 (second half) | 33 | 34 and 35.
  speech: ['verses.wav'],
  before: (page, mic) => recordOffCamera(page, mic, 5),
  steps: [
    {
      screen: 'workspace',
      part: (page) => [button(page, /^Parts 1–5, 5 parts · /), ...partRow(page, 4)],
      say: "Here's how to give each part its verse.",
      stay: 0.3
    },
    {
      screen: 'workspace',
      part: (page) => divider(page),
      say: 'Drag the divider up to see all your parts.',
      help: 'recording.split.dividerHelp',
      drag: { by: { x: 0, y: -230 } },
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => [1, 2, 3, 4, 5].map((n) => verseSpace(page, n)),
      say: 'Each part has a space for its verse. The faint number is the verse a tap gives.',
      help: 'recording.verses.spaceEmptyHelp'
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 1),
      say: 'Part one is verse thirty-one. Tap its space.',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 2),
      say: 'Part two starts verse thirty-two.',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 3),
      say: 'Part three goes on with verse thirty-two. A tap gives it the next verse,',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 3),
      say: 'and a second tap gives it the same verse as the part above. A hollow number means more of the verse above.',
      help: 'recording.verses.spaceSameHelp',
      tap: true,
      stay: 1
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 4),
      say: 'Part four is verse thirty-three.',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 5),
      say: 'Part five says verses thirty-four and thirty-five. Hold its space to choose.',
      help: 'recording.verses.hintEmpty',
      press: (page) => button(page, 'None'),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => tile(page, 34),
      say: 'Tap the first verse,',
      help: 'recording.verses.pickHelp',
      tap: true,
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => tile(page, 35),
      say: 'then a later one, to cover several verses.',
      help: 'recording.verses.pickedHelp',
      tap: true,
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => [button(page, 'Auto'), button(page, 'None')],
      say: 'Auto works out the verse from the parts around it. None leaves the part without a verse.',
      help: 'recording.verses.autoHelp'
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Close'),
      say: "Close it when you're done.",
      tap: true,
      until: (page) => button(page, 'None').waitFor({ state: 'hidden', timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => verseSpace(page, 5),
      say: 'The ring means you chose these verses yourself.',
      help: 'recording.verses.spaceSetHelp'
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'undo'),
      say: 'Each verse is kept as you go. Undo takes back the last change.',
      help: 'recording.recorder.undoHelp',
      stay: 1.2
    }
  ]
};
