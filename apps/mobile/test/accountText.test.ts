// The Inbox, welcome and invite words, as the demo says them (INBOX-1,
// ONB-1, ONB-2, AUTH-3).
import { describe, expect, it } from 'vitest';
import type { Update } from '@langquest-next/core';
import {
  firstName, groupByRead, joinRequestIdOf, teamLabel, updateText, VISION_STEPS, welcomeRoleFor,
  WELCOME_POINTS, withArticle
} from '../src/accountText';

const people: Record<string, string> = { sarah: 'Sarah Kim', ayen: 'Ayen Deng', me: 'You' };
const words = {
  name: (id: string) => people[id] ?? id,
  passage: 'John 3:1-21',
  language: 'Dinka',
  kindName: (id: string | undefined) => (id === 'community' ? 'Community Check' : id === 'bt' ? 'Back Translation' : 'review'),
  produces: (id: string) => id === 'bt',
  due: (d: string) => `due ${d}`
};
const base = { unitId: 'john3', hlc: '0' } as const;

describe('inbox words', () => {
  it('says who asked for what, where, and when it is due', () => {
    const u = { ...base, id: 'request:1', kind: 'request', by: 'sarah', request: { what: 'record', dueDate: 'Sep 1' } } as unknown as Update;
    expect(updateText(u, words)).toEqual({ icon: 'assign', title: 'Sarah asked you to record', body: 'John 3:1-21 (Dinka) — due Sep 1' });
    const r = { ...base, id: 'request:2', kind: 'request', by: 'sarah', request: { what: 'review', kindId: 'community' } } as unknown as Update;
    expect(updateText(r, words).title).toBe('Sarah asked you to do a Community Check');
  });

  it('words a review by its outcome, and a back translation as content', () => {
    const good = { ...base, id: 'review:1', kind: 'review', by: 'ayen', review: { kindId: 'community', outcome: 'looks_good' }, version: { n: 2 } } as unknown as Update;
    expect(updateText(good, words)).toMatchObject({ icon: 'check', title: 'Community Check: looks good', body: 'Ayen Deng approved John 3:1-21 (Version 2).' });
    const changes = { ...good, review: { kindId: 'community', outcome: 'needs_changes' } } as unknown as Update;
    expect(updateText(changes, words)).toMatchObject({ title: 'Feedback on John 3:1-21', body: 'Ayen Deng: Community Check suggests changes — revise, or keep it and say why.' });
    const bt = { ...good, review: { kindId: 'bt', outcome: 'recorded' } } as unknown as Update;
    expect(updateText(bt, words).title).toBe('Back Translation of John 3:1-21 is ready');
  });

  it('says what happened to your feedback and to what you asked for', () => {
    const revised = { ...base, id: 'answer:1', kind: 'revision', by: 'sarah', review: { kindId: 'community' } } as unknown as Update;
    expect(updateText(revised, words).title).toBe('Sarah revised John 3:1-21');
    const kept = { ...base, id: 'answer:2', kind: 'kept', by: 'sarah', review: { kindId: 'community', response: { note: 'The elders agreed.' } } } as unknown as Update;
    expect(updateText(kept, words)).toMatchObject({ title: 'Sarah kept John 3:1-21 as is', body: 'Reason: The elders agreed.' });
    const done = { ...base, id: 'done:1', kind: 'request_done', by: 'sarah', request: { what: 'record' } } as unknown as Update;
    expect(updateText(done, words)).toMatchObject({ icon: 'check', title: 'Sarah recorded John 3:1-21' });
  });

  it('groups unread first and keeps order within each group', () => {
    const items = [{ id: 'a', read: false }, { id: 'b', read: true }, { id: 'c', read: false }];
    expect(groupByRead(items, (i) => i.read)).toEqual({ unread: [items[0], items[2]], earlier: [items[1]] });
  });

  it('finds the join request inside a server notification id', () => {
    expect(joinRequestIdOf(JSON.stringify(['org1', 'join', 'admin', 'req-9']))).toEqual({ orgId: 'org1', requestId: 'req-9' });
    expect(joinRequestIdOf('plain-id')).toBeNull();
    expect(joinRequestIdOf(JSON.stringify(['org1', 'task', 'admin', 'x']))).toBeNull();
  });

  it('uses first names', () => {
    expect(firstName('Sarah Kim')).toBe('Sarah');
    expect(firstName('You')).toBe('You');
  });
});

describe('welcome', () => {
  const can = (ps: string[]) => (p: string) => ps.includes(p);
  it('picks the welcome by what someone may do', () => {
    expect(welcomeRoleFor({ isAdmin: true, can: can(['translate']) })).toBe('admin');
    expect(welcomeRoleFor({ isAdmin: false, can: can(['translate', 'review']) })).toBe('translator');
    expect(welcomeRoleFor({ isAdmin: false, can: can(['review']) })).toBe('reviewer');
    expect(welcomeRoleFor({ isAdmin: false, can: can([]) })).toBe('viewer');
  });

  it('gives two or three plain lines per role', () => {
    for (const points of Object.values(WELCOME_POINTS)) {
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(points.length).toBeLessThanOrEqual(3);
    }
  });

  it('names the team at the membership scope', () => {
    const names = { org: 'Wycliffe Associates', language: (id: string) => (id === 'L1' ? 'Dinka' : undefined) };
    expect(teamLabel({ level: 'language', languageId: 'L1' }, names)).toBe('the Dinka team at Wycliffe Associates');
    // A language this phone cannot name: the organization.
    expect(teamLabel({ level: 'language', languageId: 'L9' }, names)).toBe('Wycliffe Associates');
    expect(teamLabel({ level: 'org' }, names)).toBe('Wycliffe Associates');
    expect(teamLabel(undefined, names)).toBe('Wycliffe Associates');
  });

  it('uses the right article', () => {
    expect(withArticle('Translator')).toBe('a Translator');
    expect(withArticle('Organization Admin')).toBe('an Organization Admin');
  });

  it("has three short Vision cards (ONB-2), in the demo's words", () => {
    expect(VISION_STEPS.map((s) => s.title)).toEqual(['Scripture in every language', 'Every passage keeps a record', 'Do it, or ask someone']);
    for (const s of VISION_STEPS) expect(s.body.length).toBeLessThan(110);
  });
});

