import { setDiagnosticsDelivery, timedTransfer } from '../diagnostics/diagnostics';
import { noteExpected } from '../diagnostics/report';
import { setHelpAudioReporting } from '../helpMode/helpAudio';
import { currentSession } from '../server/auth';
import { ingestDiagnostics } from '../server/diagnostics';
// Nearby sync's words, on a phone from the start; the web's come with the nearby screens.
import '../nearby/nearbyWordsAtStart';

/**
 * What the base folders (decisions.md 105) need from folders above them,
 * handed over once at start: diagnostics delivers through the server, and
 * help mode tells diagnostics about its downloads. Called by App.tsx.
 */
export function wireBase(): void {
  setDiagnosticsDelivery({
    signedIn: async () => !!(await currentSession()),
    send: (context, records) => ingestDiagnostics(context, records)
  });
  setHelpAudioReporting({ noteExpected, timedTransfer });
}
