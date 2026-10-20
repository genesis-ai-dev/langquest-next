// The Worker's file store as the fixture and the test helpers write to it.
// A write here is a setup step (a recording made for a world, a file a test
// needs on the server), keyed by the hash of its bytes, so sending it again
// is harmless; under load miniflare sometimes drops a connection ("Network
// connection lost", HTTP 500). A setup step retries that a few times and
// says how many attempts it made. A test's own assertions never retry.
import { workerBlobs } from '@langquest-next/sync';

const ATTEMPTS = 4;
const BACKOFF_MS = 300;

/** An answer worth sending again: the server's 5xx, or no answer at all. A 4xx is the request's fault and fails at once. */
function transient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = /\((\d{3})\)/.exec(message)?.[1];
  return status ? Number(status) >= 500 : true;
}

/** `workerBlobs`, with `put` retried on a transient failure (idempotent: the key is the content hash). */
export function setupBlobs(api: string, token: string): ReturnType<typeof workerBlobs> {
  const blobs = workerBlobs(api, token);
  return {
    ...blobs,
    async put(key, bytes) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await blobs.put(key, bytes);
        } catch (error) {
          if (!transient(error) || attempt === ATTEMPTS) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${message} [after ${attempt} attempt${attempt === 1 ? '' : 's'}]`);
          }
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
        }
      }
    }
  };
}
