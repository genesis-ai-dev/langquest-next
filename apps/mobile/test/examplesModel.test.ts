import { exampleGroups } from '../src/keyTerms/examplesModel';

/** Why: a team's term can be said two ways depending on context; their recordings must stay apart, and none may be lost. */
const r = (renderingId: string, rendering: string, context = '') => ({ renderingId, rendering, context });
const a = (renderingId: string, forRenderingId?: string) => ({ renderingId, blobHash: `h-${renderingId}`, durationMs: 800, actorId: 'x', ...(forRenderingId ? { forRenderingId } : {}) });

describe('exampleGroups', () => {
  it('keeps repeats of one way together and the other way apart', () => {
    const g = exampleGroups({ renderings: [r('w1', 'Wët Nhialic', 'God'), r('w2', 'Wët', 'a message')], audioRenderings: [a('c1', 'w1'), a('c2', 'w2'), a('c3', 'w1')] });
    expect(g.map((x) => [x.rendering, x.examples.map((e) => e.renderingId)])).toEqual([['Wët Nhialic', ['c1', 'c3']], ['Wët', ['c2']]]);
  });
  it('offers an empty written way with no clips, so each can get its first examples', () => {
    expect(exampleGroups({ renderings: [r('w1', 'Wët')], audioRenderings: [] })).toEqual([{ renderingId: 'w1', rendering: 'Wët', context: '', examples: [] }]);
  });
  it('puts clips with no written way, or one that is gone, under "other"', () => {
    const g = exampleGroups({ renderings: [r('w1', 'Wët')], audioRenderings: [a('c1'), a('c2', 'gone'), a('c3', 'w1')] });
    expect(g.at(-1)).toMatchObject({ renderingId: null, examples: [{ renderingId: 'c1' }, { renderingId: 'c2' }] });
    expect(g[0]!.examples.map((e) => e.renderingId)).toEqual(['c3']);
  });
  it('lets a team record before it writes anything', () => {
    expect(exampleGroups({ renderings: [], audioRenderings: [] })).toEqual([{ renderingId: null, rendering: '', context: '', examples: [] }]);
  });
});
