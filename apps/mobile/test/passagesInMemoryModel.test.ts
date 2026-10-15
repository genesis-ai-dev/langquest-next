import { nearUnits } from '../src/shell/passagesInMemoryModel';

describe('the passages memory holds around the one on screen (decisions.md 110)', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('holds two on each side, fewer at the ends', () => {
    expect(nearUnits(order, 'c')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(nearUnits(order, 'a')).toEqual(['a', 'b', 'c']);
    expect(nearUnits(order, 'f')).toEqual(['d', 'e', 'f']);
  });
  it('holds a passage the order does not list on its own', () => {
    expect(nearUnits(order, 'x')).toEqual(['x']);
  });
});
