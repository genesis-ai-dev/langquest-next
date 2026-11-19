import XCTest
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
@testable import NearbyLink

/** A real pair over an in-memory stream, as a Wi-Fi link runs (docs/nearby-sync-plan.md section 8, Native), ported from LinkSessionTest.kt. */
final class LinkSessionTests: XCTestCase {
  private let keyA = [UInt8](repeating: 1, count: 32)
  private let keyB = [UInt8](repeating: 2, count: 32)
  private var opened: [LinkSession] = []
  private var root: URL!

  override func setUp() { root = scratchFolder() }

  override func tearDown() {
    opened.forEach { $0.close() }
    opened = []
    try? FileManager.default.removeItem(at: root)
  }

  /** Breaks the stream after `limit` bytes are written, as a link dropped mid-file. */
  private final class Breaking: Transport {
    let inner: Transport
    let limit: Int
    private let written = Locked(0)

    init(_ inner: Transport, _ limit: Int) {
      self.inner = inner
      self.limit = limit
    }

    func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int { try inner.read(&buffer, offset, count) }

    func write(_ bytes: [UInt8]) throws {
      let over = written.with { w -> Bool in
        if w + bytes.count > limit { return true }
        w += bytes.count
        return false
      }
      if over {
        inner.close()
        throw TransportError.broken("dropped")
      }
      try inner.write(bytes)
    }

    func setReadTimeout(_ ms: Int) { inner.setReadTimeout(ms) }
    func shutdownOutput() { inner.shutdownOutput() }
    func close() { inner.close() }
  }

  /** Reads fail in a way nobody foresaw. */
  private final class Failing: Transport {
    struct Odd: Error {}
    let inner: Transport
    init(_ inner: Transport) { self.inner = inner }
    func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int { throw Odd() }
    func write(_ bytes: [UInt8]) throws { try inner.write(bytes) }
    func setReadTimeout(_ ms: Int) {}
    func shutdownOutput() {}
    func close() { inner.close() }
  }

  private struct Pair {
    let a: LinkSession
    let b: LinkSession
    let ta: MemoryEnd
    let tb: MemoryEnd
  }

  private func pair(_ tune: LinkTunables = LinkTunables(), breakAfter: Int? = nil, free: @escaping (URL) -> Int64 = { _ in Int64.max }) -> Pair {
    let (ta, tb) = MemoryEnd.pair()
    let wrapped: Transport = breakAfter.map { Breaking(ta, $0) } ?? ta
    let a = LinkSession(id: "a", kind: "test", transport: wrapped, tune: tune, roots: [root], freeBytes: free)
    let b = LinkSession(id: "b", kind: "test", transport: tb, tune: tune, roots: [root], freeBytes: free)
    opened += [a, b]
    return Pair(a: a, b: b, ta: ta, tb: tb)
  }

  private func secure(_ p: Pair) throws {
    try p.a.secure(keyA, keyB)
    try p.b.secure(keyB, keyA)
  }

  /** `a` hears a frame of `b`'s, so it holds the keys `b` holds and may seal a goodbye. */
  private func prove(_ a: LinkSession, _ b: LinkSession) throws {
    try b.send(Bytes.utf8("ready"))
    XCTAssertEqual(Bytes.utf8("ready"), try a.receive())
  }

  private func text(_ bytes: [UInt8]?) -> String? { bytes.map { String(decoding: $0, as: UTF8.self) } }

  /** The call (on another thread) failed with a `NearbyError` whose code is one of `codes`. */
  private func expectFuture<T>(_ f: Future<T>, _ codes: NearbyCode..., line: UInt = #line) {
    do {
      _ = try f.get(ms: 10_000, timeout: NearbyCode.PIPE_TIMEOUT)
      XCTFail("expected \(codes)", line: line)
    } catch let e as NearbyError {
      XCTAssertTrue(codes.contains(e.code), "\(e.code)", line: line)
    } catch {
      XCTFail("\(error)", line: line)
    }
  }

  /**
   * Why: a reader that failed in an unforeseen way ends the link `INTERNAL`, and a call waiting on
   * it rejected `INTERNAL` too, which JavaScript reads as a failure, not a drop. A call on a link
   * that went always rejects with a drop code; how it went is `onEnded`'s.
   */
  func testACallOnALinkWhoseReaderFailedRejectsAsADrop() throws {
    let (ta, tb) = MemoryEnd.pair()
    let endedWith = Future<NearbyCode>()
    let a = LinkSession(id: "a", kind: "test", transport: ta, tune: LinkTunables(), roots: [root])
    let b = LinkSession(id: "b", kind: "test", transport: Failing(tb), tune: LinkTunables(), roots: [root], onEnded: { _, code in endedWith.complete(code) })
    opened += [a, b]
    try a.secure(keyA, keyB)
    try b.secure(keyB, keyA)
    let waiting = background { try b.receive() }
    do {
      _ = try waiting.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT)
      XCTFail("expected the receive to fail")
    } catch let e as NearbyError {
      XCTAssertTrue(DROP_CODES.contains(e.code), "\(e.code)")
    }
    XCTAssertEqual(NearbyCode.INTERNAL, try endedWith.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT))
    expectCode(NearbyCode.LINK_CLOSED, NearbyCode.LINK_DROPPED, NearbyCode.TAG_FAILED, NearbyCode.FRAME_TOO_LARGE, NearbyCode.LINK_UNKNOWN, NearbyCode.STOPPED) {
      try b.send([1])
    }
  }

  func testTheOpeningIsRawBytesThenMessagesAreSealed() throws {
    let p = pair()
    try p.a.sendOpening(Vectors.pattern(80))
    XCTAssertEqual(Vectors.pattern(80), try p.b.receiveOpening(80, deadlineMs: 2000))
    try p.b.sendOpening(Vectors.pattern(80).reversed())
    XCTAssertEqual(Vectors.pattern(80).reversed(), try p.a.receiveOpening(80, deadlineMs: 2000))
    try secure(p)
    try p.a.send(Bytes.utf8("hello"))
    try p.a.send([UInt8](repeating: 0, count: Frame.max))
    XCTAssertEqual("hello", text(try p.b.receive()))
    XCTAssertEqual(Frame.max, try p.b.receive()?.count)
    try p.b.send(Bytes.utf8("back"))
    XCTAssertEqual("back", text(try p.a.receive()))
  }

  func testTheOpeningIsTheBytesTheOtherSideWroteWhateverTheChunks() throws {
    let p = pair()
    let opening = Vectors.pattern(80)
    let writing = background { () -> Void in
      for c in try GattChunks.split(opening, 23) {
        try p.ta.write(c)
        pause(2)
      }
    }
    XCTAssertEqual(opening, try p.b.receiveOpening(80, deadlineMs: 5000))
    _ = try writing.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT)
  }

  func testAnOpeningNotSentByTheDeadlineIsNil() throws {
    let p = pair()
    let started = nowMs()
    XCTAssertNil(try p.b.receiveOpening(80, deadlineMs: 200))
    XCTAssertLessThan(nowMs() - started, 2000)
    // And once the other side has gone, at once.
    p.ta.close()
    XCTAssertNil(try p.b.receiveOpening(80, deadlineMs: 5000))
  }

  func testNoFrameIsPlainAndSecureIsOnce() throws {
    let p = pair()
    expectCode(NearbyCode.NOT_SECURED) { try p.a.send([0]) }
    expectCode(NearbyCode.NOT_SECURED) { _ = try p.a.receive() }
    try secure(p)
    let (ka, kb) = (keyA, keyB)
    expectCode(NearbyCode.ALREADY_SECURED) { try p.a.secure(ka, kb) }
    expectCode(NearbyCode.OPENING_AFTER_SECURE) { try p.a.sendOpening([0]) }
    expectCode(NearbyCode.OPENING_AFTER_SECURE) { _ = try p.a.receiveOpening(1, deadlineMs: 10) }
    expectCode(NearbyCode.MESSAGE_TOO_LARGE) { try p.a.send([UInt8](repeating: 0, count: Frame.max + 1)) }
  }

  func testACleanCloseIsNilAndADropIsAnError() throws {
    let p = pair()
    try secure(p)
    try prove(p.a, p.b)
    try p.a.send(Bytes.utf8("last"))
    p.a.close()
    XCTAssertEqual("last", text(try p.b.receive()))
    XCTAssertNil(try p.b.receive())
    expectCode(NearbyCode.LINK_CLOSED) { _ = try p.a.receive() }

    let q = pair()
    try secure(q)
    let waiting = background { try q.b.receive() }
    // No goodbye: the stream just goes.
    q.ta.close()
    expectFuture(waiting, NearbyCode.LINK_DROPPED)
  }

  func testMessagesQueuedBeforeAGoodbyeAreStillReadThenNil() throws {
    let p = pair()
    try secure(p)
    try prove(p.a, p.b)
    try p.a.send(Bytes.utf8("one"))
    try p.a.send(Bytes.utf8("two"))
    p.a.close()
    // The goodbye is read before anyone asks, as on a phone whose JavaScript is busy.
    waitUntil("the goodbye arrives") { p.b.isEnded }
    XCTAssertEqual("one", text(try p.b.receive()))
    XCTAssertEqual("two", text(try p.b.receive()))
    XCTAssertNil(try p.b.receive())
    XCTAssertNil(try p.b.receive())
  }

  func testACloseWithUnreadBytesStillSaysGoodbye() throws {
    for _ in 0..<10 {
      var tune = LinkTunables()
      tune.queueMessages = 1
      let p = pair(tune)
      try secure(p)
      // b sends more than a reads, so bytes sit unread on a's side when it closes.
      let flooding = background { () -> Void in
        while (try? p.b.send([UInt8](repeating: 0, count: 64 * 1024))) != nil {}
      }
      waitUntil("a's side fills") { p.a.queuedMessages > 0 }
      pause(20)
      try p.a.send(Bytes.utf8("last"))
      p.a.close()
      XCTAssertEqual("last", text(try p.b.receive()))
      XCTAssertNil(try p.b.receive())
      _ = try flooding.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT)
    }
  }

  /**
   * Why: awdl and a hotspot hand up every connection under one attempt's keys, and each starts its
   * nonces at zero, so a goodbye sealed on a stranger's connection would repeat the real link's
   * nonce under the same key. Nothing sealed goes out on a link whose other side has not proven the keys.
   */
  func testALinkNobodyProvedClosesWithNoGoodbye() throws {
    let p = pair()
    try p.a.secure(keyA, keyB)
    p.a.close()
    var one = [UInt8](repeating: 0, count: 1)
    XCTAssertEqual(0, try p.tb.read(&one, 0, 1))

    let q = pair()
    try secure(q)
    try prove(q.a, q.b)
    q.a.close()
    XCTAssertNil(try q.b.receive())
  }

  func testTheWrongKeyClosesTheLink() throws {
    let p = pair()
    try p.a.secure(keyA, keyB)
    try p.b.secure([UInt8](repeating: 7, count: 32), [UInt8](repeating: 8, count: 32))
    try p.a.send(Bytes.utf8("x"))
    expectCode(NearbyCode.TAG_FAILED) { _ = try p.b.receive() }
  }

  func testAFrameTypeFromALaterBuildIsSkipped() throws {
    let p = pair()
    try p.b.secure(keyB, keyA)
    // a's side by hand: one frame of type 9, then a message.
    let sealer = try Sealer(keyA)
    try p.ta.write(try sealer.seal(9, [1, 2, 3]))
    try p.ta.write(try sealer.seal(Frame.message, Bytes.utf8("after")))
    XCTAssertEqual("after", text(try p.b.receive()))
  }

  func testMoves50MegabytesEncryptedAndHashed() throws {
    let p = pair()
    try secure(p)
    let size = 50 * 1024 * 1024
    let source = root.appendingPathComponent("source.m4a")
    var digest = SHA256()
    _ = FileManager.default.createFile(atPath: source.path, contents: nil)
    let out = try FileHandle(forWritingTo: source)
    let chunk = Vectors.pattern(1 << 20)
    for _ in 0..<50 {
      try out.write(contentsOf: chunk)
      digest.update(data: chunk)
    }
    try out.close()
    let staging = root.appendingPathComponent("blobs/x.m4a.nearby.part")
    let receiving = background { try p.b.receiveFile("t1", staging, maxBytes: Int64(size), minFreeBytes: 0) }
    // Messages keep moving beside the file, and the other side reads them as they come, as a session does.
    let chatting = background { () -> Void in for i in 0..<20 { try p.a.send(Bytes.utf8("m\(i)")) } }
    let reading = background { try (0..<20).map { _ in String(decoding: try p.b.receive()!, as: UTF8.self) } }
    try p.a.sendFile("t1", source, Int64(size))
    let result = try receiving.get(ms: 120_000, timeout: NearbyCode.PIPE_TIMEOUT)
    _ = try chatting.get(ms: 10_000, timeout: NearbyCode.PIPE_TIMEOUT)
    XCTAssertEqual((0..<20).map { "m\($0)" }, try reading.get(ms: 10_000, timeout: NearbyCode.PIPE_TIMEOUT))
    XCTAssertEqual(Int64(size), result.size)
    XCTAssertEqual(Bytes.hex(Array(digest.finalize())), result.sha256)
    XCTAssertEqual(Int64(size), ((try FileManager.default.attributesOfItem(atPath: staging.path))[.size] as? NSNumber)?.int64Value)
  }

  func testADropMidFileFailsBothSidesAndLeavesNoPart() throws {
    let p = pair(breakAfter: 3 * 1024 * 1024)
    try secure(p)
    let source = root.appendingPathComponent("big.m4a")
    _ = FileManager.default.createFile(atPath: source.path, contents: Data(count: 8 * 1024 * 1024))
    let staging = root.appendingPathComponent("blobs/big.m4a.nearby.part")
    let receiving = background { try p.b.receiveFile("t1", staging, maxBytes: Int64.max, minFreeBytes: 0) }
    expectCode(NearbyCode.LINK_DROPPED) { try p.a.sendFile("t1", source, 8 * 1024 * 1024) }
    expectFuture(receiving, NearbyCode.LINK_DROPPED)
    XCTAssertFalse(FileManager.default.fileExists(atPath: staging.path))
  }

  func testAFileTooBigIsRefusedAndTheSenderIsTold() throws {
    let p = pair()
    try secure(p)
    let source = root.appendingPathComponent("s.m4a")
    _ = FileManager.default.createFile(atPath: source.path, contents: Data(count: 5000))
    let staging = root.appendingPathComponent("blobs/s.part")
    let receiving = background { try p.b.receiveFile("t1", staging, maxBytes: 1000, minFreeBytes: 0) }
    pause(100) // the receiver registers first, as JavaScript does before it asks
    do {
      try p.a.sendFile("t1", source, 5000)
    } catch let e as NearbyError {
      XCTAssertEqual(NearbyCode.FILE_REFUSED, e.code)
    }
    expectFuture(receiving, NearbyCode.FILE_TOO_BIG)
    XCTAssertFalse(FileManager.default.fileExists(atPath: staging.path))
    // The link is still good.
    try p.a.send(Bytes.utf8("still here"))
    XCTAssertEqual("still here", text(try p.b.receive()))
  }

  func testAFileNobodyAskedForIsRefused() throws {
    var tune = LinkTunables()
    tune.fileWaitMs = 100
    let p = pair(tune)
    try secure(p)
    let source = root.appendingPathComponent("u.m4a")
    _ = FileManager.default.createFile(atPath: source.path, contents: Data(count: 300_000))
    do {
      try p.a.sendFile("t9", source, 300_000)
    } catch let e as NearbyError {
      XCTAssertEqual(NearbyCode.FILE_REFUSED, e.code)
    }
    try p.a.send(Bytes.utf8("next"))
    XCTAssertEqual("next", text(try p.b.receive()))
  }

  func testCancellingAReceiveStopsItAndDeletesThePart() throws {
    let p = pair()
    try secure(p)
    let staging = root.appendingPathComponent("blobs/c.part")
    let receiving = background { try p.b.receiveFile("t1", staging, maxBytes: 1000, minFreeBytes: 0) }
    pause(100)
    p.b.cancelFile("t1")
    expectFuture(receiving, NearbyCode.FILE_CANCELLED)
    XCTAssertFalse(FileManager.default.fileExists(atPath: staging.path))
  }

  func testAFileOutsideTheAppsFoldersIsNotSent() throws {
    let p = pair()
    try secure(p)
    let elsewhere = scratchFolder()
    defer { try? FileManager.default.removeItem(at: elsewhere) }
    let outside = elsewhere.appendingPathComponent("outside.m4a")
    _ = FileManager.default.createFile(atPath: outside.path, contents: Data(count: 10))
    expectCode(NearbyCode.FILE_UNREADABLE) { try p.a.sendFile("t1", outside, 10) }
    // And a file of the wrong size is not sent either.
    let inside = root.appendingPathComponent("inside.m4a")
    _ = FileManager.default.createFile(atPath: inside.path, contents: Data(count: 10))
    expectCode(NearbyCode.FILE_SIZE_MISMATCH) { try p.a.sendFile("t1", inside, 11) }
  }

  func testEveryWaitEndsWhenTheLinkCloses() throws {
    let p = pair()
    try secure(p)
    let waiting = background { try p.b.receive() }
    let file = background { try p.b.receiveFile("t1", self.root.appendingPathComponent("blobs/w.part"), maxBytes: 10, minFreeBytes: 0) }
    pause(50)
    p.b.close()
    expectFuture(waiting, NearbyCode.LINK_CLOSED)
    expectFuture(file, NearbyCode.LINK_CLOSED)
    expectCode(NearbyCode.LINK_CLOSED) { try p.b.send([1]) }
  }
}
