import XCTest
@testable import NearbyLink

final class FramesTests: XCTestCase {
  private let frames = Vectors.json.obj("frames")
  private lazy var key = frames.bytes("key")

  func testNoncesAreFourZerosAndACounter() {
    for n in Vectors.json.objs("nonces") {
      XCTAssertEqual(n.str("hex"), Bytes.hex(Frame.nonce(n.u64("counter"))))
    }
  }

  func testSealingMatchesTheVectorsInOrder() throws {
    let sealer = try Sealer(key)
    for f in frames.objs("frames") {
      XCTAssertEqual(f.str("sealed"), Bytes.hex(try sealer.seal(UInt8(f.int("type")), f.bytes("body"))))
    }
  }

  func testOpeningReadsEachHeaderThenItsBody() throws {
    let opener = try Opener(key)
    for f in frames.objs("frames") {
      let sealed = f.bytes("sealed")
      let h = try opener.header(Array(sealed[0..<Frame.sealedHeader]))
      XCTAssertEqual(UInt8(f.int("type")), h.type)
      XCTAssertEqual(f.str("body").count / 2, h.len)
      XCTAssertEqual(h.len + Frame.tag, sealed.count - Frame.sealedHeader)
      XCTAssertEqual(f.str("body"), Bytes.hex(try opener.body(Array(sealed[Frame.sealedHeader...]))))
    }
  }

  func testALengthPastOneMebibyteIsRefusedOnceTheHeaderOpens() throws {
    let k = key
    expectCode(NearbyCode.FRAME_TOO_LARGE) { _ = try Opener(k).header(self.frames.bytes("overHeader")) }
    XCTAssertEqual(frames.int("max"), try Opener(key).header(frames.bytes("maxHeader")).len)
    expectCode(NearbyCode.MESSAGE_TOO_LARGE) { _ = try Sealer(k).seal(Frame.message, [UInt8](repeating: 0, count: Frame.max + 1)) }
  }

  func testAChangedByteFailsItsTag() {
    let sealed = frames.objs("frames")[0].bytes("sealed")
    let k = key
    for at in [0, 4, 20, 21, sealed.count - 1] {
      var bad = sealed
      bad[at] ^= 0x01
      expectCode(NearbyCode.TAG_FAILED) {
        let o = try Opener(k)
        _ = try o.header(Array(bad[0..<Frame.sealedHeader]))
        _ = try o.body(Array(bad[Frame.sealedHeader...]))
      }
    }
  }

  func testACutOrOutOfOrderFrameFails() throws {
    let list = frames.objs("frames")
    let first = list[0].bytes("sealed")
    let second = list[1].bytes("sealed")
    let k = key
    expectCode(NearbyCode.TAG_FAILED) { _ = try Opener(k).header(Array(first[0..<20])) }
    expectCode(NearbyCode.TAG_FAILED) { _ = try Opener(k).header(Array(second[0..<Frame.sealedHeader])) }
    let o = try Opener(key)
    _ = try o.header(Array(first[0..<Frame.sealedHeader]))
    expectCode(NearbyCode.TAG_FAILED) { _ = try o.body(Array(first[Frame.sealedHeader..<(first.count - 1)])) }
  }

  func testTheOtherDirectionsKeyOpensNothing() throws {
    let sealed = try Sealer(key).seal(Frame.message, Bytes.utf8("hi"))
    var other = key
    other[0] = 9
    expectCode(NearbyCode.TAG_FAILED) { _ = try Opener(other).header(Array(sealed[0..<Frame.sealedHeader])) }
  }

  func testEachSealTakesTheNextNonce() throws {
    let sealer = try Sealer(key)
    let a = try sealer.seal(Frame.message, [])
    let b = try sealer.seal(Frame.message, [])
    XCTAssertNotEqual(a, b)
  }

  func testAFrameKeyIs32Bytes() {
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try Sealer([UInt8](repeating: 1, count: 16)) }
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try Opener([UInt8](repeating: 1, count: 31)) }
  }

  /**
   * Why: `forget` drops the key when the link ends, while a writer may be sealing. A frame sealed
   * part or whole under a key that is gone would be a broken or readable frame, so forgetting waits
   * for a seal in progress, and every seal after it throws instead of sealing.
   */
  func testAForgottenSealerNeverSealsUnderAKeyThatIsGone() throws {
    let body = (0..<1024).map { UInt8(truncatingIfNeeded: $0) }
    for round in 0..<100 {
      let sealer = try Sealer(key)
      let out = Locked<[[UInt8]]>([])
      let refused = Locked<NearbyError?>(nil)
      let until = Locked<Int64>(Int64.max)
      let started = DispatchSemaphore(value: 0)
      let finished = DispatchSemaphore(value: 0)
      let writer = Thread {
        var signalled = false
        do {
          while nowMs() < until.get {
            let sealed = try sealer.seal(Frame.message, body)
            out.with { $0.append(sealed) }
            if !signalled {
              signalled = true
              started.signal()
            }
          }
        } catch let e as NearbyError {
          refused.set(e)
        } catch {}
        if !signalled { started.signal() }
        finished.signal()
      }
      writer.start()
      started.wait()
      if round % 2 == 1 { Thread.sleep(forTimeInterval: Double(round * 7919 % 300) / 1_000_000) }
      sealer.forget()
      until.set(nowMs() + 200)
      finished.wait()
      XCTAssertEqual(NearbyCode.LINK_CLOSED, refused.get?.code, "round \(round): a seal after forget throws")
      let opener = try Opener(key)
      for sealed in out.get {
        let h = try opener.header(Array(sealed[0..<Frame.sealedHeader]))
        XCTAssertEqual(body.count, h.len)
        XCTAssertEqual(body, try opener.body(Array(sealed[Frame.sealedHeader...])))
      }
    }
  }

  func testAForgottenOpenerOpensNothing() throws {
    let sealed = try Sealer(key).seal(Frame.message, [1])
    let opener = try Opener(key)
    opener.forget()
    expectCode(NearbyCode.LINK_CLOSED) { _ = try opener.header(Array(sealed[0..<Frame.sealedHeader])) }
  }

  func testFileBodiesCarryTheirIds() throws {
    let start = try Frame.readFileBody(try Frame.fileStartBody("t1", 300))
    XCTAssertEqual("t1", start.transferId)
    XCTAssertEqual(300, Bytes.readU64(start.rest, start.restFrom))
    let data = try Frame.readFileBody(try Frame.fileDataBody("t1", Vectors.pattern(10)))
    XCTAssertEqual(Vectors.pattern(10), Array(data.rest[data.restFrom...]))
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try Frame.fileEndBody("") }
    expectCode(NearbyCode.BAD_ARGUMENT) { _ = try Frame.fileEndBody(String(repeating: "x", count: 65)) }
    expectCode(NearbyCode.LINK_DROPPED) { _ = try Frame.readFileBody([5, 1]) }
  }

  func testTheFileBodiesMatchTheVectors() throws {
    let list = frames.objs("frames")
    XCTAssertEqual(list[2].str("body"), Bytes.hex(try Frame.fileStartBody("t1", 300)))
    XCTAssertEqual(list[3].str("body"), Bytes.hex(try Frame.fileDataBody("t1", Vectors.pattern(300))))
    XCTAssertEqual(list[4].str("body"), Bytes.hex(try Frame.fileEndBody("t1")))
    XCTAssertEqual(list[5].str("body"), Bytes.hex(try Frame.fileCancelBody("t2", Frame.noSpace)))
  }
}
