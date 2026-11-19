import XCTest
@testable import NearbyLink

final class StreamsTests: XCTestCase {
  private let pipe = Vectors.json.obj("pipe")

  func testTheChunkerCutsAtMtuMinusThreeUpTo512AndAddsNothing() throws {
    let stream = Vectors.pattern(pipe.int("streamBytes"))
    let chunks = pipe.obj("chunks")
    for (mtu, sizes) in chunks {
      let sizes = (sizes as! [Any]).map { ($0 as! NSNumber).intValue }
      let made = try GattChunks.split(stream, Int(mtu)!)
      XCTAssertEqual(sizes, made.map(\.count))
      XCTAssertEqual(stream, made.flatMap { $0 })
    }
    XCTAssertEqual(20, try GattChunks.sizeFor(23))
    XCTAssertEqual(512, try GattChunks.sizeFor(517))
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try GattChunks.sizeFor(3) }
  }

  func testTheChunkedWriterWritesOneValueAtATime() throws {
    var sent: [[UInt8]] = []
    try ChunkedWriter(mtu: { 23 }, send: { sent.append($0) }).write(Vectors.pattern(45))
    XCTAssertEqual([20, 20, 5], sent.map(\.count))
    var big: [[UInt8]] = []
    try ChunkedWriter(mtu: { 517 }, send: { big.append($0) }).write(Vectors.pattern(1200))
    XCTAssertEqual([512, 512, 176], big.map(\.count))
  }

  private func readAll(_ q: ByteQueue) throws -> [UInt8] {
    var out: [UInt8] = []
    var buf = [UInt8](repeating: 0, count: 64)
    while true {
      let n = try q.read(&buf, 0, buf.count)
      if n == 0 { return out }
      out.append(contentsOf: buf[0..<n])
    }
  }

  func testAQueueReadsInOrderThenTheEnd() throws {
    let q = ByteQueue(1000)
    for c in try GattChunks.split(Vectors.pattern(300), 23) { XCTAssertTrue(q.offer(c)) }
    q.end()
    XCTAssertEqual(Vectors.pattern(300), try readAll(q))
  }

  func testAQueueBreaksPastItsCapacity() throws {
    let q = ByteQueue(10)
    XCTAssertTrue(q.offer([UInt8](repeating: 0, count: 8)))
    XCTAssertFalse(q.offer([UInt8](repeating: 0, count: 8)))
    var buf = [UInt8](repeating: 0, count: 8)
    XCTAssertEqual(8, try q.read(&buf, 0, 8))
    XCTAssertThrowsError(try q.read(&buf, 0, 8)) { e in
      guard case TransportError.broken = e else { return XCTFail("a broken pipe, not \(e)") }
    }
  }

  func testAQueueReadTimesOut() {
    let q = ByteQueue(10)
    q.timeoutMs = 50
    var buf = [UInt8](repeating: 0, count: 1)
    XCTAssertThrowsError(try q.read(&buf, 0, 1)) { e in
      guard case TransportError.timeout = e else { return XCTFail("a timeout, not \(e)") }
    }
  }

  func testAQueueTellsWhenItDrained() throws {
    var drained = 0
    let q = ByteQueue(100) { drained += 1 }
    _ = q.offer([UInt8](repeating: 0, count: 10))
    var buf = [UInt8](repeating: 0, count: 10)
    _ = try q.read(&buf, 0, 10)
    XCTAssertEqual(1, drained)
  }

  func testAQueueWakesAReaderThatWaits() throws {
    let q = ByteQueue(100)
    let reading = background { () -> [UInt8] in
      var buf = [UInt8](repeating: 0, count: 4)
      let n = try q.read(&buf, 0, 4)
      return Array(buf[0..<n])
    }
    pause(20)
    _ = q.offer([1, 2, 3])
    XCTAssertEqual([1, 2, 3], try reading.get(ms: 5_000, timeout: NearbyCode.INTERNAL))
  }

  /**
   * Why: a pipe that ends removed whatever pipe sat at its device's address, so a device that had
   * reconnected lost its new pipe to the old one's close. A pipe removes itself only.
   */
  func testAPipeThatEndsRemovesItselfAndNotTheDevicesNewerPipe() {
    final class End {}
    let ends = PipeEnds<End>()
    let old = End()
    let newer = End()
    ends.put("AA", old)
    XCTAssertTrue(ends.remove("AA", end: old))
    ends.put("AA", newer)
    XCTAssertFalse(ends.remove("AA", end: old))
    XCTAssertTrue(ends["AA"] === newer)
    XCTAssertTrue(ends.remove("AA") === newer)
    XCTAssertNil(ends["AA"])
    ends.put("AA", old)
    ends.put("BB", newer)
    let all = ends.takeAll()
    XCTAssertEqual(2, all.count)
    XCTAssertTrue(all.contains { $0 === old } && all.contains { $0 === newer })
    XCTAssertNil(ends["BB"])
  }

  func testAPipeTransportReadsItsQueueAndWritesChunks() throws {
    let q = ByteQueue(1000)
    var sent: [[UInt8]] = []
    var closed = false
    let t = PipeTransport(queue: q, mtu: { 23 }, send: { sent.append($0) }, onClose: { closed = true })
    try t.write(Vectors.pattern(45))
    XCTAssertEqual([20, 20, 5], sent.map(\.count))
    _ = q.offer([7])
    var buf = [UInt8](repeating: 0, count: 4)
    XCTAssertEqual(1, try t.read(&buf, 0, 4))
    t.close()
    XCTAssertTrue(closed)
    XCTAssertEqual(0, try t.read(&buf, 0, 4))
  }
}
