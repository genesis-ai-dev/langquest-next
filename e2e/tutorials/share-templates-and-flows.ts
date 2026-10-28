// "Share templates and review flows", for admins: Lumari's review flow is
// its own. Samuel keeps it in the organization's library, shares it with
// other organizations, and follows a flow another organization shares.
// Content templates are shared the same way, from their own library.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';

const FLOW = 'Riverside flow';
const shared = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).locator('visible=true').nth(2);
const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();

export const shareTemplatesAndFlows: Tutorial = {
  id: 'share-templates-and-flows',
  title: 'Share templates and review flows',
  as: 'ADMIN',
  names: recordAPassage.names,
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Manage' }).locator('visible=true').first(),
      say: "Here's how to share a review flow with other organizations, and use one they share. Tap Manage.",
      tap: true,
      until: (page) => button(page, /^Lumari /).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'org_home',
      part: (page) => button(page, /^Lumari /),
      tap: true,
      until: (page) => button(page, /^Review flow/).waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'language_home',
      part: (page) => button(page, /^Review flow/),
      say: 'Open the language, then Review flow.',
      tap: true,
      until: (page) => button(page, 'All review flows').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'flows_home',
      part: (page) => button(page, 'All review flows'),
      say: 'Tap All review flows.',
      tap: true,
      until: (page) => button(page, 'Add to your flows').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'flows_home',
      part: (page) => button(page, 'Add to your flows'),
      say: "Lumari's flow is its own. To share it, first add it to your organization's flows.",
      tap: true,
      until: (page) => page.getByRole('textbox', { name: 'Name' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByRole('textbox', { name: 'Name' }).locator('visible=true').first(),
      say: 'Give it a name.',
      type: FLOW,
      replace: true,
      stay: 0.5
    },
    {
      screen: 'flow_editor',
      part: (page) => button(page, 'Done'),
      tap: true,
      until: (page) => words(page, FLOW).waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'flows_home',
      part: (page) => button(page, `Open ${FLOW}`),
      say: 'It is in your organization now. Open it.',
      tap: true,
      until: (page) => page.getByRole('switch', { name: 'Share with other organizations' }).locator('visible=true').first().waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByRole('switch', { name: 'Share with other organizations' }).locator('visible=true').first(),
      say: 'Turn on Share with other organizations. They can see it and copy it.',
      tap: true,
      stay: 1
    },
    {
      screen: 'flow_editor',
      part: (page) => page.getByRole('switch', { name: /^Let them follow updates/ }).locator('visible=true').first(),
      say: 'Let them follow it too, and they get each new version you make.',
      tap: true,
      stay: 1
    },
    {
      screen: 'flow_editor',
      part: (page) => button(page, 'Done'),
      tap: true,
      until: (page) => words(page, 'Oral Review Path').waitFor({ timeout: 30_000 }),
      stay: 0.6
    },
    {
      screen: 'flows_home',
      part: (page) => words(page, 'Oral Review Path'),
      say: 'Below are the flows other organizations share.'
    },
    {
      screen: 'flows_home',
      // Oral Review Path is the third flow shared with them.
      part: (page) => [shared(page, 'Follow'), shared(page, 'Copy')],
      say: 'Follow one to get its updates, or copy it to change it as your own. Content templates are shared the same way.',
      stay: 2
    }
  ]
};
