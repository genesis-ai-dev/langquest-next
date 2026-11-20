import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SCREEN_TUTORIALS } from '../../apps/web/worker/tutorialScreens';
import { TUTORIALS } from './all';
import { screenVideos, tableSource } from './screen-videos';

// The app's screen ids, read from the file: the flow loads the app's catalogs.
const SCREEN_IDS = [...readFileSync('apps/mobile/src/shell/flow.ts', 'utf8').split('export const SCREEN_IDS = [')[1]!.split(']')[0]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

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
  it('reads the app\'s screens', () => expect(SCREEN_IDS).toContain('my_work'));

  it('lists only videos that are filmed and show that screen, for screens the app has', () => {
    for (const [screen, ids] of Object.entries(SCREEN_TUTORIALS)) {
      expect(SCREEN_IDS, `${screen} is no screen of the app`).toContain(screen);
      for (const id of ids) {
        expect(TUTORIALS[id], `${id}, listed for ${screen}, is no video: run npx tsx e2e/tutorials/screen-videos.ts --write`).toBeDefined();
        expect(TUTORIALS[id]!.steps.some((s) => s.screen === screen), `${id} no longer shows ${screen}: run npx tsx e2e/tutorials/screen-videos.ts --write`).toBe(true);
      }
    }
  });
});
