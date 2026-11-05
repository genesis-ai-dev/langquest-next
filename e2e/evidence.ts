// Evidence helpers shared by the web smoke test.
import type { Page } from '@playwright/test';

/** Hashes with a trusted (non-staging) file in the device blob store. */
export async function deviceBlobs(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let dir: FileSystemDirectoryHandle;
    // apps/mobile/src/web/webFiles.ts: every web store under langquest/.
    try { dir = await (await root.getDirectoryHandle('langquest')).getDirectoryHandle('blobs'); } catch { return []; }
    const out: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (!name.endsWith('.part')) out.push(name.split('.')[0]!);
    }
    return out;
  });
}

/** Poll `read` until `done` holds or the deadline passes; returns the last reading either way. */
export async function settle<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
}
