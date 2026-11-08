/**
 * The nearby module's codes (docs/nearby-sync-plan.md 5.12): an enumerated list, because the
 * diagnostics allowlist holds them. `NearbyCode` in the Kotlin declares the same names in the same
 * order (apps/mobile/test/nearbyNative.test.ts). Pure, so tests and diagnostics read it without
 * the native module.
 */

/** Every code the module rejects with or reports, in the order `NearbyCode` declares them. */
export const NEARBY_NATIVE_CODES = [
  'NOT_AVAILABLE', 'NO_PERMISSION', 'BLUETOOTH_OFF', 'WIFI_OFF', 'BAD_ARGUMENT', 'ADVERTISE_UNSUPPORTED', 'ADVERTISE_FAILED', 'SCAN_FAILED',
  'FIND_NOT_RUNNING', 'PEER_GONE', 'PIPE_FAILED', 'PIPE_TIMEOUT', 'P2P_UNSUPPORTED', 'GROUP_BUSY', 'GROUP_FAILED', 'HOTSPOT_NO_CHANNEL',
  'HOTSPOT_INCOMPATIBLE', 'HOTSPOT_TETHERING_DISALLOWED', 'HOTSPOT_FAILED', 'JOIN_FAILED', 'JOIN_TIMEOUT', 'HOST_TAKEN_DOWN', 'LINK_UNKNOWN',
  'LINK_CLOSED', 'LINK_DROPPED', 'TAG_FAILED', 'FRAME_TOO_LARGE', 'MESSAGE_TOO_LARGE', 'NOT_SECURED', 'ALREADY_SECURED', 'OPENING_AFTER_SECURE',
  'TRANSFER_BUSY', 'FILE_TOO_BIG', 'FILE_NO_SPACE', 'FILE_REFUSED', 'FILE_CANCELLED', 'FILE_UNREADABLE', 'FILE_WRITE_FAILED', 'FILE_SIZE_MISMATCH',
  'STAGING_REFUSED', 'STOPPED', 'INTERNAL'
] as const;

export type NearbyNativeCode = (typeof NEARBY_NATIVE_CODES)[number];

/** Codes that mean the link went: sync's `OfflineError`. */
export const NEARBY_DROP_CODES: readonly NearbyNativeCode[] = ['LINK_CLOSED', 'LINK_DROPPED', 'TAG_FAILED', 'FRAME_TOO_LARGE', 'LINK_UNKNOWN'];
