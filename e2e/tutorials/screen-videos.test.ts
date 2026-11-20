import { describe, expect, it } from 'vitest';
import { SCREEN_TUTORIALS } from '@langquest-next/core';
import { TUTORIALS } from './all';
import { screenVideos, tableSource } from './screen-videos';

/** Help mode's videos for a screen (screen-videos.ts, LAN-244). */
describe('the videos help mode lists for a screen', () => {
  it('ranks the videos by their steps on the screen', () => {
    const step = (screen: string) => ({ screen }) as never;
    expect(screenVideos({
      a: { steps: [step('my_work'), step('map_home')] },
      b: { steps: [step('my_work'), step('my_work'), step('my_work')] },
      c: { steps: [step('my_work'), step('my_work')] }
    })).toEqual({ map_home: ['a'], my_work: ['b', 'c'] });
    expect(tableSource({ my_work: ['b', 'c'] })).toContain("  my_work: ['b', 'c']\n};");
  });

  // Only a video that still shows the screen: a script that no longer goes there fails here. A video
  // that newly spends steps on a screen is listed when the table is written again (screen-videos.ts --write).
  it('lists only videos that are filmed and show that screen', () => {
    for (const [screen, ids] of Object.entries(SCREEN_TUTORIALS)) {
      for (const id of ids) {
        expect(TUTORIALS[id], `${id}, listed for ${screen}, is no video: run npx tsx e2e/tutorials/screen-videos.ts --write`).toBeDefined();
        expect(TUTORIALS[id]!.steps.some((s) => s.screen === screen), `${id} no longer shows ${screen}: run npx tsx e2e/tutorials/screen-videos.ts --write`).toBe(true);
      }
    }
  });
});
