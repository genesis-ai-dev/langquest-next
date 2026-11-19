import Foundation

/**
 * Every code the nearby module rejects with (docs/nearby-sync-plan.md 5.12): an enumerated list,
 * because the diagnostics allowlist holds them. `src/codes.ts` lists the same names in the same
 * order as `NearbyError.kt`, and apps/mobile/test/nearbyNative.test.ts holds all three equal. A
 * message never holds a key, a salt or a peer's address.
 */
enum NearbyCode: String, CaseIterable {
  /** No Bluetooth LE here: the module does nothing. */
  case NOT_AVAILABLE
  case NO_PERMISSION
  case BLUETOOTH_OFF
  case WIFI_OFF
  case BAD_ARGUMENT
  /** This phone cannot advertise; it can still scan and connect. */
  case ADVERTISE_UNSUPPORTED
  case ADVERTISE_FAILED
  case SCAN_FAILED
  case FIND_NOT_RUNNING
  /** The phone heard is not there, or offers no service under that salt. */
  case PEER_GONE
  case PIPE_FAILED
  case PIPE_TIMEOUT
  case P2P_UNSUPPORTED
  case GROUP_BUSY
  case GROUP_FAILED
  case HOTSPOT_NO_CHANNEL
  case HOTSPOT_INCOMPATIBLE
  case HOTSPOT_TETHERING_DISALLOWED
  case HOTSPOT_FAILED
  case JOIN_FAILED
  case JOIN_TIMEOUT
  /** A group taken down before anyone joined. */
  case HOST_TAKEN_DOWN
  case LINK_UNKNOWN
  /** Closed on this side. */
  case LINK_CLOSED
  /** The other side went without a clean close. */
  case LINK_DROPPED
  /** A frame failed its tag: the link is closed. */
  case TAG_FAILED
  case FRAME_TOO_LARGE
  case MESSAGE_TOO_LARGE
  case NOT_SECURED
  case ALREADY_SECURED
  case OPENING_AFTER_SECURE
  case TRANSFER_BUSY
  case FILE_TOO_BIG
  case FILE_NO_SPACE
  case FILE_REFUSED
  case FILE_CANCELLED
  case FILE_UNREADABLE
  case FILE_WRITE_FAILED
  case FILE_SIZE_MISMATCH
  case STAGING_REFUSED
  case STOPPED
  case INTERNAL
}

/** A rejection: its code, and a message that never holds a key, a salt or an address. */
struct NearbyError: Error {
  let code: NearbyCode
  let message: String

  init(_ code: NearbyCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

/**
 * The codes that mean the link went, which JavaScript reads as a drop (`NEARBY_DROP_CODES` in
 * src/codes.ts, held equal by apps/mobile/test/nearbyNative.test.ts). A call on a link that went
 * rejects with one of these, whatever ended it.
 */
let DROP_CODES: Set<NearbyCode> = [
  NearbyCode.LINK_CLOSED, NearbyCode.LINK_DROPPED, NearbyCode.TAG_FAILED, NearbyCode.FRAME_TOO_LARGE, NearbyCode.LINK_UNKNOWN, NearbyCode.STOPPED,
]
