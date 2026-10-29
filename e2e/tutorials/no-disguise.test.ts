import { readFileSync } from 'node:fs';
import { GROUPS } from './all';
import { DISGUISE } from '../../server/tutorialFeedback';

// The phone's disguise (decisions.md 171): a calculator or notepad in front of the app that a code opens. No
// tutorial video shows or explains it (Caleb, 2026-10-29): a public how-to teaches anyone to see through it.

type Catalog = { [key: string]: string | Catalog };
const en = JSON.parse(readFileSync('apps/mobile/src/i18n/en.json', 'utf8')) as Catalog;
const helpLine = (key: string) => key.split('.').reduce<string | Catalog | undefined>((at, k) => (typeof at === 'object' ? at[k] : undefined), en);

describe('the phone\'s disguise', () => {
  it('is in no video: not its title, its words, the help it follows, nor what it lights, taps or waits for', () => {
    for (const t of GROUPS.flatMap((g) => g.videos)) {
      const said = [t.id, t.title, ...t.steps.flatMap((s) => [s.screen, s.say ?? '', s.help ?? '', s.help ? JSON.stringify(helpLine(s.help) ?? '') : ''])];
      // A step's locators are code: their source names the catalog keys and words they find.
      const done = t.steps.flatMap((s) => [s.part, s.press, s.until, s.first, s.offCamera].map((f) => (f ? String(f) : '')));
      for (const text of [...said, ...done, t.before ? String(t.before) : '']) {
        expect(text, t.id).not.toMatch(DISGUISE);
        expect(text, t.id).not.toMatch(/\bdisguise\.|App icon/);
      }
    }
  });

  it('is not in the channel trailer', () => {
    expect(readFileSync('e2e/tutorials/trailer/words.json', 'utf8')).not.toMatch(DISGUISE);
  });

  it('never shows on the web app the videos are filmed on', () => {
    // A video that opens Me would film the row if the web drew it.
    expect(readFileSync('apps/mobile/src/disguise/DisguiseRow.web.tsx', 'utf8')).toMatch(/\{\s*return null;\s*\}/);
    expect(readFileSync('apps/mobile/src/disguise/DisguiseGate.web.tsx', 'utf8')).toMatch(/return <>\{props\.children\}<\/>;/);
  });
});
