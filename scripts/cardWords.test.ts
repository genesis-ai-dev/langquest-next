import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardWordProblems, CLAUDE_WHY, fileProblems, fixNote, fixNoteParts, WHY_STOPPED, whyOfNote } from './card-words.mjs';
import { wordProblems } from './tutorial-review.mjs';

// The one word standard for every ops dashboard card (docs/card-words.md). The card that started it, word for word
// (2026-11-24): a reason that named two files, used the passive voice, and ran to 79 words.
const CALEBS_CARD = "The request is for a bolder light, with a white border, round the button the voice names. The light is drawn by the filming code in e2e/tutorials/film.ts, for every video, and the video's own file (e2e/tutorials/edit-a-finished-version.ts) and its lines cannot change it. The last Spanish film was filmed with no problem found by the frame check. A person must decide whether to change how the light looks in all videos, or to make the frame check read it differently.";

describe('the checker of a card\'s words', () => {
  it('rejects the card that started the standard, and says what to do instead', () => {
    const p = cardWordProblems(CALEBS_CARD);
    expect(p.some((x) => x.startsWith('Names a file ("e2e/tutorials/film.ts")'))).toBe(true);
    expect(p.some((x) => x.startsWith('Uses the passive voice ("is drawn by")'))).toBe(true);
    expect(p.some((x) => /^Has 79 words/.test(x))).toBe(true);
  });

  it('rejects code words, jargon, ids, minute-only times, long sentences and a start with "It"', () => {
    expect(cardWordProblems('Claude starts at its next fix run (:20 and :50 each hour).')[0]).toMatch(/minutes only/);
    expect(cardWordProblems('The table snapshot_units_staged fills.')[0]).toMatch(/code word \("snapshot_units_staged"\)/);
    expect(cardWordProblems('The app reads userIssues first.')[0]).toMatch(/code word/);
    expect(cardWordProblems('Give Claude the OIDC token.').some((x) => /"oidc"/.test(x))).toBe(true);
    expect(cardWordProblems('Commit 9f3c2a1b broke the build.')[0]).toMatch(/id or a commit/);
    expect(cardWordProblems('It fails each night.')[0]).toMatch(/Starts with "It"/);
    expect(cardWordProblems(Array(30).fill('word').join(' ') + '.')[0]).toMatch(/Sentence 1 has 30 words/);
  });

  it('lets plain words through, and the names of products', () => {
    expect(cardWordProblems('The Spanish video shows the old Save button. Viewers on iPhone and YouTube see it.')).toEqual([]);
    expect(cardWordProblems('')).toEqual([]);
  });

  it('keeps its own fixed words: each reason Claude stopped passes', () => {
    for (const [k, w] of Object.entries(WHY_STOPPED)) {
      expect([...cardWordProblems(w.label, { max: 8 }), ...cardWordProblems(w.says), ...cardWordProblems(w.youCan)], k).toEqual([]);
      expect(['tell', 'retry', 'app']).toContain(w.act);
    }
    for (const k of CLAUDE_WHY) expect(WHY_STOPPED).toHaveProperty(k);
  });
});

describe('why Claude stopped, kept in a fix\'s note', () => {
  it('keeps the reason, Claude\'s plain words and the technical part in one note, and reads them back', () => {
    const note = fixNote('needsChoice', 'Choose: 1. Change all videos. 2. Keep it.', 'film.ts draws the light.');
    expect(fixNoteParts(note)).toEqual({ why: 'needsChoice', plain: 'Choose: 1. Change all videos. 2. Keep it.', technical: 'film.ts draws the light.' });
    expect(fixNote('nonsense', '', 'x')).toMatch(/^why=unknown\n/);
    expect(fixNote('broke', '', 'y'.repeat(2000)).length).toBeLessThanOrEqual(1000);
  });

  it('reads the reason of a note written before the reason was kept', () => {
    expect(fixNoteParts(CALEBS_CARD)).toEqual({ why: 'needsChoice', plain: '', technical: CALEBS_CARD });
    expect(whyOfNote('Its checks failed (gate: failure), so the pull request is closed.')).toBe('checksFailed');
    expect(whyOfNote('It did not merge within 24 hours, so the pull request is closed.')).toBe('tooSlow');
    expect(whyOfNote('The second check stopped it: it reads a file.')).toBe('safety');
    expect(whyOfNote('GitHub did not let the App open the pull request (403).')).toBe('noAccess');
    expect(whyOfNote('Claude wrote no fix.json.')).toBe('broke');
    expect(whyOfNote('The cause is in the app.', true)).toBe('needsApp');
    expect(whyOfNote('the script would not run')).toBe('unknown');
  });
});

describe('the checks that make Claude mend its words', () => {
  it('lists the card fields of a JSON file that break the standard, and the command line exits 1 on them', () => {
    const value = { file: [{ title: 'Audio will not play', problem: 'It fails in snapshot_units_staged.', cause: 'apps/mobile/src/x.ts line 4' }] };
    expect(fileProblems(value)).toEqual([
      'file[0].problem: Has a code word ("snapshot_units_staged"). Name the thing by what it does.',
      'file[0].problem: Starts with "It". Start with the name of the thing, so a person who reads only this line knows what it is about.'
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'card-words-'));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(value));
    writeFileSync(join(dir, 'good.json'), JSON.stringify({ file: [{ problem: 'Reference audio does not play in the web app.' }] }));
    const run = (f: string) => { try { execFileSync(process.execPath, ['scripts/card-words.mjs', join(dir, f)], { stdio: 'pipe' }); return 0; } catch (e) { return (e as { status: number }).status; } };
    expect(run('bad.json')).toBe(1);
    expect(run('good.json')).toBe(0);
  });

  it('lists a tutorial suggestion\'s words that break the standard, but not its part for the fix', () => {
    const review = { suggestions: [{ title: 'Say Done, not Save, in step 9', detail: 'Step 9 says Save. The button says Done.\nFor the fix: e2e/tutorials/record-a-passage.ts step 9 `say`.' },
      { title: 'Fix status-fr.json', detail: 'It is drawn by film.ts.' }] };
    const p = wordProblems(review);
    expect(p.every((x) => x.startsWith('suggestions[1]'))).toBe(true);
    expect(p.some((x) => /title: Names a file \("status-fr\.json"\)/.test(x))).toBe(true);
  });
});
