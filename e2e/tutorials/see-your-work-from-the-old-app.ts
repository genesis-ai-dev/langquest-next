// "See your work from the old app", for everyone who had a project in the
// original LangQuest (v2): Grace signs in for the first time with her old
// account and lands on Welcome back, which says where her project went, what
// she recorded, what is different, and Keep going opens her next passage
// (docs/v2-import.md sections 3 and 7). Test data only: the world's made-up
// people, and a made-up answer to the app's one question about v2
// (`v2_welcome`), so the film never reads the real v2 or any real person's work.
import type { Page } from 'playwright';
import type { Tutorial } from './tutorial';
import { recordAPassage } from './record-a-passage';
import { button, id, shows } from './workspace';
import { serviceClient } from '../ui/people-helpers';

const words = (page: Page, s: string | RegExp) => page.getByText(s).locator('visible=true').first();

export const seeYourWorkFromTheOldApp: Tutorial = {
  id: 'see-your-work-from-the-old-app',
  title: 'See your work from the old app',
  as: 'TRANS',
  welcomed: false,
  names: recordAPassage.names,
  // The account is one that came from v2, as the `v2-sign-in` function makes it (its metadata says so).
  prepare: async (world) => {
    const account = world.accounts.TRANS;
    const user = { ...(account.session.user.user_metadata ?? {}), from_v2: true };
    const { error } = await serviceClient().auth.admin.updateUserById(account.id, { user_metadata: user });
    if (error) throw new Error(`marking ${account.email} as from v2: ${error.message}`);
    account.session.user.user_metadata = user;
  },
  // The answer the server would give for a real v2 project, made up from this world, then the app opens again to hear it.
  before: async (page, _mic, world) => {
    const language = world.languages.A;
    await page.route('**/rest/v1/rpc/v2_welcome*', (route) => route.fulfill({
      json: {
        here: [{
          languageId: language.languageId, orgId: language.orgId, orgName: world.orgName, name: language.name, was: 'Lumari Stories',
          recordings: 9, passages: 4, lastUnitId: world.passages['P-Q4'].unitId, lastAt: '0000001767225600000-00000-test'
        }],
        onTheirWay: []
      }
    }));
    await page.reload();
    await words(page, /^Welcome back/).waitFor({ timeout: 60_000 });
    await words(page, 'Lumari').waitFor({ timeout: 30_000 });
  },
  steps: [
    {
      screen: 'welcome_back',
      part: (page) => words(page, /^Welcome back/),
      say: "Here's what you see after your work comes across from the original LangQuest. The first time you sign in with your old account, you land on Welcome back."
    },
    {
      screen: 'welcome_back',
      // The language's name, where it came from and what Grace recorded in it, as one card.
      part: (page) => [words(page, 'Lumari'), words(page, /was your project/), words(page, /recordings/)],
      say: 'Your old project is now a language. This card says which team it is in, what the project was called, and how much you recorded.'
    },
    {
      screen: 'welcome_back',
      part: (page) => words(page, /Record here from now on/).locator('..'),
      say: "Record here from now on. Recordings you make in the old app still come here, but what you record here doesn't go back."
    },
    {
      screen: 'welcome_back',
      part: (page) => words(page, "What's different"),
      say: 'To see how the old words match the new ones, tap What is different.',
      tap: true,
      until: (page) => words(page, /is now a/).waitFor({ timeout: 10_000 }),
      stay: 0.6
    },
    {
      screen: 'welcome_back',
      part: (page) => [words(page, /is now a/), words(page, /Your quests are/), words(page, /one version/), words(page, /Votes are/)],
      say: 'A project is a language. Quests are books, chapters and passages. What you recorded for a chapter is a version. And votes are Community Checks.',
      stay: 1
    },
    {
      screen: 'welcome_back',
      part: (page) => button(page, /^Keep going on /),
      say: 'Tap Keep going to carry on with your next passage. Or tap Go to My Work.',
      tap: true,
      until: (page) => shows(page, 'path-step-record'),
      stay: 0.8
    },
    {
      screen: 'passage_record',
      part: (page) => id(page, 'path-step-record'),
      say: 'This is your next passage. Record it as in the video Record a passage.',
      stay: 2
    }
  ]
};
