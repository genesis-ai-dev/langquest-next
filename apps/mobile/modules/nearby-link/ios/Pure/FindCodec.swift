import Foundation

/**
 * Find's bytes (docs/nearby-sync-plan.md 5.12, "Find"), as `FindCodec.kt` makes them: the advert,
 * the masked scan response and the GATT UUIDs, all version 4 UUIDs in canonical byte order, worked
 * out from `kFind` and the salt. Pure. `kFind` is one of the two kinds of key native ever holds;
 * nothing here keeps it past its caller, logs it or sends it. An iPhone sends only the advert
 * (section 7, phase 5), but reads Androids' scan responses and serves the same GATT service.
 */
enum FindCodec {
  static let saltBytes = 6
  static let rBytes = 2
  static let payloadBytes = 14
  static let uuidBytes = 16

  private static let find = Bytes.utf8("find")
  private static let sum = Bytes.utf8("sum")
  private static let gatt = Bytes.utf8("gatt")

  /** `v4(x)`: byte 6's top four bits 0100, byte 8's top two 10. */
  static func v4(_ x: [UInt8]) -> [UInt8] {
    precondition(x.count == uuidBytes, "a UUID is 16 bytes")
    var out = x
    out[6] = out[6] & 0x0f | 0x40
    out[8] = out[8] & 0x3f | 0x80
    return out
  }

  static func isV4(_ u: [UInt8]) -> Bool { u.count == uuidBytes && u[6] & 0xf0 == 0x40 && u[8] & 0xc0 == 0x80 }

  static func advertId(_ kFind: [UInt8], _ salt: [UInt8]) -> [UInt8] {
    precondition(salt.count == saltBytes, "a salt is 6 bytes")
    return v4(Bytes.concat(salt, Array(Bytes.hmacSha256(kFind, find, salt).prefix(10))))
  }

  static func scanResponse(_ kFind: [UInt8], _ salt: [UInt8], _ r: [UInt8], _ payload: [UInt8]) -> [UInt8] {
    precondition(r.count == rBytes, "r is 2 bytes")
    precondition(payload.count == payloadBytes, "a payload is 14 bytes")
    let mask = Bytes.hmacSha256(kFind, sum, salt, r)
    let masked = (0..<payloadBytes).map { payload[$0] ^ mask[$0] }
    return v4(Bytes.concat(r, masked))
  }

  struct Unmasked {
    let r: [UInt8]
    let tag: [UInt8]
    let summary: [UInt8]
    let echo: [UInt8]
  }

  /** The bits `v4` overwrote read as cleared, as the sender cleared them. */
  static func unmask(_ kFind: [UInt8], _ salt: [UInt8], _ response: [UInt8]) -> Unmasked {
    precondition(response.count == uuidBytes, "a UUID is 16 bytes")
    let r = Array(response[0..<rBytes])
    let mask = Bytes.hmacSha256(kFind, sum, salt, r)
    var p = (0..<payloadBytes).map { response[$0 + rBytes] ^ mask[$0] }
    p[4] &= 0x0f
    p[6] &= 0x3f
    return Unmasked(r: r, tag: Array(p[0..<6]), summary: Array(p[6..<10]), echo: Array(p[10..<14]))
  }

  /** The GATT service (0), the characteristic written to the advertiser (1), and the one it notifies on (2). */
  static func gattUuid(_ kFind: [UInt8], _ salt: [UInt8], _ which: UInt8) -> [UInt8] {
    precondition(which <= 2, "0, 1 or 2")
    return v4(Array(Bytes.hmacSha256(kFind, gatt, salt, [which]).prefix(uuidBytes)))
  }

  static func uuidOf(_ b: [UInt8]) -> UUID {
    precondition(b.count == uuidBytes, "a UUID is 16 bytes")
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
  }

  static func bytesOf(_ uuid: UUID) -> [UInt8] { withUnsafeBytes(of: uuid.uuid) { Array($0) } }
}

/** What the scanner hands up for one scan record. */
enum Heard {
  /** A teammate under `scanKeys[scan]`, unmasked. */
  case match(scan: Int, salt: [UInt8], response: FindCodec.Unmasked)
  /** An advert of this form that no key matched: its salt and nothing else. */
  case formSalt(salt: [UInt8])
  /**
   * A teammate's advert under `scanKeys[scan]` with no scan response: an iPhone's, which cannot
   * send one (docs/nearby-sync-plan.md section 7, phase 5), or an Android's whose response has not
   * come yet. Its salt alone, so the room can echo it.
   */
  case advert(scan: Int, salt: [UInt8])
}

/**
 * Matches scan records against every key in `scanKeys`, newest first (5.12, "Generations"), with
 * a cache per salt so a phone heard ten times a second costs one HMAC per key once, as
 * `FindMatcher` in `FindCodec.kt` does. Pure: the scanner gives it the record's service UUIDs, in
 * the record's order, and whether the record held anything else (a name, manufacturer or service
 * data), which no advert of this form does.
 */
final class FindMatcher {
  private var keys: [[UInt8]]
  private let cacheSize: Int
  private let lock = NSLock()

  private struct Cached {
    let id: [UInt8]
    let scan: Int
    var used: UInt64
  }

  private var cache: [String: Cached] = [:]
  private var clock: UInt64 = 0

  init(_ scanKeys: [[UInt8]], cacheSize: Int = 256) {
    keys = scanKeys
    self.cacheSize = cacheSize
  }

  /** The place in `scanKeys` of the key this advert id was made under, or -1. */
  func scanOf(_ id: [UInt8]) -> Int {
    if id.count != FindCodec.uuidBytes { return -1 }
    let salt = Array(id[0..<FindCodec.saltBytes])
    let name = Bytes.hex(salt)
    lock.lock()
    defer { lock.unlock() }
    clock += 1
    if var held = cache[name], Bytes.same(held.id, id) {
      held.used = clock
      cache[name] = held
      return held.scan
    }
    var scan = -1
    for (i, k) in keys.enumerated() where Bytes.same(FindCodec.advertId(k, salt), id) {
      scan = i
      break
    }
    cache[name] = Cached(id: id, scan: scan, used: clock)
    if cache.count > cacheSize, let oldest = cache.min(by: { $0.value.used < $1.value.used })?.key {
      cache.removeValue(forKey: oldest)
    }
    return scan
  }

  /**
   * A teammate when one UUID is an advert under a key and the other its scan response; a
   * teammate's advert alone when it matches a key with no scan response (an iPhone's, phase 5);
   * the salt alone when the record has this form and no key matches; nil otherwise.
   */
  func hear(_ uuids: [[UInt8]], otherData: Bool) -> Heard? {
    if otherData || uuids.isEmpty || uuids.count > 2 || !uuids.allSatisfy(FindCodec.isV4) { return nil }
    for (i, id) in uuids.enumerated() {
      let scan = scanOf(id)
      if scan < 0 { continue }
      let salt = Array(id[0..<FindCodec.saltBytes])
      if uuids.count < 2 { return .advert(scan: scan, salt: salt) }
      guard let key = keyAt(scan) else { return nil }
      return .match(scan: scan, salt: salt, response: FindCodec.unmask(key, salt, uuids[1 - i]))
    }
    return .formSalt(salt: Array(uuids[0][0..<FindCodec.saltBytes]))
  }

  /** Forgets every key: Find stopped. */
  func clear() {
    lock.lock()
    defer { lock.unlock() }
    for i in 0..<keys.count { Bytes.wipe(&keys[i]) }
    keys = []
    cache.removeAll()
  }

  /** A copy of the key at `scan`, or nil. */
  func keyAt(_ scan: Int) -> [UInt8]? {
    lock.lock()
    defer { lock.unlock() }
    return scan >= 0 && scan < keys.count ? keys[scan] : nil
  }
}
