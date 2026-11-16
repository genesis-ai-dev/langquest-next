/**
 * Runs `task` once the JavaScript thread is idle, as React Native's
 * InteractionManager.runAfterInteractions did until 0.87 removed it, and
 * returns a cancel. React Native and most browsers have requestIdleCallback;
 * Safari has none, so there it waits for a timer, as react-native-web's
 * InteractionManager did.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => task());
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(task, 1);
  return () => clearTimeout(id);
}
