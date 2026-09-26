import { StackRouter, type StackNavigationState, type ParamListBase } from '@react-navigation/routers';
import { describe, expect, it, vi } from 'vitest';

// @react-navigation/native re-exports these actions from routers; the rest of it needs React Native.
vi.mock('@react-navigation/native', async () => ({ ...(await import('@react-navigation/routers')), createNavigationContainerRef: () => ({}) }));
const { popToAction } = await import('../src/nav');

// Why: workspace, review_capture and ask_someone finish with popTo
// passage_record. The record reads its passage from its own params; if the
// pop drops them the person lands on "Passage not found" after saving.
describe('popTo', () => {
  const router = StackRouter({});
  const names = ['my_work', 'passage_record', 'review_capture'];
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} };
  const state = {
    ...router.getInitialState(options),
    routes: [
      { key: 'a', name: 'my_work' },
      { key: 'b', name: 'passage_record', params: { unitId: 'luke-0', laneId: 'L1' } },
      { key: 'c', name: 'review_capture', params: { unitId: 'luke-0', laneId: 'L1', takeId: 't1' } }
    ],
    index: 2
  } as StackNavigationState<ParamListBase>;

  it('returns to the screen in the stack with its own params', () => {
    const next = router.getStateForAction(state, popToAction(state.routes, 'passage_record', { unitId: 'other' }) as never, options);
    expect(next?.routes.map((r) => r.name)).toEqual(['my_work', 'passage_record']);
    expect(next?.routes[1]?.params).toEqual({ unitId: 'luke-0', laneId: 'L1' });
  });

  it('resets to the screen with the given params when it is not in the stack', () => {
    const action = popToAction([{ name: 'my_work' }, { name: 'workspace' }], 'passage_record', { unitId: 'luke-0', laneId: 'L1' });
    expect(action).toMatchObject({ type: 'RESET', payload: { routes: [{ name: 'passage_record', params: { unitId: 'luke-0', laneId: 'L1' } }] } });
  });
});
