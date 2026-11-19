import { describe, expect, it } from 'vitest';
import { ACTIONS, checkReport, DECISIONS, itemDescription, LIMITS, TITLE_PREFIX } from './agent-research.mjs';
import { DIAGRAM, FIX_MAX, researchToTake, stepsOf } from './user-issues.mjs';
import { DIAGRAM as SERVER_DIAGRAM, parseLooked, RESEARCH_ACTIONS, RESEARCH_DECISIONS, RESEARCH_TEXT } from '../server/userIssues';

/** The research team (docs/agent-team.md "The research team"): the lead's report is a claim the script checks. */
const context = { issues: [{ issue: 'LAN-12' }], items: [{ tag: 'known-item', issue: 'LAN-40', decision: 'recommend' }] };
const files = new Set(['apps/mobile/src/screens/invite.tsx', 'packages/core/src/portfolio.ts']);
const isFile = (f: string) => files.has(f);
const item = (over: Record<string, unknown> = {}) => ({
  tag: 'fixed-width-label', title: 'Words are cut off on the invite button', like: 'LAN-12', found: 'The label has a fixed width.', why: 'A long word shows as half a word.',
  places: ['apps/mobile/src/screens/invite.tsx:142'], decision: 'recommend', action: 'fix', ...over
});

describe('the research report', () => {
  it('keeps an item with a place that is a file of main', () => {
    const out = checkReport({ items: [item()] }, context, isFile);
    expect(out.dropped).toEqual([]);
    expect(out.items).toEqual([{ ...item(), steps: null, issue: null }]);
    // The mistake as a diagram: kept when it has a step that goes wrong.
    const steps = [{ where: 'Person', text: 'Opens the invite screen.' }, { where: 'Phone', text: 'Draws the button 96 wide.', wrong: true }];
    expect(checkReport({ items: [item({ steps })] }, context, isFile).items[0]?.steps).toEqual([{ where: 'Person', text: 'Opens the invite screen.', wrong: false }, { where: 'Phone', text: 'Draws the button 96 wide.', wrong: true }]);
  });

  it('keeps a recommended item with no real place only as watch', () => {
    const out = checkReport({ items: [item({ places: ['apps/mobile/src/none.tsx:1', '../.env.keys', 'a b'] })] }, context, isFile);
    expect(out.items[0]).toMatchObject({ decision: 'watch', action: 'none', places: [] });
    expect(out.dropped).toHaveLength(1);
  });

  it('gives only a recommended item an action, and asks a developer when it names none', () => {
    const out = checkReport({ items: [item({ tag: 'aaa', decision: 'watch' }), item({ tag: 'bbb', decision: 'reject', action: 'ask' }), item({ tag: 'ccc', action: 'merge' }), item({ tag: 'ddd', action: 'none' })] }, context, isFile);
    expect(out.items.map((i) => i.action)).toEqual(['none', 'none', 'ask', 'ask']);
  });

  it('drops what is not an item, a tag used twice and what is over the limit', () => {
    const many = Array.from({ length: LIMITS.items + 2 }, (_, n) => item({ tag: `item-${n}` }));
    expect(checkReport({ items: many }, context, isFile).items).toHaveLength(LIMITS.items);
    const out = checkReport({ items: [item(), item(), 'x', item({ tag: 'No Tag' }), item({ tag: 'no-why', why: ' ' }), item({ tag: 'no-decision', decision: 'merge' })] }, context, isFile);
    expect(out.items).toHaveLength(1);
    expect(out.dropped).toHaveLength(5);
    expect(checkReport(null, context, isFile)).toEqual({ items: [], dropped: [] });
  });

  it('takes out an address, names only an issue it was given, and keeps the issue of an earlier run', () => {
    const out = checkReport({ items: [item({ tag: 'known-item', like: 'LAN-999', found: 'Written by someone@example.org in the code.' })] }, context, isFile);
    expect(out.items[0]).toMatchObject({ like: null, issue: 'LAN-40', found: 'Written by [address] in the code.' });
  });

  it('writes the Linear issue from the item alone', () => {
    const text = itemDescription({ ...item(), issue: null }, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1');
    expect(text).toContain('the same mistake as LAN-12');
    expect(text).toContain('- `apps/mobile/src/screens/invite.tsx:142`');
    expect(text).toContain('the fix team writes the change');
    expect(itemDescription({ ...item({ action: 'ask', like: null }), issue: null }, 'x')).toContain('a developer decides');
    expect(TITLE_PREFIX).toBe('Research: ');
  });

  it('has the words and limits the Worker checks', () => {
    expect(DECISIONS).toEqual([...RESEARCH_DECISIONS]);
    expect(ACTIONS).toEqual([...RESEARCH_ACTIONS]);
    expect(LIMITS).toMatchObject({ ...RESEARCH_TEXT });
  });
});

describe('what the Worker takes from the research', () => {
  const base = { sha: 'a'.repeat(40), runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/12', looked: [], grew: [], states: [] };
  const sent = (over: Record<string, unknown> = {}) => ({ ...item(), steps: null, issue: 'LAN-50', issueUrl: 'https://linear.app/frontierrandd/issue/LAN-50/x', ...over });

  it('takes a checked item and the issues handed to the fix team', () => {
    const looked = parseLooked({ ...base, research: [sent()], handed: ['LAN-50'] });
    expect(looked.research).toEqual([sent()]);
    expect(looked.handed).toEqual(['LAN-50']);
    expect(parseLooked(base)).toMatchObject({ research: [], handed: [] });
  });

  it.each([
    ['a tag twice', [sent(), sent()]],
    ['an address', [sent({ why: 'Ask someone@example.org.' })]],
    ['a place outside the repository', [sent({ places: ['../../etc/passwd'] })]],
    ['a recommended item with no place', [sent({ places: [] })]],
    ['an action on a watched item', [sent({ decision: 'watch' })]],
    ['an issue with no address', [sent({ issueUrl: null })]],
    ['a diagram with no step that goes wrong', [sent({ steps: [{ where: 'Phone', text: 'One.' }, { where: 'Phone', text: 'Two.' }] })]],
    ['too many places', [sent({ places: Array.from({ length: RESEARCH_TEXT.places + 1 }, (_, n) => `a/b${n}.ts`) })]]
  ])('refuses %s', (_, research) => {
    expect(() => parseLooked({ ...base, research })).toThrow();
  });

  it('refuses a handed issue that is not one', () => {
    expect(() => parseLooked({ ...base, handed: ['x'] })).toThrow();
  });
});

describe('an issue as a small diagram', () => {
  const steps = [{ where: 'Person', text: 'Taps Play.' }, { where: 'Browser', text: 'The request is refused.', wrong: true }, { text: 'Sees a grey button.' }];

  it('keeps 2 to 6 steps with one that goes wrong, addresses out', () => {
    expect(stepsOf(steps)).toEqual([{ where: 'Person', text: 'Taps Play.', wrong: false }, { where: 'Browser', text: 'The request is refused.', wrong: true }, { where: null, text: 'Sees a grey button.', wrong: false }]);
    expect(stepsOf([...steps, ...steps, ...steps])).toHaveLength(DIAGRAM.max);
    expect(stepsOf([{ text: 'Ask someone@example.org.', wrong: true }, { text: 'x'.repeat(200) }])?.map((s) => s.text.length <= DIAGRAM.text && !s.text.includes('@'))).toEqual([true, true]);
    expect(stepsOf(steps.slice(0, 1))).toBeNull();
    expect(stepsOf([{ text: 'One.' }, { text: 'Two.' }])).toBeNull();
    expect(stepsOf('x')).toBeNull();
    expect(DIAGRAM).toEqual({ ...SERVER_DIAGRAM });
  });

  it('is what the Worker takes for a new issue', () => {
    const base = { sha: 'a'.repeat(40), runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/12' };
    expect(parseLooked({ ...base, diagrams: [{ issue: 'LAN-9', steps: stepsOf(steps) }] }).diagrams).toEqual([{ issue: 'LAN-9', steps: stepsOf(steps) }]);
    expect(parseLooked(base).diagrams).toEqual([]);
    expect(() => parseLooked({ ...base, diagrams: [{ issue: 'LAN-9', steps: steps.slice(0, 1) }] })).toThrow(/2 to 6 steps/);
    expect(() => parseLooked({ ...base, diagrams: [{ issue: 'LAN-9', steps: stepsOf(steps) }, { issue: 'LAN-9', steps: stepsOf(steps) }] })).toThrow(/once/);
    expect(() => parseLooked({ ...base, diagrams: [{ issue: 'LAN-9', steps: [{ text: 'a@b.org' }, { text: 'x', wrong: true }] }] })).toThrow(/no address/);
  });
});

describe('the research hands issues to the fix team', () => {
  it('after the others, the oldest first, while there is room', () => {
    expect(researchToTake(['LAN-7', 'LAN-8', 'LAN-9'], ['LAN-1'])).toEqual(['LAN-7', 'LAN-8'].slice(0, FIX_MAX - 1));
    expect(researchToTake(['LAN-7'], ['LAN-1', 'LAN-2', 'LAN-3'])).toEqual([]);
    expect(researchToTake(['LAN-1', 'x', 'LAN-7', 'LAN-7'], ['LAN-1'])).toEqual(['LAN-7']);
    expect(researchToTake(undefined, [])).toEqual([]);
  });
});
