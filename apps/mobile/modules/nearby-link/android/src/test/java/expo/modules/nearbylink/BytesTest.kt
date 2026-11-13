package expo.modules.nearbylink

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BytesTest {
  @Test fun base64urlMatchesTheVectors() {
    val list = Vectors.json.getJSONArray("base64url")
    for (i in 0 until list.length()) {
      val v = list.getJSONObject(i)
      val bytes = Bytes.unhex(v.getString("hex"))
      assertEquals(v.getString("b64"), Bytes.b64url(bytes))
      assertArrayEquals(bytes, Bytes.unb64url(v.getString("b64")))
    }
  }

  @Test fun base64urlRefusesAnythingElse() {
    assertNull(Bytes.unb64url("a"))
    assertNull(Bytes.unb64url("ab=="))
    assertNull(Bytes.unb64url("a+b/"))
    // "_x" leaves bits set that "_w" would not.
    assertNull(Bytes.unb64url("_x"))
  }

  @Test fun integersAreBigEndian() {
    assertEquals("0102030405060708", Bytes.hex(Bytes.u64(0x0102030405060708L)))
    assertEquals(0x0102030405060708L, Bytes.readU64(Bytes.u64(0x0102030405060708L), 0))
    assertEquals(0xfffffffeL, Bytes.readU32(Bytes.u32(-2), 0))
  }
}
