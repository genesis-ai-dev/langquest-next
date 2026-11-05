// The harness itself: a world builds, the app opens signed in as a fixture
// account on its home, and the helpers find the kit's testIDs.
import { expect, openAs, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld();

test('harness: the translator opens on My Work with Work, Map and Me', async ({ page }) => {
  await openAs(page, world(), 'TRANS');
  await expect(tab(page, 'work')).toBeVisible({ timeout: 60_000 });
  expect(await tabsShown(page)).toEqual(['work', 'map', 'me']);
  await expect(text(page, 'Next for you')).toBeVisible();
});
