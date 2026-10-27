import { describe, expect, it } from 'vitest';
import { pokeInBatches } from '../worker/batches';

describe('pokeInBatches', () => {
  it('wakes at most a batch at a time, and every organization once', async () => {
    let running = 0;
    let most = 0;
    const woken: string[] = [];
    const orgs = Array.from({ length: 45 }, (_, i) => `o${i}`);
    await pokeInBatches(orgs, async (id) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      woken.push(id);
      running -= 1;
    }, 20);
    expect(most).toBe(20);
    expect(woken.sort()).toEqual([...orgs].sort());
  });

  it('goes on past a failure, then reports the first', async () => {
    const woken: string[] = [];
    await expect(pokeInBatches(['a', 'b', 'c'], async (id) => {
      if (id === 'a') throw new Error('first');
      woken.push(id);
    }, 1)).rejects.toThrow('first');
    expect(woken).toEqual(['b', 'c']);
  });

  it('does nothing for no organizations', async () => {
    await expect(pokeInBatches([], async () => { throw new Error('no'); })).resolves.toBeUndefined();
  });
});
