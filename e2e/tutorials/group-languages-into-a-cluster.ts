// "Group languages into a cluster", for admins: Lumari and Kitara are spoken
// in the same hills. Samuel puts Lumari in a new cluster, the Kalu Hills, then
// Kitara in it too, and the organization's page shows them together.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const CLUSTER = 'Kalu Hills';
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const chip = (page: Page) => button(page, 'Cluster');
const sheet = (page: Page) => page.getByRole('dialog').locator('visible=true').last();
const manage = (page: Page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first();

export const groupLanguagesIntoACluster: Tutorial = {
  id: 'group-languages-into-a-cluster',
  title: 'Group languages into a cluster',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: manage,
      say: "Here's how to group languages that belong together, like languages of one area. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      say: 'Open a language.',
      tap: true,
      until: (page) => chip(page).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'language_home',
      part: chip,
      say: 'Tap Cluster.',
      tap: true,
      until: (page) => words(page, 'Which cluster is it in?').waitFor({ timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'language_home',
      part: (page) => page.getByRole('textbox', { name: 'Put it in a new cluster' }).locator('visible=true').first(),
      say: 'Give the new cluster a name.',
      type: CLUSTER,
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => sheet(page).getByRole('button', { name: 'Done', exact: true }),
      say: 'Tap Done.',
      tap: true,
      until: (page) => words(page, 'Which cluster is it in?').waitFor({ state: 'hidden', timeout: 10_000 }),
      stay: 1
    },
    {
      screen: 'language_home',
      part: (page) => page.getByRole('button', { name: new RegExp(CLUSTER) }).locator('visible=true').first(),
      say: `Lumari is in the ${CLUSTER} now.`
    },
    {
      screen: 'language_home',
      part: (page) => button(page, 'Back'),
      say: 'Now put another language in it.',
      tap: true,
      until: (page) => button(page, /^Kitara /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Kitara /),
      tap: true,
      until: (page) => chip(page).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: chip,
      tap: true,
      until: (page) => words(page, 'Which cluster is it in?').waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => sheet(page).getByText(CLUSTER, { exact: true }),
      say: `This time, pick the ${CLUSTER}, and tap Done.`,
      tap: true,
      stay: 0.5
    },
    {
      screen: 'language_home',
      part: (page) => sheet(page).getByRole('button', { name: 'Done', exact: true }),
      tap: true,
      until: (page) => words(page, 'Which cluster is it in?').waitFor({ state: 'hidden', timeout: 10_000 }),
      stay: 0.8
    },
    {
      screen: 'language_home',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => page.getByRole('button', { name: new RegExp(`^${CLUSTER}\\. 2 languages`) }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => page.getByRole('button', { name: new RegExp(`^${CLUSTER}\\. 2 languages`) }).locator('visible=true').first(),
      say: 'On your organization\'s page, the two are together under the cluster\'s name. Each keeps its own people and work.',
      stay: 2
    }
  ]
};
