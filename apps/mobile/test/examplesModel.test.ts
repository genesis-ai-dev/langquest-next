import { exampleWays, newWayId } from '../src/keyTerms/examplesModel';

/** Why: a term can be said two ways by context, and a language may have no written form; recordings of different ways must stay apart and none may be lost. */
const r = (renderingId: string, rendering: string, context = '') => ({ renderingId, rendering, context });
const a = (renderingId: string, wayId: string, duringTakeId?: string) => ({ renderingId, blobHash: `h-${renderingId}`, durationMs: 800, actorId: 'x', wayId, ...(duringTakeId ? { duringTakeId } : {}) });

describe('exampleWays', () => {
  it('keeps repeats of one way together and other ways apart, with no written form needed', () => {
    const ways = exampleWays({ renderings: [], audioRenderings: [a('c1', 'way:a'), a('c2', 'way:b'), a('c3', 'way:a')] });
    expect(ways.map((w) => [w.wayId, w.rendering, w.examples.map((e) => e.renderingId)])).toEqual([['way:a', '', ['c1', 'c3']], ['way:b', '', ['c2']]]);
  });
  it('names a way by its written rendering and carries its context', () => {
    const ways = exampleWays({ renderings: [r('w1', 'Wët Nhialic', 'God himself')], audioRenderings: [a('c1', 'w1')] });
    expect(ways).toEqual([{ wayId: 'w1', rendering: 'Wët Nhialic', context: 'God himself', examples: [a('c1', 'w1')], takeIds: [] }]);
  });
  it('still offers a written rendering with no clips, after the recorded ways', () => {
    const ways = exampleWays({ renderings: [r('w1', 'Wët')], audioRenderings: [a('c1', 'way:a')] });
    expect(ways.map((w) => w.wayId)).toEqual(['way:a', 'w1']);
    expect(ways[1]!.examples).toEqual([]);
  });
  it('shows a way just added on screen before it has a clip, once', () => {
    const id = newWayId('u1');
    const ways = exampleWays({ renderings: [], audioRenderings: [a('c1', 'way:a')] }, [id, 'way:a']);
    expect(ways.map((w) => w.wayId)).toEqual(['way:a', 'way:u1']);
  });
  it('gives a term with nothing one empty way, so there is always a place to record', () => {
    expect(exampleWays({ renderings: [], audioRenderings: [] })).toEqual([{ wayId: 'way:first', rendering: '', context: '', examples: [], takeIds: [] }]);
  });
  it('lists the takes a way was recorded during, each once, so the way can name its passages', () => {
    const ways = exampleWays({ renderings: [], audioRenderings: [a('c1', 'way:a', 't1'), a('c2', 'way:a', 't1'), a('c3', 'way:a', 't2'), a('c4', 'way:b')] });
    expect(ways.map((w) => w.takeIds)).toEqual([['t1', 't2'], []]);
  });
});
