import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif

/** Where a file may be: inside one of the app's own folders, compared by real paths. */
enum Paths {
  /** `..` and `.` taken out, and the links in the part that exists followed, as `File.canonicalPath` does. */
  static func canonical(_ url: URL) -> String {
    var head = url.standardizedFileURL.path
    var tail: [String] = []
    let fm = FileManager.default
    while head.count > 1 && !fm.fileExists(atPath: head) {
      tail.insert((head as NSString).lastPathComponent, at: 0)
      head = (head as NSString).deletingLastPathComponent
    }
    var resolved = head
    if let real = realpath(head, nil) {
      resolved = String(cString: real)
      free(real)
    }
    return tail.reduce(resolved) { ($0 as NSString).appendingPathComponent($1) }
  }

  static func inside(_ url: URL, _ roots: [URL]) -> Bool {
    let path = canonical(url)
    return roots.contains { root in
      var r = canonical(root)
      while r.hasSuffix("/") { r.removeLast() }
      return path.hasPrefix(r + "/")
    }
  }

  /** What the disk under `dir` has free for a file the app needs, or 0 when it cannot say. */
  static func freeBytes(_ dir: URL) -> Int64 {
    #if os(iOS) || os(macOS)
    if let v = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage { return v }
    #endif
    guard let attrs = try? FileManager.default.attributesOfFileSystem(forPath: dir.path) else { return 0 }
    switch attrs[.systemFreeSize] {
    case let n as Int64: return n
    case let n as UInt64: return Int64(clamping: n)
    case let n as Int: return Int64(n)
    case let n as NSNumber: return n.int64Value
    default: return 0
    }
  }
}

/**
 * Writes a teammate's file into its staging name (docs/nearby-sync-plan.md 5.6, 5.12), as
 * `PartWriter.kt` does: the exact `.part` path JavaScript gave, inside one of the roots native
 * allows (the app's own folders). It hashes with SHA-256 as it writes, stops past `maxBytes` and
 * when the disk would fall under `minFreeBytes`, syncs before it reports, deletes the file on any
 * failure, and never renames: JavaScript compares the hash and renames. Pure, with free space
 * passed in, so XCTest runs its limits.
 */
final class PartWriter {
  let target: URL
  private let maxBytes: Int64
  private let minFreeBytes: Int64
  private let freeBytes: (URL) -> Int64
  private var out: FileHandle?
  private var digest = SHA256()
  private var announced: Int64 = -1
  private(set) var written: Int64 = 0
  /** A cancel on another thread discards while the reader writes: each waits for the other. */
  private let lock = NSLock()

  init(_ target: URL, roots: [URL], maxBytes: Int64, minFreeBytes: Int64, freeBytes: @escaping (URL) -> Int64 = Paths.freeBytes) throws {
    self.target = target
    self.maxBytes = maxBytes
    self.minFreeBytes = minFreeBytes
    self.freeBytes = freeBytes
    if !target.lastPathComponent.hasSuffix(".part") { throw NearbyError(NearbyCode.STAGING_REFUSED, "a staging name ends .part") }
    if !Paths.inside(target, roots) { throw NearbyError(NearbyCode.STAGING_REFUSED, "a staging name outside the app's folders") }
    if maxBytes < 0 || minFreeBytes < 0 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "limits are not negative") }
  }

  struct Result {
    let size: Int64
    let sha256: String
  }

  private var folder: URL { target.deletingLastPathComponent() }

  /** The size the sender announced: refused before a byte is written if it cannot fit. */
  func begin(_ size: Int64) throws {
    lock.lock()
    defer { lock.unlock() }
    if out != nil { throw NearbyError(NearbyCode.TRANSFER_BUSY, "already begun") }
    if size < 0 || size > maxBytes { throw NearbyError(NearbyCode.FILE_TOO_BIG, "over the size limit") }
    // A folder that does not exist has no free space to read.
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    if freeBytes(folder) - size < minFreeBytes { throw NearbyError(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor") }
    announced = size
    guard FileManager.default.createFile(atPath: target.path, contents: nil), let handle = try? FileHandle(forWritingTo: target) else {
      throw NearbyError(NearbyCode.FILE_WRITE_FAILED, "could not open the staging file")
    }
    out = handle
  }

  func write(_ bytes: [UInt8], from: Int = 0, count: Int? = nil) throws {
    let n = count ?? bytes.count - from
    lock.lock()
    defer { lock.unlock() }
    guard let o = out else { throw NearbyError(NearbyCode.FILE_WRITE_FAILED, "not begun") }
    if written + Int64(n) > maxBytes || (announced >= 0 && written + Int64(n) > announced) {
      throw NearbyError(NearbyCode.FILE_TOO_BIG, "past the size limit")
    }
    if freeBytes(folder) - Int64(n) < minFreeBytes { throw NearbyError(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor") }
    let part = bytes[from..<(from + n)]
    do {
      try o.write(contentsOf: part)
    } catch {
      throw NearbyError(NearbyCode.FILE_WRITE_FAILED, "could not write the staging file")
    }
    digest.update(data: part)
    written += Int64(n)
  }

  /** Synced to the disk, then the size and hash. */
  func finish() throws -> Result {
    lock.lock()
    defer { lock.unlock() }
    guard let o = out else { throw NearbyError(NearbyCode.FILE_WRITE_FAILED, "not begun") }
    if announced >= 0 && written != announced { throw NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "not the size announced") }
    do {
      try o.synchronize()
      try o.close()
    } catch {
      throw NearbyError(NearbyCode.FILE_WRITE_FAILED, "could not finish the staging file")
    }
    out = nil
    return Result(size: written, sha256: Bytes.hex(Array(digest.finalize())))
  }

  /** Any failure: nothing is left behind. */
  func discard() {
    lock.lock()
    defer { lock.unlock() }
    try? out?.close()
    out = nil
    try? FileManager.default.removeItem(at: target)
  }
}
