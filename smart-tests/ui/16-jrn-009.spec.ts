// JRN-009 Organization admin switches to the organization where they translate
// (docs/ui-test-suite/16-role-journeys.md). Its own world: switching changes
// the open organization kept for ADMIN.
import { backToTabs, watch } from './16-helpers';
import { button, expect, openAs, tab, tabsShown, test, text, useWorld } from './support';

const world = useWorld();

test('JRN-009 Organization admin switches to the organization where they translate', async ({ page }) => {
  test.setTimeout(240_000);
  const w = world();
  await watch(page, 'ADMIN');
  await openAs(page, w, 'ADMIN');
  await expect(tab(page, 'manage')).toBeVisible({ timeout: 60_000 });

  // Step 1: Me → More settings → Switch Organization → UI Second Org.
  await tab(page, 'me').click();
  await button(page, /^More settings/).click();
  await button(page, /^Switch Organization/).click();
  await button(page, w.org2Name).click();
  // The blank "Opening your organization" view, then My Work.
  await expect(page.getByText('Opening your organization').or(page.getByLabel('Opening your organization')).first()).toBeAttached({ timeout: 10_000 }).catch(() => {});
  await expect(text(page, 'My Work')).toBeVisible({ timeout: 60_000 });

  // Step 2: a translator there: Work, Map and Me; the Map opens Charlie's map.
  await expect.poll(() => tabsShown(page), { timeout: 30_000 }).toEqual(['work', 'map', 'me']);
  await expect(text(page, new RegExp(`Charlie · ${w.org2Name}`))).toBeVisible();
  await tab(page, 'map').click();
  await expect(text(page, 'Charlie')).toBeVisible();
  await expect(button(page, /^Luke\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Alpha: / })).toHaveCount(0);

  // Step 3: back to UI Test Org: Manage is back, and My Work shows ORG's items.
  await tab(page, 'me').click();
  await button(page, /^More settings/).click();
  await button(page, /^Switch Organization/).click();
  await button(page, w.orgName).click();
  await expect(text(page, 'My Work')).toBeVisible({ timeout: 60_000 });
  await backToTabs(page);
  await expect.poll(() => tabsShown(page), { timeout: 30_000 }).toEqual(['work', 'map', 'manage', 'me']);
  await tab(page, 'work').click();
  await expect(text(page, new RegExp(`Alpha · ${w.orgName}`))).toBeVisible();
});
