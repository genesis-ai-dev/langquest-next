// "See reports on the web", for organization heads and partners: the Reports
// section in a computer's browser. Samuel reads the Overview, finds which
// languages went quiet, opens Lumari's own report, and ends on the field
// report that can be copied or printed for partners.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button } from './workspace';
import { projectionPass } from '../ui/pass-helpers';

const words = (page: Page, s: string | RegExp) => page.getByText(s, { exact: true }).locator('visible=true').first();
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();

export const reportsOnTheWeb: Tutorial = {
  id: 'reports-on-the-web',
  title: 'See reports on the web',
  as: 'ADMIN',
  names: recordAPassage.names,
  viewport: { width: 1280, height: 800 },
  // Reports shows what the server's last pass worked out: one now that the world is whole.
  prepare: () => projectionPass(),
  steps: [
    {
      screen: 'my_work',
      part: (page) => page.getByRole('tab', { name: 'Reports' }).locator('visible=true').first(),
      say: "Here's how to see reports on your organization's work. Open LangQuest in a web browser on a computer, and choose Reports.",
      tap: true,
      until: (page) => words(page, 'Recordings on the server').waitFor({ timeout: 60_000 }),
      stay: 0.8
    },
    {
      screen: 'reports_home',
      part: (page) => [words(page, 'Recordings on the server'), words(page, /^1 of \d+$/)],
      say: 'The overview shows how many recordings reached the server, and how much is recorded and done.'
    },
    {
      screen: 'reports_home',
      part: (page) => [heading(page, 'Needs attention'), words(page, 'At a checkpoint')],
      say: 'Needs attention shows what a coordinator can move today.'
    },
    {
      screen: 'reports_home',
      part: (page) => button(page, 'Languages'),
      say: 'Languages shows when each language last sent recordings, so you know who to check in with.',
      tap: true,
      until: (page) => heading(page, 'All languages').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'reports_home',
      part: (page) => words(page, 'Lumari'),
      say: 'Tap a language for its own report.',
      tap: true,
      until: (page) => heading(page, 'Review flow').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'reports_language',
      part: (page) => [heading(page, 'Review flow'), page.getByRole('progressbar', { name: /^Final Approval: / }).locator('visible=true').first()],
      say: 'It shows where passages wait in the review flow,'
    },
    {
      screen: 'reports_language',
      part: (page) => [heading(page, 'Books'), words(page, 'Luke')],
      say: 'and how far each book has come.'
    },
    {
      screen: 'reports_language',
      part: (page) => [button(page, 'Download the books as CSV'), button(page, 'Print or save as PDF')],
      say: 'To share it, download it as a spreadsheet, or print it.'
    },
    {
      screen: 'reports_language',
      part: (page) => button(page, 'Back'),
      tap: true,
      until: (page) => button(page, 'Field report').waitFor({ timeout: 30_000 }),
      stay: 0.4
    },
    {
      screen: 'reports_home',
      part: (page) => button(page, 'Field report'),
      say: 'The field report says what happened this week, this month or this year, for partners and supporters.',
      tap: true,
      until: (page) => heading(page, 'By the numbers').waitFor({ timeout: 30_000 }),
      stay: 0.8
    },
    {
      screen: 'reports_home',
      part: (page) => [button(page, 'Weekly'), button(page, 'Year to date')],
      say: 'Choose the time.'
    },
    {
      screen: 'reports_home',
      part: (page) => [button(page, 'Copy as text'), button(page, 'Print or save as PDF')],
      say: 'Then copy it into an email, or print it.',
      stay: 1.5
    }
  ]
};
