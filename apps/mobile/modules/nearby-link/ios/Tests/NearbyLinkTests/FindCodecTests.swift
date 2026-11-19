import XCTest
@testable import NearbyLink

final class FindCodecTests: XCTestCase {
  private let find = Vectors.json.obj("find")
  private lazy var keys = find.strs("scanKeys").map(unhex)
  private lazy var salt = find.bytes("salt")

  func testV4SetsTheVersionAndVariantBits() {
    for v in Vectors.json.objs("v4") {
      let out = FindCodec.v4(v.bytes("in"))
      XCTAssertEqual(v.str("out"), Bytes.hex(out))
      XCTAssertEqual(v.str("text"), FindCodec.uuidOf(out).uuidString.lowercased())
      XCTAssertEqual(out, FindCodec.bytesOf(FindCodec.uuidOf(out)))
    }
  }

  func testAdvertsMatchTheVectorsUnderEveryKey() {
    let matcher = FindMatcher(keys)
    for a in find.objs("adverts") {
      let id = a.bytes("id")
      XCTAssertEqual(a.str("id"), Bytes.hex(FindCodec.advertId(keys[a.int("scan")], salt)))
      XCTAssertEqual(a.int("scan"), matcher.scanOf(id))
      // A second hearing comes from the cache, with the same answer.
      XCTAssertEqual(a.int("scan"), matcher.scanOf(id))
      XCTAssertEqual(2 - a.int("scan"), FindMatcher(keys.reversed()).scanOf(id))
    }
  }

  func testAMatchGivesBackItsPlaceInScanKeysAndTheUnmaskedPayload() {
    let scan = find.int("responseKey")
    let id = find.objs("adverts")[scan].bytes("id")
    let response = find.bytes("response")
    let unmasked = find.obj("unmasked")
    for order in [[id, response], [response, id]] {
      guard case let .match(s, heardSalt, r) = FindMatcher(keys).hear(order, otherData: false) else {
        return XCTFail("a match")
      }
      XCTAssertEqual(scan, s)
      XCTAssertEqual(salt, heardSalt)
      XCTAssertEqual(unmasked.str("r"), Bytes.hex(r.r))
      XCTAssertEqual(unmasked.str("tag"), Bytes.hex(r.tag))
      XCTAssertEqual(unmasked.str("summary"), Bytes.hex(r.summary))
      XCTAssertEqual(unmasked.str("echo"), Bytes.hex(r.echo))
    }
    // No scan response: the advert alone (an iPhone's, phase 5), under its key and with its salt.
    guard case let .advert(s, heardSalt) = FindMatcher(keys).hear([id], otherData: false) else { return XCTFail("an advert alone") }
    XCTAssertEqual(scan, s)
    XCTAssertEqual(salt, heardSalt)
  }

  func testTheScanResponseIsMadeAsTheVectorsSay() {
    let scan = find.int("responseKey")
    let made = FindCodec.scanResponse(keys[scan], salt, find.bytes("r"), find.bytes("payload"))
    XCTAssertEqual(find.str("response"), Bytes.hex(made))
  }

  func testTheBitsV4OverwroteReadAsCleared() {
    let dirty = find.obj("dirty")
    let key = keys[dirty.int("key")]
    let made = FindCodec.scanResponse(key, salt, find.bytes("r"), dirty.bytes("payload"))
    let read = FindCodec.unmask(key, salt, made)
    XCTAssertEqual(dirty.str("tag"), Bytes.hex(read.tag))
    XCTAssertEqual(dirty.str("summary"), Bytes.hex(read.summary))
  }

  func testAnAdvertOfThisFormUnderNoKeyHandsUpItsSaltAndNothingElse() {
    let stranger = find.obj("stranger")
    guard case let .formSalt(s) = FindMatcher(keys).hear([stranger.bytes("id"), stranger.bytes("response")], otherData: false) else {
      return XCTFail("a salt alone")
    }
    XCTAssertEqual(stranger.str("salt"), Bytes.hex(s))
    // An iPhone's advert, alone, under no key: its salt too.
    guard case let .formSalt(alone) = FindMatcher(keys).hear([stranger.bytes("id")], otherData: false) else { return XCTFail("a salt alone") }
    XCTAssertEqual(stranger.str("salt"), Bytes.hex(alone))
  }

  func testAnythingElseIsNotOurs() {
    let id = find.objs("adverts")[0].bytes("id")
    let response = find.bytes("response")
    let matcher = FindMatcher(keys)
    for u in find.strs("notForm") { XCTAssertNil(matcher.hear([unhex(u)], otherData: false)) }
    XCTAssertNil(matcher.hear([id, response], otherData: true))
    XCTAssertNil(matcher.hear([id, response, response], otherData: false))
    XCTAssertNil(matcher.hear([], otherData: false))
    // A 16-bit UUID, as Core Bluetooth reports one: two bytes, not of this form.
    XCTAssertNil(matcher.hear([id, [0x18, 0x0f]], otherData: false))
  }

  func testACachedSaltWithAnotherIdIsCheckedAgain() {
    let matcher = FindMatcher(keys)
    let id = find.objs("adverts")[1].bytes("id")
    XCTAssertEqual(1, matcher.scanOf(id))
    var forged = id
    forged[15] ^= 1
    XCTAssertEqual(-1, matcher.scanOf(forged))
    XCTAssertEqual(1, matcher.scanOf(id))
  }

  func testTheCacheForgetsTheLeastUsedSaltPastItsSize() {
    let matcher = FindMatcher(keys, cacheSize: 2)
    let ids = (0..<3).map { i in FindCodec.advertId(keys[0], [UInt8](repeating: UInt8(i), count: 6)) }
    for id in ids { XCTAssertEqual(0, matcher.scanOf(id)) }
    XCTAssertEqual(0, matcher.scanOf(ids[0]))
  }

  func testGattUuidsAreDerivedAndDistinct() {
    let g = find.obj("gatt")
    let key = keys[g.int("key")]
    let made = (0...2).map { Bytes.hex(FindCodec.gattUuid(key, salt, UInt8($0))) }
    XCTAssertEqual([g.str("service"), g.str("write"), g.str("notify")], made)
    XCTAssertEqual(3, Set(made).count)
    for u in made { XCTAssertTrue(FindCodec.isV4(unhex(u))) }
  }

  func testAClearedMatcherKnowsNoKey() {
    let matcher = FindMatcher(keys)
    matcher.clear()
    XCTAssertNil(matcher.keyAt(0))
    XCTAssertEqual(-1, matcher.scanOf(find.objs("adverts")[0].bytes("id")))
  }
}
