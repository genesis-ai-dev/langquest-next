import { helpLines, lineHash } from './help-audio';

/** Help mode's recordings are named by their words (scripts/help-audio.ts, apps/mobile/src/helpAudio.ts). */
describe('help audio lines', () => {
  it('names a recording by its language and exact words, as the phone does', () => {
    // SHA-256 of "en\nGot it", first 16 hex digits: the same on the phone (expo-crypto) and here.
    expect(lineHash('en', 'Got it')).toBe(lineHash('en', ' Got it '));
    expect(lineHash('en', 'Got it')).not.toBe(lineHash('es', 'Got it'));
    expect(lineHash('en', 'Got it')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('lists each line once and leaves out lines with names or numbers in them', () => {
    const lines = helpLines('en', {
      a: { done: 'Done', hello: 'Hello {{name}}', bold: 'Tap <b>Start</b>' },
      help: { details: { primary: 'The main thing to do on this screen.' } },
      b: { again: 'Done' }
    });
    expect(lines.map((l) => l.text)).toEqual(['Done', 'The main thing to do on this screen.']);
  });
});
