/**
 * Whether this tab is recording, or holds a recording session not yet saved
 * (recording/useRecorder.ts). Its audio lives in the page until it is saved,
 * so a tab asked to step aside for another (tabLock.ts) says it is busy
 * instead of reloading.
 */
let holds = 0;

/** Marks this tab busy until the returned function is called. */
export function holdTab(): () => void {
  holds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
  };
}

export function tabBusy(): boolean {
  return holds > 0;
}
