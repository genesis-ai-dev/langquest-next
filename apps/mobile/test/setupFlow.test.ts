import type { ContentTemplate } from '@langquest-next/core';
import { templateSubtree } from '../src/setupFlow';

const template: ContentTemplate = {
  id: 'nested',
  name: 'Nested',
  description: '',
  unitKinds: [],
  items: [
    { itemId: 'a', parentItemId: null, kind: 'book', label: 'A', order: 'a' },
    { itemId: 'a-1', parentItemId: 'a', kind: 'chapter', label: 'A 1', order: 'a1' },
    { itemId: 'a-1-1', parentItemId: 'a-1', kind: 'section', label: 'A 1.1', order: 'a11' },
    { itemId: 'a-1-1-1', parentItemId: 'a-1-1', kind: 'passage', label: 'A 1.1.1', order: 'a111' },
    { itemId: 'b', parentItemId: null, kind: 'book', label: 'B', order: 'b' },
    { itemId: 'b-1', parentItemId: 'b', kind: 'chapter', label: 'B 1', order: 'b1' }
  ]
};

describe('templateSubtree', () => {
  it('includes every descendant at every depth and excludes sibling roots', () => {
    expect([...templateSubtree(template, 'a')]).toEqual(['a', 'a-1', 'a-1-1', 'a-1-1-1']);
    expect(templateSubtree(template, 'b')).toEqual(new Set(['b', 'b-1']));
  });

  it('returns only the requested invalid root', () => {
    expect(templateSubtree(template, 'missing')).toEqual(new Set());
  });
});
