import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/**
 * The link's frames (docs/nearby-sync-plan.md 5.12), as `Frames.kt` makes them: after `secure`,
 * each frame is a sealed header of 21 bytes (`u32be len || u8 type`) and a sealed body of
 * `len + 16` bytes, each AES-256-GCM with nonce `0^4 || u64be counter` per direction, header first,
 * no associated data. A sniffer sees no length prefix and no type byte. `len` is checked against
 * 1 MiB once the header opens, before the body is read or allocated. Any failure is final, and the
 * link closes. Pure: the package's XCTest runs it against `test-vectors.json`. The two frame keys
 * are the other kind of key native ever holds; they live in these objects only, and are never
 * logged.
 */
enum Frame {
  static let max = 1024 * 1024
  static let headerPlain = 5
  static let tag = 16
  static let sealedHeader = headerPlain + tag

  static let message: UInt8 = 1
  static let fileStart: UInt8 = 2
  static let fileData: UInt8 = 3
  static let fileEnd: UInt8 = 4
  static let fileCancel: UInt8 = 5
  static let bye: UInt8 = 6

  /** Why a file stopped: a `fileCancel` frame's last byte. */
  static let cancelled: UInt8 = 0
  static let tooBig: UInt8 = 1
  static let noSpace: UInt8 = 2
  static let unreadable: UInt8 = 3
  static let unwanted: UInt8 = 4

  static func nonce(_ counter: UInt64) -> [UInt8] { Bytes.concat([0, 0, 0, 0], Bytes.u64(counter)) }

  // ---- file bodies: u8 id length || id (1 to 64 bytes of UTF-8) || the rest ----

  private static func id(_ transferId: String) throws -> [UInt8] {
    let bytes = Bytes.utf8(transferId)
    if bytes.isEmpty || bytes.count > 64 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a transfer id is 1 to 64 bytes") }
    return Bytes.concat([UInt8(bytes.count)], bytes)
  }

  static func fileStartBody(_ transferId: String, _ size: UInt64) throws -> [UInt8] { Bytes.concat(try id(transferId), Bytes.u64(size)) }
  static func fileDataBody<C: Collection>(_ transferId: String, _ data: C) throws -> [UInt8] where C.Element == UInt8 {
    var out = try id(transferId)
    out.append(contentsOf: data)
    return out
  }
  static func fileEndBody(_ transferId: String) throws -> [UInt8] { try id(transferId) }
  static func fileCancelBody(_ transferId: String, _ reason: UInt8) throws -> [UInt8] { Bytes.concat(try id(transferId), [reason]) }

  struct FileBody {
    let transferId: String
    let rest: [UInt8]
    let restFrom: Int
  }

  /** The id and where the rest starts. Throws on a body too short for its id. */
  static func readFileBody(_ body: [UInt8]) throws -> FileBody {
    if body.isEmpty { throw NearbyError(NearbyCode.LINK_DROPPED, "a file frame with no id") }
    let n = Int(body[0])
    if n < 1 || n > 64 || body.count < 1 + n { throw NearbyError(NearbyCode.LINK_DROPPED, "a file frame with a broken id") }
    guard let text = String(bytes: body[1..<(1 + n)], encoding: .utf8) else { throw NearbyError(NearbyCode.LINK_DROPPED, "a file frame with a broken id") }
    return FileBody(transferId: text, rest: body, restFrom: 1 + n)
  }
}

/** Thrown by a `Sealer` or `Opener` once its key is forgotten: the link has ended. */
private func forgottenError() -> NearbyError { NearbyError(NearbyCode.LINK_CLOSED, "the link's keys are forgotten") }

/**
 * One direction's sealing. Every seal takes the next nonce; a nonce is never used twice. `forget`
 * waits for a seal in progress and every seal after it throws, so no frame, nor half of one, is
 * ever sealed under a key that is gone.
 */
final class Sealer {
  private var key: SymmetricKey?
  private var counter: UInt64 = 0
  private let lock = NSLock()

  init(_ key: [UInt8]) throws {
    if key.count != 32 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a frame key is 32 bytes") }
    self.key = SymmetricKey(data: key)
  }

  func seal(_ type: UInt8, _ body: [UInt8]) throws -> [UInt8] {
    lock.lock()
    defer { lock.unlock() }
    guard let k = key else { throw forgottenError() }
    if body.count > Frame.max { throw NearbyError(NearbyCode.MESSAGE_TOO_LARGE, "over the frame ceiling") }
    if counter > UInt64.max - 2 { throw NearbyError(NearbyCode.LINK_CLOSED, "the counter ran out") }
    let header = Bytes.concat(Bytes.u32(UInt32(body.count)), [type])
    do {
      let h = try AES.GCM.seal(header, using: k, nonce: AES.GCM.Nonce(data: Frame.nonce(counter)))
      counter += 1
      let b = try AES.GCM.seal(body, using: k, nonce: AES.GCM.Nonce(data: Frame.nonce(counter)))
      counter += 1
      var out = [UInt8]()
      out.reserveCapacity(Frame.sealedHeader + body.count + Frame.tag)
      out.append(contentsOf: h.ciphertext)
      out.append(contentsOf: h.tag)
      out.append(contentsOf: b.ciphertext)
      out.append(contentsOf: b.tag)
      return out
    } catch {
      throw NearbyError(NearbyCode.INTERNAL, "a frame could not be sealed")
    }
  }

  func forget() {
    lock.lock()
    key = nil
    lock.unlock()
  }
}

/** One direction's opening, in order. A failed tag throws `TAG_FAILED`, and the link closes. Forgotten, it opens nothing. */
final class Opener {
  private var key: SymmetricKey?
  private var counter: UInt64 = 0
  private let lock = NSLock()

  init(_ key: [UInt8]) throws {
    if key.count != 32 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a frame key is 32 bytes") }
    self.key = SymmetricKey(data: key)
  }

  struct Header {
    let len: Int
    let type: UInt8
  }

  func header(_ sealed: [UInt8]) throws -> Header {
    lock.lock()
    defer { lock.unlock() }
    if sealed.count != Frame.sealedHeader { throw NearbyError(NearbyCode.TAG_FAILED, "a sealed header is 21 bytes") }
    let plain = try open(sealed)
    let len = Bytes.readU32(plain, 0)
    if len > UInt32(Frame.max) { throw NearbyError(NearbyCode.FRAME_TOO_LARGE, "over the frame ceiling") }
    return Header(len: Int(len), type: plain[4])
  }

  func body(_ sealed: [UInt8]) throws -> [UInt8] {
    lock.lock()
    defer { lock.unlock() }
    return try open(sealed)
  }

  private func open(_ sealed: [UInt8]) throws -> [UInt8] {
    guard let k = key else { throw forgottenError() }
    if counter > UInt64.max - 1 { throw NearbyError(NearbyCode.LINK_CLOSED, "the counter ran out") }
    let at = counter
    counter += 1
    if sealed.count < Frame.tag { throw NearbyError(NearbyCode.TAG_FAILED, "shorter than a tag") }
    do {
      let cut = sealed.count - Frame.tag
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: Frame.nonce(at)), ciphertext: sealed[0..<cut], tag: sealed[cut...])
      return Array(try AES.GCM.open(box, using: k))
    } catch {
      // A failed tag, and any other way the library refuses: the same answer.
      throw NearbyError(NearbyCode.TAG_FAILED, "a frame failed its tag")
    }
  }

  func forget() {
    lock.lock()
    key = nil
    lock.unlock()
  }
}
