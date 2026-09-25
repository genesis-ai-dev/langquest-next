/** Legacy RPC telemetry only. NEVER gate append/pull on client age.
 * Event schema versions and reducer cache versions evolve independently.
 * See AGENTS.md and docs/sync-integrity.md before changing sync.
 */
export const CLIENT_PROTOCOL_VERSION = 4;
