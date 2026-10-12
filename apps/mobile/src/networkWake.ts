/** What the operating system says about the connection (expo-network's event). */
export interface NetworkSignal {
  isConnected?: boolean;
  isInternetReachable?: boolean;
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
  quietMs = 10_000
): () => void {
  let up: boolean | null = null;
  let last = -Infinity;
  return listen((s) => {
    const connected = s.isConnected === true && s.isInternetReachable !== false;
    if (connected && up === false && now() - last >= quietMs) {
      last = now();
      fn();
    }
    up = connected;
  });
}
