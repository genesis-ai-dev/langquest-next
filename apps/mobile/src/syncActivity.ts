// What the sync runs are doing right now, read-only for the UI tests'
// `__langquestTestState` probe (App.tsx). The hooks wrap their `client.sync()`
// call in `trackSync`; it records and returns the result untouched.
let running = 0;
let lastSyncAt: number | null = null;
let lastPullMore = false;

export async function trackSync<T extends { more?: boolean }>(run: () => Promise<T>): Promise<T> {
  running += 1;
  try {
    const r = await run();
    lastPullMore = !!r.more;
    lastSyncAt = Date.now();
    return r;
  } finally {
    running -= 1;
  }
}

export function syncActivity(): { syncing: boolean; lastSyncAt: number | null; lastPullMore: boolean } {
  return { syncing: running > 0, lastSyncAt, lastPullMore };
}
