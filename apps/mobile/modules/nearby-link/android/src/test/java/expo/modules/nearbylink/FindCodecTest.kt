package expo.modules.nearbylink

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FindCodecTest {
  private val find = Vectors.json.getJSONObject("find")
  private val keys = Vectors.strings(find.getJSONArray("scanKeys")).map(Bytes::unhex)
  private val salt = Bytes.unhex(find.getString("salt"))

  @Test fun v4SetsTheVersionAndVariantBits() {
    val list = Vectors.json.getJSONArray("v4")
    for (i in 0 until list.length()) {
      val v = list.getJSONObject(i)
      val out = FindCodec.v4(Bytes.unhex(v.getString("in")))
      assertEquals(v.getString("out"), Bytes.hex(out))
      assertEquals(v.getString("text"), FindCodec.uuidOf(out).toString())
      assertArrayEquals(out, FindCodec.bytesOf(FindCodec.uuidOf(out)))
    }
  }

  @Test fun advertsMatchTheVectorsUnderEveryKey() {
    val adverts = find.getJSONArray("adverts")
    val matcher = FindMatcher(keys)
    for (i in 0 until adverts.length()) {
      val a = adverts.getJSONObject(i)
      val id = Bytes.unhex(a.getString("id"))
      assertEquals(a.getString("id"), Bytes.hex(FindCodec.advertId(keys[a.getInt("scan")], salt)))
      assertEquals(a.getInt("scan"), matcher.scanOf(id))
      // A second hearing comes from the cache, with the same answer.
      assertEquals(a.getInt("scan"), matcher.scanOf(id))
      assertEquals(2 - a.getInt("scan"), FindMatcher(keys.reversed()).scanOf(id))
    }
  }

  @Test fun aMatchGivesBackItsPlaceInScanKeysAndTheUnmaskedPayload() {
    val scan = find.getInt("responseKey")
    val id = Bytes.unhex(find.getJSONArray("adverts").getJSONObject(scan).getString("id"))
    val response = Bytes.unhex(find.getString("response"))
    val unmasked = find.getJSONObject("unmasked")
    for (order in listOf(listOf(id, response), listOf(response, id))) {
      val heard = FindMatcher(keys).hear(order, false)
      assertTrue(heard is Heard.Match)
      heard as Heard.Match
      assertEquals(scan, heard.scan)
      assertArrayEquals(salt, heard.salt)
      assertEquals(unmasked.getString("r"), Bytes.hex(heard.response.r))
      assertEquals(unmasked.getString("tag"), Bytes.hex(heard.response.tag))
      assertEquals(unmasked.getString("summary"), Bytes.hex(heard.response.summary))
      assertEquals(unmasked.getString("echo"), Bytes.hex(heard.response.echo))
    }
    // No scan response yet: nothing to hand up.
    assertNull(FindMatcher(keys).hear(listOf(id), false))
  }

  @Test fun theScanResponseIsMadeAsTheVectorsSay() {
    val scan = find.getInt("responseKey")
    val made = FindCodec.scanResponse(keys[scan], salt, Bytes.unhex(find.getString("r")), Bytes.unhex(find.getString("payload")))
    assertEquals(find.getString("response"), Bytes.hex(made))
  }

  @Test fun theBitsV4OverwroteReadAsCleared() {
    val dirty = find.getJSONObject("dirty")
    val key = keys[dirty.getInt("key")]
    val made = FindCodec.scanResponse(key, salt, Bytes.unhex(find.getString("r")), Bytes.unhex(dirty.getString("payload")))
    val read = FindCodec.unmask(key, salt, made)
    assertEquals(dirty.getString("tag"), Bytes.hex(read.tag))
    assertEquals(dirty.getString("summary"), Bytes.hex(read.summary))
  }

  @Test fun anAdvertOfThisFormUnderNoKeyHandsUpItsSaltAndNothingElse() {
    val stranger = find.getJSONObject("stranger")
    val heard = FindMatcher(keys).hear(listOf(Bytes.unhex(stranger.getString("id")), Bytes.unhex(stranger.getString("response"))), false)
    assertTrue(heard is Heard.FormSalt)
    assertEquals(stranger.getString("salt"), Bytes.hex((heard as Heard.FormSalt).salt))
  }

  @Test fun anythingElseIsNotOurs() {
    val id = Bytes.unhex(find.getJSONArray("adverts").getJSONObject(0).getString("id"))
    val response = Bytes.unhex(find.getString("response"))
    val matcher = FindMatcher(keys)
    for (u in Vectors.strings(find.getJSONArray("notForm"))) assertNull(matcher.hear(listOf(Bytes.unhex(u)), false))
    assertNull(matcher.hear(listOf(id, response), true))
    assertNull(matcher.hear(listOf(id, response, response), false))
    assertNull(matcher.hear(emptyList(), false))
  }

  @Test fun aCachedSaltWithAnotherIdIsCheckedAgain() {
    val matcher = FindMatcher(keys)
    val id = Bytes.unhex(find.getJSONArray("adverts").getJSONObject(1).getString("id"))
    assertEquals(1, matcher.scanOf(id))
    val forged = id.copyOf().also { it[15] = (it[15].toInt() xor 1).toByte() }
    assertEquals(-1, matcher.scanOf(forged))
    assertEquals(1, matcher.scanOf(id))
  }

  @Test fun gattUuidsAreDerivedAndDistinct() {
    val g = find.getJSONObject("gatt")
    val key = keys[g.getInt("key")]
    val made = (0..2).map { Bytes.hex(FindCodec.gattUuid(key, salt, it)) }
    assertEquals(listOf(g.getString("service"), g.getString("write"), g.getString("notify")), made)
    assertEquals(3, made.toSet().size)
    for (u in made) assertTrue(FindCodec.isV4(Bytes.unhex(u)))
    assertNotNull(FindCodec.uuidOf(Bytes.unhex(made[0])))
  }
}
