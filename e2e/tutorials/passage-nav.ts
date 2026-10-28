// Finding a passage on the Map, on camera: the steps several videos start with.
import type { Page } from 'playwright';
import type { Step } from './tutorial';
import { button } from './workspace';

const find = (page: Page) => page.getByRole('textbox', { name: 'Find “John 3”' }).locator('visible=true').first();

/** Map, type where it is, tap it: the passage's record. `say` is the first line, which says what the video shows. */
export function openOnMap(label: string, typed: string, say: string): Step[] {
  return [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Map' }).locator('visible=true').first(),
      say,
      tap: true,
      until: (page) => find(page).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'map_home',
      part: find,
      type: typed,
      stay: 0.8
    },
    {
      screen: 'map_home',
      part: (page) => page.getByText(label, { exact: true }).locator('visible=true').first(),
      tap: true,
      until: (page) => button(page, 'Versions and history').waitFor({ timeout: 30_000 }),
      stay: 0.8
    }
  ];
}
