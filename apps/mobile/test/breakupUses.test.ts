// Which languages use which way of breaking up the Bible, and the numbering note (src/breakup/model.ts, decisions.md 74 and 80).
import { describe, expect, it } from 'vitest';
import type { TemplateDoc, VersificationDoc } from '@langquest-next/core';
import { clashShown, knownUses, otherUses, templateInNumbering, usedInByNumbering } from '../src/breakup/model';

const doc = { format: 'template@2' } as unknown as TemplateDoc;
const v = (code: string) => ({ code }) as unknown as VersificationDoc;
const names: Record<string, string> = { L1: 'Bari', L2: 'Dinka', L3: 'Nuer' };
const nameOf = (id: string) => names[id] ?? id;

describe('who uses which way', () => {
  it('trusts the server\'s list, and offline falls back on the open language\'s own template', () => {
    const users = [{ language_id: 'L2', item_id: 'a' }];
    expect(knownUses(users, 'L1', 'x')).toBe(users);
    expect(knownUses(null, 'L1', 'x')).toEqual([{ language_id: 'L1', item_id: 'x' }]);
    expect(knownUses(null, 'L1', undefined)).toEqual([]);
    expect(knownUses(null, null, 'x')).toEqual([]);
    expect(knownUses([], 'L1', 'x')).toEqual([]);
  });

  it('names the other languages\' ways, never the one being set up', () => {
    const known = [{ language_id: 'L1', item_id: 'a' }, { language_id: 'L2', item_id: 'b' }];
    expect(otherUses(known, 'L1', nameOf)).toEqual([{ languageId: 'L2', name: 'Dinka', itemId: 'b' }]);
    expect(otherUses(known, null, nameOf)).toHaveLength(2);
  });

  it('groups the other languages by the numbering their template uses', () => {
    const known = [{ language_id: 'L1', item_id: 'a' }, { language_id: 'L2', item_id: 'b' }, { language_id: 'L3', item_id: 'b' }, { language_id: 'L4', item_id: 'z' }];
    const codes: Record<string, string> = { a: 'eng', b: 'org' };
    expect(usedInByNumbering(known, 'L1', (id) => codes[id], nameOf)).toEqual({ org: ['Dinka', 'Nuer'] });
    expect(usedInByNumbering(known, null, (id) => codes[id], nameOf)).toEqual({ eng: ['Bari'], org: ['Dinka', 'Nuer'] });
  });
});

describe('a way in the numbering asked for', () => {
  it('is any way when no numbering is asked, else only one whose versification has that code', () => {
    expect(templateInNumbering(doc, null, null)).toBe(doc);
    expect(templateInNumbering(null, v('eng'), 'eng')).toBeNull();
    expect(templateInNumbering(doc, v('eng'), 'eng')).toBe(doc);
    expect(templateInNumbering(doc, v('org'), 'eng')).toBeNull();
    expect(templateInNumbering(doc, null, 'eng')).toBeNull();
  });
});

describe('the verse numbering note', () => {
  it('is shown until put away for exactly this set of Bibles, and comes back when the Bibles change', () => {
    const clash = { verse: 'x' };
    expect(clashShown(clash, 'eng,org', null)).toBe(clash);
    expect(clashShown(clash, 'eng,org', 'eng,org')).toBeNull();
    expect(clashShown(clash, 'eng,org,rus', 'eng,org')).toBe(clash);
    expect(clashShown(null, 'eng', null)).toBeNull();
  });
});
