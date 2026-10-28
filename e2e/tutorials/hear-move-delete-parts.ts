// "Hear, move and delete parts", for translators: what to do with the parts
// once they are recorded. Off camera, Grace records Luke 13:31-33 with two
// mistakes: verse 33 said before verse 32, and a false start at the end. On
// camera she hears a part, moves it, deletes the false start (with Undo and
// Redo), says Part 1 again, and hears every part. The speaker reads in French
// (Louis Segond 1910), the made-up language's stand-in.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, divider, id, partRow, recordOffCamera } from './workspace';

export const hearMoveDeleteParts: Tutorial = {
  id: 'hear-move-delete-parts',
  title: 'Hear, move and delete parts',
  as: 'TRANS',
  names: recordAPassage.names,
  // 31 | 33 said too soon | 32 | "Euh… pardon, je recommence." Then Part 1 said again.
  speech: ['fix.wav', 'again.wav'],
  before: (page, mic) => recordOffCamera(page, mic, 4),
  steps: [
    {
      screen: 'workspace',
      part: (page) => [button(page, /^Parts 1–4, 4 parts · /), ...partRow(page, 4)],
      say: "Here's how to hear and fix your parts. Each row is one part of your recording.",
      stay: 0.3
    },
    {
      screen: 'workspace',
      part: (page) => divider(page),
      say: 'Drag the divider up to give your parts more room.',
      help: 'recording.split.dividerHelp',
      drag: { by: { x: 0, y: -230 } },
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Play Part 2'),
      say: 'Tap play on a part to hear just that part.',
      help: 'passage.versions.partHelp',
      tap: true,
      stay: 7.4
    },
    {
      screen: 'workspace',
      part: (page) => partRow(page, 2),
      say: 'Part two is verse thirty-three, said too soon. It belongs after part three.'
    },
    {
      screen: 'workspace',
      part: (page) => page.getByLabel('Move Part 2', { exact: true }).locator('visible=true').first(),
      say: 'Drag a part by its handle to move it.',
      help: 'recording.recorder.movePartHelp',
      drag: { to: (page) => page.getByLabel('Move Part 3', { exact: true }).locator('visible=true').first() },
      stay: 1
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Play Part 4'),
      say: 'Part four is a false start.',
      tap: true,
      stay: 2.4
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Record Part 4 again'),
      say: 'To delete a part, slide it aside to show its bin.',
      help: 'recording.recorder.slideToDeleteHelp',
      tapAt: (b) => ({ x: b.x + b.width - 16, y: b.y + b.height / 2 }),
      drag: { by: { x: -110, y: 0 } },
      stay: 0.4
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Delete Part 4'),
      say: 'Then tap the bin.',
      help: 'recording.recorder.deletePartHelp',
      tap: true,
      until: (page) => button(page, /^Parts 1–3, 3 parts · /).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'undo'),
      say: 'Changed your mind? Undo brings it back.',
      help: 'recording.recorder.undoHelp',
      tap: true,
      until: (page) => button(page, /^Parts 1–4, 4 parts · /).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'redo'),
      say: 'Redo takes it away again.',
      help: 'common.redoHelp',
      tap: true,
      until: (page) => button(page, /^Parts 1–3, 3 parts · /).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Record Part 1 again'),
      say: 'To say a part again, tap it. What you record next replaces that part.',
      help: 'recording.recorder.recordOverHelp',
      tap: true,
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => id(page, 'record-button'),
      say: 'Then tap the red button and speak.',
      help: 'recording.recordButton.recordHelp',
      tap: true,
      speak: 1
    },
    {
      screen: 'workspace',
      atSpeech: 6.5,
      part: (page) => id(page, 'record-button'),
      say: "Tap stop when you've finished.",
      help: 'recording.recordButton.stopHelp',
      tap: true,
      until: (page) => page.getByText('Stopped', { exact: true }).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Done'),
      say: 'Then tap the tick to keep it.',
      help: 'recording.recorder.leaveHelp',
      tap: true,
      until: (page) => id(page, 'publish-button').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Record a new part before Part 2'),
      say: 'To add a new part between two others, tap the plus between them.',
      help: 'recording.recorder.recordBeforeHelp'
    },
    {
      screen: 'workspace',
      part: (page) => button(page, 'Play Parts 1–3'),
      say: 'Tap play at the top to hear every part, one after another.',
      help: 'recording.recorder.playAllHelp',
      tap: true,
      stay: 9
    }
  ]
};
