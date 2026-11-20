import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Android's own permission question takes the app to the background, and it is not leaving the
// screen (docs/nearby-sync-plan.md 5.8). A nearby screen that asks and gates its radios on AppState
// must not read that background as leaving, or its run stops under the question: on 2026-11-20 Give
// the app showed "Stopped." on its first Show the first code, while Android asked for nearby devices.

const NEARBY = join(import.meta.dirname, '..', 'src', 'nearby');

/** The nearby hooks that ask for a permission and follow AppState, with their source. */
function askingHooks(): { file: string; src: string }[] {
  return readdirSync(NEARBY)
    .filter((f) => /^use\w+\.(android|native)\.ts$/.test(f))
    .map((file) => ({ file, src: readFileSync(join(NEARBY, file), 'utf8') }))
    .filter(({ src }) => src.includes('askNearbyPermissions(') && src.includes('AppState.addEventListener('));
}

describe('a nearby screen while Android asks for a permission', () => {
  it('finds the screens that ask', () => {
    expect(askingHooks().map((h) => h.file)).toEqual(expect.arrayContaining(['useNearby.native.ts']));
  });

  it.each(askingHooks().map((h) => [h.file, h.src]))('%s stays on screen while Android asks', (_file, src) => {
    expect(src).toContain('askingForNearby()');
  });
});
