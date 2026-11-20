import { describe, expect, it } from 'vitest';
import { SCREEN_TUTORIALS } from '@langquest-next/core';
import { SCREEN_IDS } from '../src/shell/flow';

describe('the help page links a video to a screen', () => {
  it('only for screens the app has', () => {
    for (const s of Object.keys(SCREEN_TUTORIALS)) expect(SCREEN_IDS as readonly string[]).toContain(s);
  });
});
