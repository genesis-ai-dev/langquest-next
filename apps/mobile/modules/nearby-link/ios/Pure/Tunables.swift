import Foundation

/** The link's times and sizes, every one an argument from JavaScript (`configureLinks`), as `LinkTunables` in the Kotlin. */
struct LinkTunables {
  /** Whole messages held for JavaScript before the reader stops reading, which slows the sender. */
  var queueMessages = 8
  /** The largest piece of a file in one frame. */
  var fileChunk = 64 * 1024
  /** How long a file that arrives before its `receiveFile` waits for it. */
  var fileWaitMs: Int64 = 10_000
  /** Bytes a Bluetooth pipe holds unread before it counts as broken. */
  var pipeBytes = 4 * 1024 * 1024
  /** How long `close` waits to say goodbye before it just closes. */
  var byeWaitMs: Int64 = 500
  /**
   * How long `close` reads on after its goodbye, until the other side closes too. A socket closed
   * with bytes unread is reset, and a reset can lose the goodbye on the other side.
   */
  var byeDrainMs: Int64 = 1_000
}

/**
 * Find's times and retries as JavaScript sends them (`FindTunables` in packages/sync/src/nearbyLink.ts),
 * read from the dictionary Expo hands over, as `Tunables.kt` reads them. Every tunable is an
 * argument from JavaScript, because a Swift edit needs a store review (docs/nearby-sync-plan.md 5.9).
 * Pure. An iPhone has no say over its advertising interval, scan mode or scan filter, and its
 * advert is always connectable, so it reads and checks those and does nothing with them.
 */
struct FindTunables {
  struct AfterHearing: Equatable {
    let listenMs: Int64
    let connectableMs: Int64
  }

  let rotateMinMs: Int64
  let rotateMaxMs: Int64
  let scanStartGapMs: Int64
  let scanRestartMs: Int64
  let connectRetries: Int
  /** Nil: always connectable. Otherwise connectable for `connectableMs` after hearing a teammate. */
  let afterHearing: AfterHearing?
  let emptyScanFilter: Bool
  /** `low`, `medium` or `high`. */
  let advertiseInterval: String
  /** `low-latency`, `balanced` or `low-power`. */
  let scanMode: String
  /** A salt no key matched, or an advert heard alone, is handed up again only after this long. */
  let formSaltRepeatMs: Int64
  /** How long one GATT connection may take before it is tried again. */
  let connectTimeoutMs: Int64

  /** A jittered rotation period within the bounds, from a uniform draw in [0, 1). */
  func rotationMs(_ draw: Double) -> Int64 { rotateMinMs + Int64(Double(max(0, rotateMaxMs - rotateMinMs)) * draw) }

  static func of(_ map: [String: Any]) throws -> FindTunables {
    let min = try long(map, "rotateMinMs")
    let max = try long(map, "rotateMaxMs")
    if min <= 0 || max < min { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a rotation's bounds") }
    let connectable = map["connectable"]
    var after: AfterHearing?
    if connectable == nil || connectable is NSNull || connectable as? String == "always" {
      after = nil
    } else if let c = connectable as? [String: Any], c["mode"] as? String == "after-hearing" {
      after = AfterHearing(listenMs: try whole(c["listenMs"], "listenMs"), connectableMs: try whole(c["connectableMs"], "connectableMs"))
    } else {
      throw NearbyError(NearbyCode.BAD_ARGUMENT, "connectable")
    }
    let interval = map["advertiseInterval"] as? String
    let mode = map["scanMode"] as? String
    return FindTunables(
      rotateMinMs: min,
      rotateMaxMs: max,
      scanStartGapMs: try long(map, "scanStartGapMs"),
      scanRestartMs: try long(map, "scanRestartMs"),
      connectRetries: Int(Swift.min(Swift.max(try long(map, "connectRetries"), 0), 10)),
      afterHearing: after,
      emptyScanFilter: map["emptyScanFilter"] as? Bool == true,
      advertiseInterval: interval.flatMap { ["low", "medium", "high"].contains($0) ? $0 : nil } ?? "low",
      scanMode: mode.flatMap { ["low-latency", "balanced", "low-power"].contains($0) ? $0 : nil } ?? "low-latency",
      formSaltRepeatMs: number(map["formSaltRepeatMs"]).flatMap(int64) ?? 5_000,
      connectTimeoutMs: number(map["connectTimeoutMs"]).flatMap(int64) ?? 15_000
    )
  }

  static func links(_ map: [String: Any]) -> LinkTunables {
    let d = LinkTunables()
    func n(_ name: String, _ fallback: Int64, _ low: Int64, _ high: Int64) -> Int64 {
      let v = number(map[name]).flatMap(int64) ?? fallback
      return Swift.min(Swift.max(v, low), high)
    }
    return LinkTunables(
      queueMessages: Int(n("queueMessages", Int64(d.queueMessages), 1, 256)),
      fileChunk: Int(n("fileChunk", Int64(d.fileChunk), 1024, 512 * 1024)),
      fileWaitMs: n("fileWaitMs", d.fileWaitMs, 0, 120_000),
      pipeBytes: Int(n("pipeBytes", Int64(d.pipeBytes), 64 * 1024, 16 * 1024 * 1024)),
      byeWaitMs: n("byeWaitMs", d.byeWaitMs, 0, 10_000),
      byeDrainMs: n("byeDrainMs", d.byeDrainMs, 0, 10_000)
    )
  }

  /** A JavaScript number as Expo hands it over, whatever Swift type it arrived as. */
  static func number(_ value: Any?) -> Double? {
    switch value {
    case let d as Double: return d
    case let i as Int: return Double(i)
    case let i as Int64: return Double(i)
    case let i as Int32: return Double(i)
    case let f as Float: return Double(f)
    case let n as NSNumber: return n.doubleValue
    default: return nil
    }
  }

  /** Toward zero, as Kotlin's `toLong`; nil for what no `Int64` holds. */
  static func int64(_ d: Double) -> Int64? { d.isFinite && abs(d) < 9.2e18 ? Int64(d) : nil }

  private static func whole(_ value: Any?, _ name: String) throws -> Int64 {
    guard let d = number(value), let v = int64(d) else { throw NearbyError(NearbyCode.BAD_ARGUMENT, "\(name) is not a number") }
    return v
  }

  private static func long(_ map: [String: Any], _ name: String) throws -> Int64 {
    let v = try whole(map[name], name)
    if v < 0 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "\(name) is negative") }
    return v
  }
}
