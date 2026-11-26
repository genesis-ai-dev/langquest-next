import { diagnostics } from '../diagnostics/diagnostics';
import { listenToStops } from './sessionSafeFetch';

/**
 * Count each request the app stopped because it got no answer in time
 * (sessionSafeFetch.ts), on the hourly `expected` tally, so field
 * diagnostics show how often a request needs its limit (LAN-339). A request
 * stopped because the network went or came back is not counted: that is
 * the field's ordinary day, and the watch for user issues would read it as
 * a new kind of failure. Returns the unsubscribe.
 */
export function watchStoppedRequests(): () => void {
  return listenToStops((why) => {
    // i18n-ignore: a diagnostics label, never shown
    if (why === 'no_answer') diagnostics.expected('request stopped', 'TypeError', why);
  });
}
