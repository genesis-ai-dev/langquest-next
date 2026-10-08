// Help mode (demo ADR-038): what a part says when tapped while help is on.
import { describe, expect, it } from 'vitest';
import { helpLine } from '../src/helpContext';

describe('help mode', () => {
  it('says the part and what it does, or just the part', () => {
    expect(helpLine('Something else?', 'Another way forward, less often needed.')).toBe('Something else? Another way forward, less often needed.');
    expect(helpLine('Record', 'The main thing to do on this screen.')).toBe('Record. The main thing to do on this screen.');
    expect(helpLine(' Record ')).toBe('Record');
    expect(helpLine('Publish', '  ')).toBe('Publish');
  });
});
