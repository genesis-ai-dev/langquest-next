import XCTest
@testable import NearbyLink

final class BytesTests: XCTestCase {
  func testBase64urlMatchesTheVectors() {
    for v in Vectors.json.objs("base64url") {
      let bytes = v.bytes("hex")
      XCTAssertEqual(v.str("b64"), Bytes.b64url(bytes))
      XCTAssertEqual(bytes, Bytes.unb64url(v.str("b64")))
    }
  }

  func testBase64urlRefusesAnythingElse() {
    XCTAssertNil(Bytes.unb64url("a"))
    XCTAssertNil(Bytes.unb64url("ab=="))
    XCTAssertNil(Bytes.unb64url("a+b/"))
    // "_x" leaves bits set that "_w" would not.
    XCTAssertNil(Bytes.unb64url("_x"))
    XCTAssertEqual([0xff], Bytes.unb64url("_w"))
  }

  func testIntegersAreBigEndian() {
    XCTAssertEqual("0102030405060708", Bytes.hex(Bytes.u64(0x0102030405060708)))
    XCTAssertEqual(0x0102030405060708, Bytes.readU64(Bytes.u64(0x0102030405060708), 0))
    XCTAssertEqual(0xfffffffe, Bytes.readU32(Bytes.u32(0xfffffffe), 0))
  }

  func testHexReadsBackAndRefusesWhatIsNotHex() {
    XCTAssertEqual([0x00, 0xab, 0xff], Bytes.unhex("00abFF"))
    XCTAssertNil(Bytes.unhex("abc"))
    XCTAssertNil(Bytes.unhex("zz"))
  }

  func testSameComparesTheWholeLength() {
    XCTAssertTrue(Bytes.same([1, 2, 3], [1, 2, 3]))
    XCTAssertFalse(Bytes.same([1, 2, 3], [1, 2, 4]))
    XCTAssertFalse(Bytes.same([1, 2], [1, 2, 3]))
  }

  func testTheCodesAreTheContractsInItsOrder() {
    let codes = NearbyCode.allCases.map(\.rawValue)
    XCTAssertEqual(42, codes.count)
    XCTAssertEqual("NOT_AVAILABLE", codes.first)
    XCTAssertEqual("INTERNAL", codes.last)
    XCTAssertEqual(Set(["LINK_CLOSED", "LINK_DROPPED", "TAG_FAILED", "FRAME_TOO_LARGE", "LINK_UNKNOWN", "STOPPED"]), Set(DROP_CODES.map(\.rawValue)))
  }
}
