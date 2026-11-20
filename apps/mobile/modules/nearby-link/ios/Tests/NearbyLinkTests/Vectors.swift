import Foundation
import XCTest
@testable import NearbyLink

/**
 * `test-vectors.json`, which `src/vectors.ts` makes from `src/wire.ts`, and vitest and the Kotlin's
 * JUnit tests also read. `NEARBY_VECTORS` names another copy.
 */
enum Vectors {
  static let json: [String: Any] = {
    let here = URL(fileURLWithPath: #filePath)
    let fallback = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("test-vectors.json").path
    let path = ProcessInfo.processInfo.environment["NEARBY_VECTORS"] ?? fallback
    let data = try! Data(contentsOf: URL(fileURLWithPath: path))
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
  }()

  /** Bytes `i % 251`, as `pattern` in src/vectors.ts. */
  static func pattern(_ n: Int) -> [UInt8] { (0..<n).map { UInt8($0 % 251) } }
}

extension Dictionary where Key == String, Value == Any {
  func obj(_ k: String) -> [String: Any] { self[k] as! [String: Any] }
  func arr(_ k: String) -> [Any] { self[k] as! [Any] }
  func objs(_ k: String) -> [[String: Any]] { arr(k).map { $0 as! [String: Any] } }
  func str(_ k: String) -> String { self[k] as! String }
  func strs(_ k: String) -> [String] { arr(k).map { $0 as! String } }
  func int(_ k: String) -> Int { (self[k] as! NSNumber).intValue }
  func u64(_ k: String) -> UInt64 { (self[k] as! NSNumber).uint64Value }
  func bytes(_ k: String) -> [UInt8] { Bytes.unhex(str(k))! }
}

func unhex(_ s: String) -> [UInt8] { Bytes.unhex(s)! }

/** The call throws a `NearbyError` with one of `codes`. */
func expectCode(_ codes: NearbyCode..., file: StaticString = #filePath, line: UInt = #line, _ block: () throws -> Void) {
  do {
    try block()
    XCTFail("expected \(codes)", file: file, line: line)
  } catch let e as NearbyError {
    XCTAssertTrue(codes.contains(e.code), "\(e.code) is not one of \(codes)", file: file, line: line)
  } catch {
    XCTFail("expected \(codes), got \(error)", file: file, line: line)
  }
}

/** Runs `body` on a thread of its own, as a second phone or JavaScript's next call would. */
func background<T>(_ body: @escaping () throws -> T) -> Future<T> {
  let f = Future<T>()
  let t = Thread {
    do { f.complete(try body()) } catch { f.fail(error) }
  }
  t.start()
  return f
}

/** Waits until `condition` holds, or fails the test after five seconds. */
func waitUntil(_ what: String, file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) {
  let deadline = nowMs() + 5_000
  while !condition() {
    if nowMs() > deadline {
      XCTFail(what, file: file, line: line)
      return
    }
    pause(5)
  }
}

/** A fresh folder of its own for one test, removed after it. */
func scratchFolder() -> URL {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nearby-\(UUID().uuidString)", isDirectory: true)
  try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir
}
