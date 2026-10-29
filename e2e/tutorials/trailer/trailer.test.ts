import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UI_LANGUAGES } from '@langquest-next/core';
import { filmProblem } from '../../../server/tutorialIntakeModel';
import { TRAILER } from '../../../server/youtube';
import { PLAYLISTS } from '../playlists';
import { TRAILER_WORDS, trailerLook, trailerText, type TrailerWords } from './trailer';

const KEYS = Object.keys(TRAILER_WORDS['en']!) as (keyof TrailerWords)[];
// The values each line fills in, which a translation must keep.
const VALUES: Partial<Record<keyof TrailerWords, string[]>> = {
  clips: ['{year}'], asOf: ['{date}'], noSignal: ['{n}'], backInRange: ['{n}'], square: ['{one}', '{n}']
};

describe('the trailer in every app language', () => {
  it.each(UI_LANGUAGES.map((l) => l.code))('%s has every line, its values and its accents', (code) => {
    const words = TRAILER_WORDS[code];
    expect(words, `words.json has no ${code}`).toBeDefined();
    expect(Object.keys(words!).sort()).toEqual([...KEYS].sort());
    expect(words!.rail).toHaveLength(6);
    for (const key of KEYS) {
      const line = words![key];
      for (const one of Array.isArray(line) ? line : [line]) {
        expect(one.trim(), `${code}.${key}`).not.toBe('');
        expect(one.split('*').length % 2, `${code}.${key} opens an accent it does not close`).toBe(1);
      }
      for (const value of VALUES[key] ?? []) expect(line, `${code}.${key}`).toContain(value);
    }
  });

  it.each(UI_LANGUAGES.map((l) => l.code))('%s goes on YouTube as the intake job takes it', (code) => {
    const text = trailerText(code);
    expect(text.title).toMatch(/^LangQuest Next · /);
    expect(text.title).not.toContain('*');
    expect(text.description).not.toContain('*');
    // Its links to itself in the other languages and to its download.
    expect(text.description).toContain(`/v/${code}/${TRAILER}.mp4`);
    const film = { tutorial: TRAILER, sha256: 'a'.repeat(64), bytes: 1, seconds: 48, ...text, playlist: PLAYLISTS[code]!.everyone, position: 0, look: 'b'.repeat(64) };
    expect(filmProblem(film)).toBeNull();
  });
});

describe('the trailer look', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trailer-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const capture = (name: string, steps: Record<string, string>) => {
    const at = path.join(dir, name);
    mkdirSync(path.join(at, 'steps'), { recursive: true });
    for (const [file, words] of Object.entries(steps)) writeFileSync(path.join(at, 'steps', file), words);
    return at;
  };

  it('is the same for screens that say the same at another time, and not for other words or another language', () => {
    const a = capture('a', { '01-listen.txt': '- text: Recording Version 1, 2 min ago\n- button "Play"', '02-kept.txt': '- text: Oct 28, 15:20' });
    const later = capture('later', { '01-listen.txt': '- text: Recording Version 1, 5 min ago\n- button "Play"', '02-kept.txt': '- text: Oct 29, 09:02' });
    const other = capture('other', { '01-listen.txt': '- text: Recording Version 2\n- button "Play"', '02-kept.txt': '- text: Oct 28, 15:20' });
    const look = trailerLook('en', a);
    expect(look).toMatch(/^[0-9a-f]{64}$/);
    expect(trailerLook('en', later)).toBe(look);
    expect(trailerLook('en', other)).not.toBe(look);
    expect(trailerLook('fr', a)).not.toBe(look);
    // Hashes like the manifest's.
    expect(look).not.toBe(createHash('sha256').update('').digest('hex'));
  });
});
