/** What the operating system says about the connection (expo-network's event). */
export interface NetworkSignal {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}

/** The operating system says there is no network, or that the internet cannot be reached. Unknown is not offline. */
export function saysOffline(s: NetworkSignal): boolean {
  return s.isConnected === false || s.isInternetReachable === false;
}

/**
 * Call `fn` when the phone gets a network back after having none, at most
 * once per `quietMs`: at the edge of coverage the signal can come and go
 * several times a minute. "Connected" is not proof the server answers
 * (a captive portal, a SIM with no data left), so this only wakes sync; the
 * scheduler's offline poll stays as the safety net (performance-audit.md,
 * the offline wake interval). The first signal only says where things
 * stand; it wakes nothing.
 */
export function wakeOnReconnect(
  listen: (onSignal: (s: NetworkSignal) => void) => () => void,
  fn: () => void,
  now: () => number = () => Date.now(),
  quietMs = 10_000,
  /**
   * Called when a phone that had a network loses it, at most once per
   * `quietMs` too: one sync attempt then fails at once, so the app says
   * "Offline" now rather than at the live channel's next timeout (SYNC-002).
   */
  onLoss?: () => void
): () => void {
  let up: boolean | null = null;
  let last = -Infinity;
  let lastLoss = -Infinity;
  return listen((s) => {
    const connected = s.isConnected === true && s.isInternetReachable !== false;
    if (connected && up === false && now() - last >= quietMs) {
      last = now();
      fn();
    }
    if (!connected && up === true && onLoss && now() - lastLoss >= quietMs) {
      lastLoss = now();
      onLoss();
    }
    up = connected;
  });
}
