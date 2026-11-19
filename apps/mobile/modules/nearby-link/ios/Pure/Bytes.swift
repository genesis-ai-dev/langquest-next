import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/**
 * Byte helpers for the nearby link (docs/nearby-sync-plan.md 5.12), as `Bytes.kt` is on Android.
 * Pure Swift on Foundation and CryptoKit (swift-crypto off Apple's systems), so the package in
 * this folder runs them on Linux as a phone does. Bytes are `[UInt8]` throughout: a `Data` slice
 * keeps its parent's indices, which is a mistake waiting to happen.
 */
enum Bytes {
  private static let hexDigits = Array("0123456789abcdef".utf8)
  private static let b64 = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

  static func hex(_ bytes: [UInt8]) -> String {
    var out = [UInt8]()
    out.reserveCapacity(bytes.count * 2)
    for b in bytes {
      out.append(hexDigits[Int(b >> 4)])
      out.append(hexDigits[Int(b & 0x0f)])
    }
    return String(decoding: out, as: UTF8.self)
  }

  /** Nil for anything that is not lower or upper case hex of whole bytes. */
  static func unhex(_ text: String) -> [UInt8]? {
    let chars = Array(text.utf8)
    if chars.count % 2 != 0 { return nil }
    func digit(_ c: UInt8) -> UInt8? {
      switch c {
      case 0x30...0x39: return c - 0x30
      case 0x61...0x66: return c - 0x61 + 10
      case 0x41...0x46: return c - 0x41 + 10
      default: return nil
      }
    }
    var out = [UInt8]()
    out.reserveCapacity(chars.count / 2)
    var i = 0
    while i < chars.count {
      guard let hi = digit(chars[i]), let lo = digit(chars[i + 1]) else { return nil }
      out.append(hi << 4 | lo)
      i += 2
    }
    return out
  }

  /** Base64url with no padding, as every byte string in a native callback is (5.12). */
  static func b64url(_ bytes: [UInt8]) -> String {
    var out = [UInt8]()
    out.reserveCapacity((bytes.count * 4 + 2) / 3)
    var i = 0
    while i < bytes.count {
      let b0 = UInt32(bytes[i])
      let b1 = i + 1 < bytes.count ? UInt32(bytes[i + 1]) : 0
      let b2 = i + 2 < bytes.count ? UInt32(bytes[i + 2]) : 0
      let n = b0 << 16 | b1 << 8 | b2
      let left = bytes.count - i
      out.append(b64[Int(n >> 18 & 63)])
      out.append(b64[Int(n >> 12 & 63)])
      if left > 1 { out.append(b64[Int(n >> 6 & 63)]) }
      if left > 2 { out.append(b64[Int(n & 63)]) }
      i += 3
    }
    return String(decoding: out, as: UTF8.self)
  }

  /** Nil for anything that is not base64url with no padding. */
  static func unb64url(_ text: String) -> [UInt8]? {
    let chars = Array(text.utf8)
    if chars.count % 4 == 1 { return nil }
    var out = [UInt8]()
    out.reserveCapacity(chars.count * 3 / 4)
    var acc: UInt32 = 0
    var bits = 0
    for c in chars {
      guard let v = b64.firstIndex(of: c) else { return nil }
      acc = (acc << 6 | UInt32(v)) & 0xffffff
      bits += 6
      if bits >= 8 {
        bits -= 8
        out.append(UInt8(truncatingIfNeeded: acc >> UInt32(bits)))
      }
    }
    // The bits left over must be zero, or two texts would read as one value.
    if bits > 0 && acc & ((1 << UInt32(bits)) - 1) != 0 { return nil }
    return out
  }

  static func concat(_ parts: [UInt8]...) -> [UInt8] {
    var out = [UInt8]()
    out.reserveCapacity(parts.reduce(0) { $0 + $1.count })
    for p in parts { out.append(contentsOf: p) }
    return out
  }

  static func utf8(_ text: String) -> [UInt8] { Array(text.utf8) }

  static func hmacSha256(_ key: [UInt8], _ parts: [UInt8]...) -> [UInt8] {
    var mac = HMAC<SHA256>(key: SymmetricKey(data: key))
    for p in parts { mac.update(data: p) }
    return Array(mac.finalize())
  }

  static func sha256(_ bytes: [UInt8]) -> [UInt8] { Array(SHA256.hash(data: bytes)) }

  /** The whole length, whatever differs first. */
  static func same(_ a: [UInt8], _ b: [UInt8]) -> Bool {
    if a.count != b.count { return false }
    var diff: UInt8 = 0
    for i in 0..<a.count { diff |= a[i] ^ b[i] }
    return diff == 0
  }

  static func u32(_ value: UInt32) -> [UInt8] {
    [UInt8(truncatingIfNeeded: value >> 24), UInt8(truncatingIfNeeded: value >> 16), UInt8(truncatingIfNeeded: value >> 8), UInt8(truncatingIfNeeded: value)]
  }

  static func readU32(_ bytes: [UInt8], _ at: Int) -> UInt32 {
    UInt32(bytes[at]) << 24 | UInt32(bytes[at + 1]) << 16 | UInt32(bytes[at + 2]) << 8 | UInt32(bytes[at + 3])
  }

  static func u64(_ value: UInt64) -> [UInt8] {
    (0..<8).map { UInt8(truncatingIfNeeded: value >> UInt64(56 - 8 * $0)) }
  }

  static func readU64(_ bytes: [UInt8], _ at: Int) -> UInt64 {
    var v: UInt64 = 0
    for i in 0..<8 { v = v << 8 | UInt64(bytes[at + i]) }
    return v
  }

  /** Zeroes a key this module holds, once it is done with it. */
  static func wipe(_ bytes: inout [UInt8]) {
    for i in 0..<bytes.count { bytes[i] = 0 }
  }

  /**
   * Zeroes the storage of a `Data` handed in from JavaScript, as the Kotlin zeroes its `ByteArray`
   * argument: in place, since the module is its only holder once the call has it.
   */
  static func wipe(_ data: Data) {
    guard data.count > 0 else { return }
    data.withUnsafeBytes { raw in
      guard let base = raw.baseAddress else { return }
      memset(UnsafeMutableRawPointer(mutating: base), 0, raw.count)
    }
  }
}
