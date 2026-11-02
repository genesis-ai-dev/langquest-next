// "Use the ? help", for everyone: on My Work, Grace turns help on, taps a part
// to see what it does, taps another, and turns help off.
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id } from './workspace';

export const useTheHelp: Tutorial = {
  id: 'use-the-help',
  title: 'Use the ? help',
  as: 'TRANS',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => id(page, 'header-help'),
      say: 'Every screen has a question mark. Tap it to have the screen explained.',
      tap: true,
      until: (page) => button(page, 'Turn help off').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      // The whole screen, where every number shows (two numbers lit made a thin ring through the cards).
      screen: 'my_work',
      say: 'Each part of the screen gets a number.'
    },
    {
      screen: 'my_work',
      part: (page) => id(page, 'primary-action'),
      say: 'Tap a part to see what it does. Nothing happens when you tap it now.',
      tap: true,
      until: (page) => button(page, /^Start\. /).waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Listen'),
      say: 'Tap play to hear it read aloud.'
    },
    {
      screen: 'my_work',
      part: (page) => button(page, /^Updates/),
      say: 'Tap another part to learn about that one.',
      tap: true,
      until: (page) => page.getByRole('button', { name: /^Updates.*\. / }).locator('visible=true').first().waitFor({ timeout: 10_000 }),
      stay: 2
    },
    {
      screen: 'my_work',
      part: (page) => button(page, 'Turn help off'),
      say: "When you've finished, tap the question mark again.",
      tap: true,
      until: (page) => button(page, 'Help: explain this screen').waitFor({ timeout: 10_000 }),
      stay: 1.5
    }
  ]
};
