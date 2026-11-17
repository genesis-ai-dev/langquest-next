import XCTest
@testable import NearbyLink

final class PartWriterTests: XCTestCase {
  private let files = Vectors.json.obj("files")
  private var root: URL!

  override func setUp() { root = scratchFolder() }
  override func tearDown() { try? FileManager.default.removeItem(at: root) }

  private func target(_ name: String = "abc.m4a.nearby.part") -> URL { root.appendingPathComponent("blobs").appendingPathComponent(name) }

  private func size(_ url: URL) -> Int64 { ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? -1 }

  func testWritesHashesAndSyncsAFile() throws {
    let bytes = Vectors.pattern(files.int("bytes"))
    let w = try PartWriter(target(), roots: [root], maxBytes: 1_000_000, minFreeBytes: 0)
    try w.begin(Int64(bytes.count))
    var at = 0
    while at < bytes.count {
      let n = min(65536, bytes.count - at)
      try w.write(bytes, from: at, count: n)
      at += n
    }
    let r = try w.finish()
    XCTAssertEqual(Int64(bytes.count), r.size)
    XCTAssertEqual(files.str("sha256"), r.sha256)
    XCTAssertEqual(Int64(bytes.count), size(target()))
  }

  func testAnEmptyFileHasTheEmptyHash() throws {
    let w = try PartWriter(target(), roots: [root], maxBytes: 10, minFreeBytes: 0)
    try w.begin(0)
    XCTAssertEqual(files.str("empty"), try w.finish().sha256)
  }

  func testRefusesANameThatIsNotAPartOrOutsideTheRoots() throws {
    let r = root!
    expectCode(NearbyCode.STAGING_REFUSED) { _ = try PartWriter(r.appendingPathComponent("abc.m4a"), roots: [r], maxBytes: 10, minFreeBytes: 0) }
    expectCode(NearbyCode.STAGING_REFUSED) { _ = try PartWriter(r.appendingPathComponent("../elsewhere/x.part"), roots: [r], maxBytes: 10, minFreeBytes: 0) }
    let other = r.appendingPathComponent("other")
    try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)
    expectCode(NearbyCode.STAGING_REFUSED) { _ = try PartWriter(other.appendingPathComponent("x.part"), roots: [r.appendingPathComponent("blobs")], maxBytes: 10, minFreeBytes: 0) }
    // A link inside a root that leads out of it is outside.
    let outside = scratchFolder()
    defer { try? FileManager.default.removeItem(at: outside) }
    try FileManager.default.createSymbolicLink(at: r.appendingPathComponent("away"), withDestinationURL: outside)
    expectCode(NearbyCode.STAGING_REFUSED) { _ = try PartWriter(r.appendingPathComponent("away/x.part"), roots: [r], maxBytes: 10, minFreeBytes: 0) }
    // A root reached through a link is the same root.
    let alias = outside.appendingPathComponent("alias")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: r)
    XCTAssertNoThrow(try PartWriter(alias.appendingPathComponent("blobs/y.part"), roots: [r], maxBytes: 10, minFreeBytes: 0))
  }

  func testStopsPastMaxBytesAndLeavesNothing() throws {
    let t = target()
    let r = root!
    expectCode(NearbyCode.FILE_TOO_BIG) { try PartWriter(t, roots: [r], maxBytes: 10, minFreeBytes: 0).begin(11) }
    let w = try PartWriter(t, roots: [r], maxBytes: 10, minFreeBytes: 0)
    try w.begin(10)
    try w.write([UInt8](repeating: 0, count: 6))
    expectCode(NearbyCode.FILE_TOO_BIG) { try w.write([UInt8](repeating: 0, count: 6)) }
    w.discard()
    XCTAssertFalse(FileManager.default.fileExists(atPath: t.path))
  }

  func testStopsWhenTheDiskWouldFallUnderItsFloor() throws {
    let t = target()
    let r = root!
    let free = Locked<Int64>(1000)
    expectCode(NearbyCode.FILE_NO_SPACE) { try PartWriter(t, roots: [r], maxBytes: 10_000, minFreeBytes: 500, freeBytes: { _ in free.get }).begin(600) }
    let w = try PartWriter(t, roots: [r], maxBytes: 10_000, minFreeBytes: 500, freeBytes: { _ in free.get })
    try w.begin(400)
    try w.write([UInt8](repeating: 0, count: 100))
    free.set(550)
    expectCode(NearbyCode.FILE_NO_SPACE) { try w.write([UInt8](repeating: 0, count: 100)) }
    w.discard()
    XCTAssertFalse(FileManager.default.fileExists(atPath: t.path))
  }

  func testRefusesAFileThatIsNotTheSizeAnnounced() throws {
    let r = root!
    let w = try PartWriter(target(), roots: [r], maxBytes: 100, minFreeBytes: 0)
    try w.begin(10)
    try w.write([UInt8](repeating: 0, count: 5))
    expectCode(NearbyCode.FILE_SIZE_MISMATCH) { _ = try w.finish() }
    let b = target("b.part")
    expectCode(NearbyCode.FILE_TOO_BIG) {
      let other = try PartWriter(b, roots: [r], maxBytes: 100, minFreeBytes: 0)
      try other.begin(3)
      try other.write([UInt8](repeating: 0, count: 4))
    }
  }

  func testBeginsOnce() throws {
    let w = try PartWriter(target(), roots: [root], maxBytes: 100, minFreeBytes: 0)
    try w.begin(1)
    expectCode(NearbyCode.TRANSFER_BUSY) { try w.begin(1) }
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try PartWriter(self.target("c.part"), roots: [self.root], maxBytes: -1, minFreeBytes: 0) }
  }
}
