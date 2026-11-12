import { Fragment, Suspense, use, useRef, type ReactNode } from 'react';

/**
 * react-freeze's `Freeze`, which react-native-screens uses to freeze the
 * screens under the top one (`freezeOnBlur`, decision 119), mended for
 * React 19.1 and later: Metro gives react-native-screens this file when it
 * asks for `react-freeze` (metro.config.js, decision 251).
 *
 * react-freeze 1.0.4 freezes by throwing `{ then() {} }`, a thenable that
 * never settles. On React 19.1 and later, two frozen boundaries can hand
 * retries to each other without end: React schedules a new retry each time a
 * boundary already showing its fallback suspends again outside a prerender,
 * so it re-renders and re-commits the frozen screens hundreds of times a
 * second and starves timers, network callbacks and the screen being opened
 * (software-mansion/react-freeze#44). Opening a passage from a book's
 * list, with the home, the map and the book frozen under it, left a phone on
 * a blank page with its JavaScript thread full (the nightly phone tests,
 * JRN-006 and MAP-031, on Expo 58's React 19.3).
 *
 * Here the frozen part suspends through `use()` on a promise of its own,
 * resolved on thaw, as the fix proposed in that issue does: a `use()`
 * suspension in a concurrent render schedules no retry. On thaw the
 * promise is marked settled before the thawing render reads it, so the
 * screen comes back at once rather than after React's fallback throttle.
 * Remove this file and the redirect once react-freeze publishes the fix
 * (freezeShim.test.ts fails when its version moves).
 */

interface Suspension {
  promise: Promise<void>;
  thaw: () => void;
}

function newSuspension(): Suspension {
  let thaw = () => {};
  const promise = new Promise<void>((resolve) => { thaw = resolve; });
  return { promise, thaw };
}

function Suspender(props: { freeze: boolean; children: ReactNode }) {
  const suspension = useRef<Suspension | null>(null);
  if (props.freeze) {
    if (suspension.current === null) suspension.current = newSuspension();
    use(suspension.current.promise);
  } else if (suspension.current !== null) {
    const { promise, thaw } = suspension.current;
    suspension.current = null;
    thaw();
    // Settled where use() reads it (`status` and `value`, as React marks a
    // promise it has seen settle): the thawing render calls use() as the
    // suspended one did, without suspending again.
    use(Object.assign(promise, { status: 'fulfilled' as const, value: undefined }));
  }
  return <Fragment>{props.children}</Fragment>;
}

export function Freeze(props: { freeze: boolean; children: ReactNode; placeholder?: ReactNode }) {
  return (
    <Suspense fallback={props.placeholder ?? null}>
      <Suspender freeze={props.freeze}>{props.children}</Suspender>
    </Suspense>
  );
}
