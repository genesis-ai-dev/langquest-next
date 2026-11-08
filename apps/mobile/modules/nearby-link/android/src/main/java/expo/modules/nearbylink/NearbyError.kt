package expo.modules.nearbylink

/**
 * Every code the nearby module rejects with (docs/nearby-sync-plan.md 5.12): an enumerated list,
 * because the diagnostics allowlist holds them. `src/NearbyLinkModule.ts` lists the same names,
 * and apps/mobile/test/nearbyNative.test.ts holds the two lists equal. A message never holds a
 * key, a salt or a peer's address.
 */
enum class NearbyCode {
  /** Below Android 10, or no Bluetooth LE: the module does nothing here. */
  NOT_AVAILABLE,
  NO_PERMISSION,
  BLUETOOTH_OFF,
  WIFI_OFF,
  BAD_ARGUMENT,
  /** This phone's controller cannot advertise; it can still scan and connect. */
  ADVERTISE_UNSUPPORTED,
  ADVERTISE_FAILED,
  SCAN_FAILED,
  FIND_NOT_RUNNING,
  /** The phone heard is not there, or offers no service under that salt. */
  PEER_GONE,
  PIPE_FAILED,
  PIPE_TIMEOUT,
  P2P_UNSUPPORTED,
  GROUP_BUSY,
  GROUP_FAILED,
  HOTSPOT_NO_CHANNEL,
  HOTSPOT_INCOMPATIBLE,
  HOTSPOT_TETHERING_DISALLOWED,
  HOTSPOT_FAILED,
  JOIN_FAILED,
  JOIN_TIMEOUT,
  /** A group taken down before anyone joined. */
  HOST_TAKEN_DOWN,
  LINK_UNKNOWN,
  /** Closed on this side. */
  LINK_CLOSED,
  /** The other side went without a clean close. */
  LINK_DROPPED,
  /** A frame failed its tag: the link is closed. */
  TAG_FAILED,
  FRAME_TOO_LARGE,
  MESSAGE_TOO_LARGE,
  NOT_SECURED,
  ALREADY_SECURED,
  OPENING_AFTER_SECURE,
  TRANSFER_BUSY,
  FILE_TOO_BIG,
  FILE_NO_SPACE,
  FILE_REFUSED,
  FILE_CANCELLED,
  FILE_UNREADABLE,
  FILE_WRITE_FAILED,
  FILE_SIZE_MISMATCH,
  STAGING_REFUSED,
  STOPPED,
  INTERNAL,
}

class NearbyException(val code: NearbyCode, message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The codes that mean the link went, which JavaScript reads as a drop (`NEARBY_DROP_CODES` in
 * src/codes.ts, held equal by apps/mobile/test/nearbyNative.test.ts). A call on a link that went
 * rejects with one of these, whatever ended it.
 */
val DROP_CODES: Set<NearbyCode> = setOf(
  NearbyCode.LINK_CLOSED, NearbyCode.LINK_DROPPED, NearbyCode.TAG_FAILED, NearbyCode.FRAME_TOO_LARGE, NearbyCode.LINK_UNKNOWN, NearbyCode.STOPPED,
)
