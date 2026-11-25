// The keys under which a phone keeps what other organizations share (library/useLibrary.ts).

/**
 * Marks a kind's list of what other organizations share (`library-shared:<kind>`) as holding a
 * teammate's rows, not yet the server's (2026-11-24, review item 9): the server's read clears it.
 */
export const SHARED_TEAMMATE_PREFIX = 'library-shared-teammate:';
