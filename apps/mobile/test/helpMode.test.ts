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

describe('first-time screen intros (decision 71, demo a-helpFirst)', () => {
  it('the screens people open first each say what they are for, in a sentence or two', async () => {
    const { SCREEN_INTROS } = await import('../src/helpContext');
    const { SCREEN_IDS } = await import('../src/flow');
    for (const id of ['my_work', 'passage_record', 'workspace', 'review_capture', 'back_translation', 'map_home', 'settings_home', 'get_ready']) {
      expect(SCREEN_INTROS[id], id).toBeTruthy();
    }
    for (const [id, text] of Object.entries(SCREEN_INTROS)) {
      expect(SCREEN_IDS as readonly string[], id).toContain(id);
      expect(text!.length, id).toBeLessThan(160);
    }
  });
});
