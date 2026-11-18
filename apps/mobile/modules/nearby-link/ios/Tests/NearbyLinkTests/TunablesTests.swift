import XCTest
@testable import NearbyLink

final class TunablesTests: XCTestCase {
  private let base: [String: Any] = [
    "rotateMinMs": 240000.0, "rotateMaxMs": 360000.0, "scanStartGapMs": 6000.0, "scanRestartMs": 1500000.0, "connectRetries": 3.0, "connectable": "always",
  ]

  private func with(_ key: String, _ value: Any?) -> [String: Any] {
    var m = base
    m[key] = value
    return m
  }

  func testReadsWhatJavaScriptSends() throws {
    let t = try FindTunables.of(base)
    XCTAssertEqual(240000, t.rotateMinMs)
    XCTAssertNil(t.afterHearing)
    XCTAssertEqual(240000, t.rotationMs(0))
    XCTAssertEqual(300000, t.rotationMs(0.5))
    XCTAssertEqual(5_000, t.formSaltRepeatMs)
    XCTAssertEqual(15_000, t.connectTimeoutMs)
    XCTAssertEqual("low", t.advertiseInterval)
    XCTAssertEqual("low-latency", t.scanMode)
    let after = try FindTunables.of(with("connectable", ["mode": "after-hearing", "listenMs": 1000.0, "connectableMs": 20000.0] as [String: Any]))
    XCTAssertEqual(FindTunables.AfterHearing(listenMs: 1000, connectableMs: 20000), after.afterHearing)
    // Numbers come as whatever Swift type Expo made of them.
    XCTAssertEqual(3, try FindTunables.of(with("connectRetries", 3)).connectRetries)
    XCTAssertEqual(10, try FindTunables.of(with("connectRetries", NSNumber(value: 40))).connectRetries)
    XCTAssertEqual(800, try FindTunables.of(with("formSaltRepeatMs", 800.0)).formSaltRepeatMs)
  }

  func testRefusesBrokenBounds() {
    var missing = base
    missing.removeValue(forKey: "scanStartGapMs")
    for bad in [with("rotateMaxMs", 1.0), missing, with("connectable", "sometimes"), with("rotateMinMs", 0.0), with("scanRestartMs", -1.0), with("rotateMinMs", Double.nan)] {
      expectCode(NearbyCode.BAD_ARGUMENT) { _ = try FindTunables.of(bad) }
    }
  }

  func testLinkTunablesKeepTheirBounds() {
    let t = FindTunables.links(["queueMessages": 0.0, "fileChunk": 10.0])
    XCTAssertEqual(1, t.queueMessages)
    XCTAssertEqual(1024, t.fileChunk)
    XCTAssertEqual(1_000, t.byeDrainMs)
    XCTAssertEqual(10_000, FindTunables.links(["byeDrainMs": 60_000.0]).byeDrainMs)
    XCTAssertEqual(LinkTunables().pipeBytes, FindTunables.links([:]).pipeBytes)
  }
}
