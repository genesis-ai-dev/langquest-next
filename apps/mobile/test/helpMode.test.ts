// Help mode (demo ADR-038; decision 71 as amended 2026-10-10): what a part
// says when tapped while help is on, how parts are numbered, and where the
// lit places and the tooltip go.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseRows, clipRect, helpLine, litShape, markAt, numberParts, speaks, tooltipPlace, type FirstSeen, type HelpRect, type RowPart } from '../src/helpMode/helpContext';
import { findUnexplained, findUnlistedRows, scanHelp, scanRows } from './helpParts';

const box = (x: number, y: number, width = 100, height = 48): HelpRect => ({ x, y, width, height });

describe('help mode', () => {
  it('says the part and what it does, or just the part', () => {
    expect(helpLine('Something else?', 'Another way forward, less often needed.')).toBe('Something else? Another way forward, less often needed.');
    expect(helpLine('Record', 'The main thing to do on this screen.')).toBe('Record. The main thing to do on this screen.');
    expect(helpLine(' Record ')).toBe('Record');
    expect(helpLine('Publish', '  ')).toBe('Publish');
  });
});

describe('numbering the parts', () => {
  const seen = (entries: [string, number, HelpRect][]): Map<string, FirstSeen> => new Map(entries.map(([k, s, rect]) => [k, { seen: s, rect }]));

  it('reads top to bottom, then along a line', () => {
    const n = numberParts(seen([['start', 0, box(16, 400)], ['bell', 0, box(260, 20)], ['help', 0, box(320, 24)], ['all', 0, box(120, 500)]]));
    expect([...n]).toEqual([['bell', 1], ['help', 2], ['start', 3], ['all', 4]]);
  });

  it('reads along a line from the right in a right-to-left language', () => {
    const n = numberParts(seen([['a', 0, box(16, 100)], ['b', 0, box(200, 104)]]), true);
    expect(n.get('b')).toBe(1);
    expect(n.get('a')).toBe(2);
  });

  it('numbers parts scrolled into view after those on screen, so numbers never move', () => {
    const n = numberParts(seen([['record', 0, box(150, 760)], ['verse 1', 0, box(16, 300)], ['verse 3', 40, box(16, 310)]]));
    expect([...n]).toEqual([['verse 1', 1], ['record', 2], ['verse 3', 3]]);
  });
});

describe('one row speaks for a list', () => {
  const part = (of: string, row: string, rect: HelpRect, visible: HelpRect | null = rect): RowPart => ({ rows: [{ of, row }], rect, visible });

  it('picks the first row in sight of each kind, and leaves parts in no list alone', () => {
    const chosen = chooseRows([
      part('part', 'r2', box(16, 300)), part('part', 'r2', box(200, 300)),
      part('part', 'r1', box(16, 200)), part('part', 'r3', box(16, 400)),
      part('person', 'p1', box(16, 600)), { rect: box(16, 20), visible: box(16, 20) }
    ], new Map());
    expect([...chosen]).toEqual([['part', 'r1'], ['person', 'p1']]);
    expect(speaks([{ of: 'part', row: 'r1' }], chosen)).toBe(true);
    expect(speaks([{ of: 'part', row: 'r2' }], chosen)).toBe(false);
    expect(speaks(undefined, chosen)).toBe(true);
  });

  it('prefers a row wholly in sight to one cut off at an edge, and skips rows out of sight', () => {
    const chosen = chooseRows([
      part('part', 'r0', box(16, 0), null),
      part('part', 'r1', box(16, 80), box(16, 100, 100, 28)),
      part('part', 'r2', box(16, 140))
    ], new Map());
    expect(chosen.get('part')).toBe('r2');
  });

  it('keeps the row it chose, and chooses none while no row is in sight', () => {
    const was = new Map([['part', 'r3']]);
    expect(chooseRows([part('part', 'r1', box(16, 100)), part('part', 'r3', box(16, 300))], was).get('part')).toBe('r3');
    expect(chooseRows([part('part', 'r1', box(16, 900), null)], new Map()).has('part')).toBe(false);
  });

  it('lets the first inner row in sight speak for a list in a list, whichever outer row it is in', () => {
    const outer = (row: string, y: number): RowPart => ({ rows: [{ of: 'section', row }], rect: box(16, y), visible: box(16, y) });
    const inner = (o: string, row: string, y: number): RowPart =>
      ({ rows: [{ of: 'section', row: o }, { of: 'picture', row }], rect: box(16, y), visible: box(16, y) });
    const chosen = chooseRows([outer('s1', 100), outer('s2', 300), inner('s2', 'p1', 350), inner('s2', 'p2', 450)], new Map());
    expect([...chosen]).toEqual([['section', 's1'], ['picture', 'p1']]);
    expect(speaks([{ of: 'section', row: 's2' }], chosen)).toBe(false);
    expect(speaks([{ of: 'section', row: 's2' }, { of: 'picture', row: 'p1' }], chosen)).toBe(true);
  });
});

describe('where help draws', () => {
  it('cuts a part to the area it scrolls in, and drops it when it is out of sight', () => {
    const pane = box(0, 100, 390, 300);
    expect(clipRect(box(16, 80, 100, 60), pane)).toEqual({ x: 16, y: 100, width: 100, height: 40 });
    expect(clipRect(box(16, 420), pane)).toBeNull();
    expect(clipRect(box(16, 420), undefined)).toEqual(box(16, 420));
  });

  it('lights a round button as a circle, a row as its own box, anything else a little larger', () => {
    expect(litShape(box(10, 10, 48, 48), 16)).toEqual({ circle: { cx: 34, cy: 34, r: 28 } });
    expect(litShape(box(0, 100, 358, 72), 16, true)).toEqual({ box: { x: 0, y: 100, width: 358, height: 72, r: 0 } });
    expect(litShape(box(16, 400, 358, 56), 16)).toEqual({ box: { x: 12, y: 396, width: 366, height: 64, r: 20 } });
  });

  it('puts the number over the leading top corner, or just inside it', () => {
    expect(markAt(box(16, 400), 'corner')).toEqual({ x: 8, y: 392 });
    expect(markAt(box(16, 400), 'inset')).toEqual({ x: 20, y: 404 });
    expect(markAt(box(16, 400), 'corner', true)).toEqual({ x: 16 + 100 + 8 - 26, y: 392 });
  });

  it('puts the tooltip under the part, above it when there is no room, else at the foot', () => {
    const window = { width: 390, height: 844 };
    const opts = { margin: 16, gap: 8, maxWidth: 420, top: 47, bottom: 34 };
    const under = tooltipPlace(box(16, 200, 358, 56), window, { height: 120 }, opts);
    expect(under).toMatchObject({ x: 16, width: 358, below: true });
    expect(under.y).toBeGreaterThan(256);
    const over = tooltipPlace(box(150, 740, 88, 88), window, { height: 120 }, opts);
    expect(over.below).toBe(false);
    expect(over.y + 120).toBeLessThan(740);
    expect(over.arrowX).toBe(150 + 44 - 16);
    const told = tooltipPlace(null, window, { height: 200 }, opts);
    expect(told).toMatchObject({ below: null, y: 844 - 34 - 200 });
  });
});

// Reads every app file, so it grows with the app (see i18n.test.ts).
describe('every part explains itself', { timeout: 30_000 }, () => {
  it('leaves nothing that acts, or only says its name, while help is on', () => {
    // `npx tsx apps/mobile/test/helpParts.ts` lists them. Give each a line (useHelpSpot, or the kit
    // control's `help`), or a `help-ignore:` comment saying why it needs none.
    expect(scanHelp(join(import.meta.dirname, '..')).map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('gives every list of rows that hold parts one row to speak for it', () => {
    expect(scanRows(join(import.meta.dirname, '..')).map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('finds list rows without a HelpRow, through the components they draw', () => {
    const rows = `
      function PersonRow(p: { name: string; go: () => void }) { return <Row label={p.name} sub="Opens them." onPress={p.go} />; }
      function Plain(p: { name: string }) { return <Text>{p.name}</Text>; }
      export function A(p: { people: string[]; go: () => void }) {
        return (<View>
          {p.people.map((n) => <PersonRow key={n} name={n} go={p.go} />)}
          {p.people.map((n) => <HelpRow key={n} of="person"><PersonRow name={n} go={p.go} /></HelpRow>)}
          {p.people.map((n) => <Plain key={n} name={n} />)}
          {p.people.map((n) => <Row key={n} label={n} />)}
          {/* help-each: each does something different */}
          {p.people.map((n) => <IconBtn key={n} name="x" label={n} help="Does it." onPress={p.go} />)}
          {p.people.map((n) => <View key={n}>{[1, 2].map((i) => <Chip key={i} label={n} on={false} help="Picks it." onPress={p.go} />)}</View>)}
          {p.people.map(card)}
          {p.people.map((n) => <View key={n}>{card(n)}</View>)}
          {p.people.map(listed)}
        </View>);
        function card(n: string) { return <PersonRow key={n} name={n} go={p.go} />; }
        function listed(n: string) { return <HelpRow key={n} of="person"><PersonRow name={n} go={p.go} /></HelpRow>; }
      }`;
    expect(findUnlistedRows([{ path: 'src/a.tsx', source: rows }]).map((f) => `${f.line} ${f.text}`)).toEqual([
      '6 list rows hold parts without a HelpRow',
      '12 list rows hold parts without a HelpRow',
      '13 list rows hold parts without a HelpRow',
      '14 list rows hold parts without a HelpRow'
    ]);
  });

  it('finds what does not explain itself, and passes what does', () => {
    const src = `
      export function A(p: { go: () => void }) {
        const spot = useHelpSpot('Open', 'Opens it.', p.go);
        return (<View>
          <Pressable onPress={p.go}><Text>Raw</Text></Pressable>
          <Pressable onPress={spot.onPress}><HelpBadge spot={spot} /></Pressable>
          <Pressable style={s} />
          {/* help-ignore: a backdrop */}
          <Pressable onPress={p.go} />
          <IconBtn name="close" label="Close" onPress={p.go} />
          <IconBtn name="close" label="Close" help="Closes it." onPress={p.go} />
          <Card onPress={p.go} accessibilityLabel="Romans"><Text>R</Text></Card>
          <Row label="Me" onPress={p.go} />
          <Row label="Me" sub="Your name" onPress={p.go} />
          <View><TextInput value="" /><HelpCover spot={spot} label="Name" /></View>
        </View>);
      }`;
    expect(findUnexplained('src/a.tsx', src).map((f) => `${f.line} ${f.text}`)).toEqual([
      '5 Pressable acts without explaining itself',
      '10 IconBtn without help',
      '12 tappable Card without help and accessibilityLabel',
      '13 tappable Row without sub or help'
    ]);
  });
});
