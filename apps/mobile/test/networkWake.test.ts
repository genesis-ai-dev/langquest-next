import { wakeOnReconnect, type NetworkSignal } from '../src/networkWake';

function harness() {
  let emit: (s: NetworkSignal) => void = () => {};
  let t = 0;
  let wakes = 0;
  const stop = wakeOnReconnect((cb) => { emit = cb; return () => { emit = () => {}; }; }, () => { wakes++; }, () => t);
  return {
    signal: (s: NetworkSignal) => emit(s),
    later: (ms: number) => { t += ms; },
    wakes: () => wakes,
    stop
  };
}

describe('waking sync when the network comes back', () => {
  it('wakes once when a phone with no network gets one, not for where things stand at first', () => {
    // Why: without this a phone out of signal for weeks noticed the signal
    // only at its next offline poll, up to the backoff ceiling later.
    const h = harness();
    h.signal({ isConnected: true, isInternetReachable: true });
    expect(h.wakes()).toBe(0);
    h.signal({ isConnected: false });
    h.later(60_000);
    h.signal({ isConnected: true, isInternetReachable: true });
    expect(h.wakes()).toBe(1);
  });

  it('does not wake for a network the system says cannot reach the internet', () => {
    const h = harness();
    h.signal({ isConnected: false });
    h.signal({ isConnected: true, isInternetReachable: false });
    expect(h.wakes()).toBe(0);
    h.signal({ isConnected: true, isInternetReachable: true });
    expect(h.wakes()).toBe(1);
  });

  it('wakes at most once in ten seconds while the signal comes and goes', () => {
    const h = harness();
    h.signal({ isConnected: false });
    for (let i = 0; i < 10; i++) {
      h.signal({ isConnected: true });
      h.later(500);
      h.signal({ isConnected: false });
      h.later(500);
    }
    expect(h.wakes()).toBe(1);
    h.later(10_000);
    h.signal({ isConnected: true });
    expect(h.wakes()).toBe(2);
  });

  it('stops listening', () => {
    const h = harness();
    h.signal({ isConnected: false });
    h.stop();
    h.signal({ isConnected: true });
    expect(h.wakes()).toBe(0);
  });
});
