import fs from 'node:fs';
import path from 'node:path';
import { foldOrg, libraryItemView, ORG_STREAM, subscriptionItemId, type AnyEvent, type LabelsDoc, type NamesDoc } from '@langquest-next/core';
import { itemLabel, itemName, labelsIn, sharedLabel, sharedName } from '../src/library/labelsModel';
import { copyOps, subscribeOps, type LibraryOp, type SharedItem } from '../src/library/model';
import { choiceName, libraryChoices } from '../src/templates/contentTemplatesModel';
import { shortName } from '../src/breakup/numberingGuide';
import { nameSets } from '../src/templates/bookNamesModel';

const H = (c: string) => c.repeat(64);
let seq = 0;
const fold = (ops: LibraryOp[]) => foldOrg(ops.map((op) => ({ ...op, id: `e${++seq}`, orgId: 'o', streamId: ORG_STREAM, actorId: 'a', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent)).library;

const hindi: LabelsDoc = {
  format: 'labels@1', name: 'Library names (Hindi)', description: '', language: 'hin',
  items: [
    { itemId: 'langquest.bible.chapters', name: 'अध्याय के अनुसार' },
    { itemId: 'langquest.flow.quick_check', name: 'त्वरित जाँच', description: 'एक साथी सुनता है।' },
    { itemId: 'langquest.names.npi', name: 'बाइबल की पुस्तकों के नाम (नेपाली)' }
  ],
  deps: []
};
const nepali: LabelsDoc = { ...hindi, name: 'Library names (Nepali)', language: 'npi', items: [{ itemId: 'langquest.bible.chapters', name: 'अध्यायअनुसार' }] };
const share = (item: string, name: string, org = 'langquest'): SharedItem => ({
  org_id: org, org_name: org === 'langquest' ? 'LangQuest' : 'Other', item_id: item, kind: 'template', name, description: '', subscribable: true,
  version_count: 1, latest_hash: H('c'), updated_hlc: ''
});
const chapters = share('langquest.bible.chapters', 'By chapter');

describe("other organizations' items in the language showing (decision 194)", () => {
  const labels = labelsIn([{ orgId: 'langquest', doc: hindi }, { orgId: 'langquest', doc: nepali }], 'hin');

  it('reads the sets in that language, each naming only its own organization\'s items', () => {
    expect(labels.get('langquest/langquest.bible.chapters')).toEqual({ name: 'अध्याय के अनुसार' });
    expect(labels.get('langquest/langquest.flow.quick_check')).toEqual({ name: 'त्वरित जाँच', description: 'एक साथी सुनता है।' });
    // Another organization's set names its own items: it cannot rename LangQuest's.
    const both = labelsIn([{ orgId: 'other', doc: { ...hindi, items: [{ itemId: 'langquest.bible.chapters', name: 'Mine' }] } }, { orgId: 'langquest', doc: hindi }], 'hin');
    expect(sharedName(both, chapters)).toBe('अध्याय के अनुसार');
    expect(sharedName(both, share('langquest.bible.chapters', 'Chapters', 'other'))).toBe('Mine');
    // The same language by another code; nothing in a language with no set; only sets are read.
    expect(sharedLabel(labelsIn([{ orgId: 'langquest', doc: nepali }], 'nep'), chapters)?.name).toBe('अध्यायअनुसार');
    expect(labelsIn([{ orgId: 'langquest', doc: hindi }], 'spa').size).toBe(0);
    const names: NamesDoc = { format: 'names@1', name: 'x', description: '', language: 'hin', books: [], deps: [] };
    expect(labelsIn([{ orgId: 'langquest', doc: names }, { orgId: 'langquest', doc: null }], 'hin').size).toBe(0);
  });

  it('names what is shared and what is followed, and leaves what an organization made or copied as it is', () => {
    expect(sharedName(labels, chapters)).toBe('अध्याय के अनुसार');
    expect(sharedName(labels, share('langquest.bible.fia', 'FIA passages'))).toBe('FIA passages');
    const followed = fold(subscribeOps(chapters, true).ops);
    const item = libraryItemView(followed, subscriptionItemId('langquest', 'langquest.bible.chapters'))!;
    expect(itemLabel(labels, item)?.name).toBe('अध्याय के अनुसार');
    expect(itemName(labels, item)).toBe('अध्याय के अनुसार');
    const copied = libraryItemView(fold(copyOps(chapters, 'by-chapter')), 'by-chapter')!;
    expect(copied.source).toBe('copy');
    expect(itemName(labels, copied)).toBe('By chapter');
  });

  it('keeps the published name for events and matching, and shows the label', () => {
    const [c] = libraryChoices({}, [], [chapters], undefined, labels);
    expect(c!.name).toBe('By chapter');
    expect(choiceName(c!)).toBe('अध्याय के अनुसार');
    expect(choiceName(libraryChoices({}, [], [chapters])[0]!)).toBe('By chapter');
  });

  it('names the sets of book names too', () => {
    const npi: NamesDoc = { format: 'names@1', name: 'Bible book names (Nepali)', description: '', language: 'npi', books: [{ book: 'LUK', name: 'लूका' }], deps: [] };
    const [set] = nameSets([], [{ s: { ...share('langquest.names.npi', 'Bible book names (Nepali)'), kind: 'names' }, doc: npi }], labels);
    expect(set!.name).toBe('बाइबल की पुस्तकों के नाम (नेपाली)');
  });

  it('shortens a numbering\'s name in every language LangQuest names it in', () => {
    expect(shortName('Russian Synodal · 77 books (Orthodox)')).toBe('Russian Synodal (Orthodox)');
    expect(shortName('Like most English Bibles · 66 books')).toBe('Like most English Bibles');
    expect(shortName('Kama Vulgata ya Kilatini · vitabu 73 (Katoliki)')).toBe('Kama Vulgata ya Kilatini (Katoliki)');
    expect(shortName('与拉丁文武加大译本相同 · 73 卷（天主教）')).toBe('与拉丁文武加大译本相同（天主教）');
    expect(shortName('রুশ সিনোডাল · ৭৭টি বই (অর্থোডক্স)')).toBe('রুশ সিনোডাল (অর্থোডক্স)');
    const numberings = ['Like most English Bibles · 66 books', 'Like the Hebrew and Greek · 66 books', 'Like the Latin Vulgate · 73 books (Catholic)',
      'Russian Synodal · 66 books', 'Russian Synodal · 77 books (Orthodox)'];
    const dir = path.resolve(__dirname, '../../../library/labels');
    for (const f of fs.readdirSync(dir)) {
      const { names } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { names: Record<string, string> };
      const short = numberings.map((n) => shortName(names[n]!));
      // Each loses its count of books, and no two read alike.
      numberings.forEach((n, i) => expect(short[i], `${f} ${n}`).not.toBe(names[n]));
      expect(new Set(short).size, f).toBe(numberings.length);
    }
  });
});
