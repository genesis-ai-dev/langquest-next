import XCTest
@testable import NearbyLink

/** A hosted network's links over in-memory streams, as awdl's listener hands them over (docs/nearby-sync-plan.md 5.12), ported from HostedTest.kt. */
final class HostedTests: XCTestCase {
  private var opened: [() -> Void] = []
  private let refused = Locked(0)
  private let tornDown = Locked(0)
  private let stoppedAccepting = Locked(0)
  private let keyA = [UInt8](repeating: 1, count: 32)
  private let keyB = [UInt8](repeating: 2, count: 32)

  override func tearDown() {
    opened.forEach { $0() }
    opened = []
  }

  private func session(_ t: Transport, _ id: String) -> LinkSession {
    let s = LinkSession(id: id, kind: "test", transport: t, tune: LinkTunables(), roots: [])
    opened.append { s.close() }
    return s
  }

  /** A phone reaching the network: the listener hands the far end to `accept` on its own thread. */
  private func connect(_ h: Hosted) -> MemoryEnd {
    let (mine, theirs) = MemoryEnd.pair()
    opened.append { mine.close() }
    DispatchQueue.global().async { h.accept(theirs) }
    return mine
  }

  private func hostedOn(_ candidates: Bool, adopt: ((Transport, Hosted) -> LinkSession)? = nil) -> Hosted {
    let h = Hosted(
      id: "h", kind: "test", details: [:], stopAccepting: { self.stoppedAccepting.with { $0 += 1 } }, teardown: { self.tornDown.with { $0 += 1 } },
      adopt: adopt ?? { t, _ in self.session(t, "host") }, refused: { _ in self.refused.with { $0 += 1 } }, candidates: candidates
    )
    opened.append { h.takeDown() }
    return h
  }

  private func next(_ h: Hosted) throws -> LinkSession { try background { try h.nextLink() }.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT) }

  private func noMore(_ h: Hosted, line: UInt = #line) {
    do {
      _ = try next(h)
      XCTFail("expected no more links", line: line)
    } catch let e as NearbyError {
      XCTAssertEqual(NearbyCode.HOST_TAKEN_DOWN, e.code, line: line)
    } catch {
      XCTFail("\(error)", line: line)
    }
  }

  /** Why: a network taken down while a connection was being adopted left that link open, and nobody would ever close it. */
  func testALinkAdoptedAsTheNetworkGoesDownIsClosed() {
    let made = Locked<LinkSession?>(nil)
    let h = hostedOn(false) { t, hosted in
      let s = self.session(t, "host")
      made.set(s)
      hosted.takeDown()
      return s
    }
    _ = connect(h)
    waitUntil("the link was adopted") { made.get != nil }
    waitUntil("the link adopted as the network went down was closed") { made.get?.isEnded == true }
    noMore(h)
    XCTAssertEqual(1, tornDown.get)
    XCTAssertEqual(1, stoppedAccepting.get)
  }

  func testWithoutCandidatesTheFirstConnectionTakesTheLinkAndALaterOneIsRefused() throws {
    let h = hostedOn(false)
    _ = connect(h)
    let first = try next(h)
    _ = connect(h)
    waitUntil("the second phone was refused and reported") { refused.get == 1 }
    noMore(h)
    XCTAssertTrue(h.endTakesDown(first))
  }

  /**
   * Why: awdl's service can be reached by anyone nearby, so a stranger could connect first and take
   * the link. Every connection is tried; the one that proves the keys is it.
   */
  func testWithCandidatesEveryConnectionIsTriedUntilOneProvesTheKeys() throws {
    let h = hostedOn(true)
    _ = connect(h) // a stranger, silent
    let stranger = try next(h)
    let teammate = session(connect(h), "teammate")
    let candidate = try next(h)
    XCTAssertFalse(stranger === candidate)
    try teammate.secure(keyA, keyB)
    try candidate.secure(keyB, keyA)
    try stranger.secure(keyB, keyA)
    try teammate.send([7])
    XCTAssertEqual([7], try candidate.receive())
    XCTAssertTrue(candidate.isProven)
    XCTAssertFalse(stranger.isProven)
    // The stranger's end takes nothing down; the link's would.
    XCTAssertFalse(h.endTakesDown(stranger))
    XCTAssertTrue(h.endTakesDown(candidate))
    stranger.close()
    // Settled: a later connection is refused and reported, and there are no more candidates.
    _ = connect(h)
    waitUntil("a connection after the link was settled was refused") { refused.get == 1 }
    noMore(h)
    XCTAssertEqual(0, tornDown.get)
  }

  /**
   * Why (security review, 2026-11-10): every candidate shares the attempt's keys, so the joiner's first frame copied onto
   * a second connection opened there too, and the second's goodbye then repeated the link's nonce under the same key.
   * Two joiners under the same keys send the same bytes, as a copy would.
   */
  func testOnlyTheFirstCandidateToProveTheKeysIsProvenAndACopyEndsWithNoGoodbye() throws {
    let h = hostedOn(true)
    let joiner = session(connect(h), "joiner")
    let first = try next(h)
    let copier = session(connect(h), "copier")
    let second = try next(h)
    for j in [joiner, copier] { try j.secure(keyA, keyB) }
    for c in [first, second] { try c.secure(keyB, keyA) }
    try joiner.send([7])
    XCTAssertEqual([7], try first.receive())
    try copier.send([7])
    waitUntil("the copy's connection ended") { second.isEnded }
    XCTAssertFalse(second.isProven)
    XCTAssertTrue(first.isProven)
    second.close()
    // Nothing sealed came back to the copier: a goodbye would read as a clean end (nil); its link only drops.
    expectCode(NearbyCode.LINK_DROPPED) { _ = try copier.receive() }
  }

  func testWithCandidatesOnlySoManyAreHeldAtOnce() throws {
    let h = hostedOn(true)
    for _ in 0..<4 {
      _ = connect(h)
      _ = try next(h)
    }
    let extra = connect(h)
    var one = [UInt8](repeating: 0, count: 1)
    XCTAssertEqual(0, try extra.read(&one, 0, 1), "a fifth candidate was closed")
    XCTAssertEqual(0, refused.get)
  }

  func testTakingDownEndsAWaitForTheNextLink() throws {
    let h = hostedOn(true)
    let waiting = background { try h.nextLink() }
    pause(50)
    h.takeDown()
    do {
      _ = try waiting.get(ms: 5_000, timeout: NearbyCode.PIPE_TIMEOUT)
      XCTFail("expected no more links")
    } catch let e as NearbyError {
      XCTAssertEqual(NearbyCode.HOST_TAKEN_DOWN, e.code)
    }
    h.takeDown()
    XCTAssertEqual(1, tornDown.get)
  }
}
