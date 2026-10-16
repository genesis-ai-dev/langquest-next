/**
 * Signing out of a shared browser removes every stored file (decisions.md 11),
 * even when a download is writing one at that moment: the browser refuses the
 * removal while a write is open, and found by WEB-023 on 2026-10-14, a single
 * refusal used to leave every recording and library file behind.
 */
import { clearAllWebFiles } from '../src/web/webFiles';

function refusal(name: string): Error {
  const e = new Error(`refused: ${name}`);
  e.name = name;
  return e;
}

/** A browser root whose removal of `langquest/` fails with these errors, in order, then succeeds. */
function rootFailing(...errors: Error[]) {
  const removeEntry = vi.fn(async (_name: string, _opts?: { recursive?: boolean }) => {
    const next = errors.shift();
    if (next) throw next;
  });
  return { root: async () => ({ removeEntry }) as never, removeEntry };
}

const noPause = async () => undefined;

describe('clearAllWebFiles', () => {
  it('removes the whole langquest directory', async () => {
    const { root, removeEntry } = rootFailing();
    await clearAllWebFiles(root, 1000, noPause);
    expect(removeEntry).toHaveBeenCalledExactlyOnceWith('langquest', { recursive: true });
  });

  it('is done when there is nothing to remove', async () => {
    const { root } = rootFailing(refusal('NotFoundError'));
    await expect(clearAllWebFiles(root, 1000, noPause)).resolves.toBeUndefined();
  });

  it('tries again while a download has a file open for writing', async () => {
    const { root, removeEntry } = rootFailing(refusal('NoModificationAllowedError'), refusal('NoModificationAllowedError'));
    await clearAllWebFiles(root, 1000, noPause);
    expect(removeEntry).toHaveBeenCalledTimes(3);
  });

  it('gives up once its patience runs out, so sign-out still finishes', async () => {
    const { root } = rootFailing(...Array.from({ length: 1000 }, () => refusal('NoModificationAllowedError')));
    await expect(clearAllWebFiles(root, 0, noPause)).rejects.toThrow('NoModificationAllowedError');
  });

  it('does not retry other failures', async () => {
    const { root, removeEntry } = rootFailing(refusal('SecurityError'));
    await expect(clearAllWebFiles(root, 1000, noPause)).rejects.toThrow('SecurityError');
    expect(removeEntry).toHaveBeenCalledOnce();
  });
});
