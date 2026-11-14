package expo.modules.nearbylink

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FramesTest {
  private val frames = Vectors.json.getJSONObject("frames")
  private val key = Bytes.unhex(frames.getString("key"))

  private fun expectCode(code: NearbyCode, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: NearbyException) {
      assertEquals(code, e.code)
    }
  }

  @Test fun noncesAreFourZerosAndACounter() {
    val list = Vectors.json.getJSONArray("nonces")
    for (i in 0 until list.length()) {
      val n = list.getJSONObject(i)
      assertEquals(n.getString("hex"), Bytes.hex(Frame.nonce(n.getLong("counter"))))
    }
  }

  @Test fun sealingMatchesTheVectorsInOrder() {
    val sealer = Sealer(key)
    val list = frames.getJSONArray("frames")
    for (i in 0 until list.length()) {
      val f = list.getJSONObject(i)
      assertEquals(f.getString("sealed"), Bytes.hex(sealer.seal(f.getInt("type"), Bytes.unhex(f.getString("body")))))
    }
  }

  @Test fun openingReadsEachHeaderThenItsBody() {
    val opener = Opener(key)
    val list = frames.getJSONArray("frames")
    for (i in 0 until list.length()) {
      val f = list.getJSONObject(i)
      val sealed = Bytes.unhex(f.getString("sealed"))
      val h = opener.header(sealed.copyOfRange(0, Frame.SEALED_HEADER))
      assertEquals(f.getInt("type"), h.type)
      assertEquals(f.getString("body").length / 2, h.len)
      assertEquals(h.len + Frame.TAG, sealed.size - Frame.SEALED_HEADER)
      assertEquals(f.getString("body"), Bytes.hex(opener.body(sealed.copyOfRange(Frame.SEALED_HEADER, sealed.size))))
    }
  }

  @Test fun aLengthPastOneMebibyteIsRefusedOnceTheHeaderOpens() {
    expectCode(NearbyCode.FRAME_TOO_LARGE) { Opener(key).header(Bytes.unhex(frames.getString("overHeader"))) }
    assertEquals(frames.getInt("max"), Opener(key).header(Bytes.unhex(frames.getString("maxHeader"))).len)
    expectCode(NearbyCode.MESSAGE_TOO_LARGE) { Sealer(key).seal(Frame.MESSAGE, ByteArray(Frame.MAX + 1)) }
  }

  @Test fun aChangedByteFailsItsTag() {
    val sealed = Bytes.unhex(frames.getJSONArray("frames").getJSONObject(0).getString("sealed"))
    for (at in listOf(0, 4, 20, 21, sealed.size - 1)) {
      val bad = sealed.copyOf().also { it[at] = (it[at].toInt() xor 0x01).toByte() }
      expectCode(NearbyCode.TAG_FAILED) {
        val o = Opener(key)
        o.header(bad.copyOfRange(0, Frame.SEALED_HEADER))
        o.body(bad.copyOfRange(Frame.SEALED_HEADER, bad.size))
      }
    }
  }

  @Test fun aCutOrOutOfOrderFrameFails() {
    val list = frames.getJSONArray("frames")
    val first = Bytes.unhex(list.getJSONObject(0).getString("sealed"))
    val second = Bytes.unhex(list.getJSONObject(1).getString("sealed"))
    expectCode(NearbyCode.TAG_FAILED) { Opener(key).header(first.copyOfRange(0, 20)) }
    expectCode(NearbyCode.TAG_FAILED) { Opener(key).header(second.copyOfRange(0, Frame.SEALED_HEADER)) }
    val o = Opener(key)
    o.header(first.copyOfRange(0, Frame.SEALED_HEADER))
    expectCode(NearbyCode.TAG_FAILED) { o.body(first.copyOfRange(Frame.SEALED_HEADER, first.size - 1)) }
  }

  @Test fun theOtherDirectionsKeyOpensNothing() {
    val sealed = Sealer(key).seal(Frame.MESSAGE, Bytes.utf8("hi"))
    val other = key.copyOf().also { it[0] = 9 }
    expectCode(NearbyCode.TAG_FAILED) { Opener(other).header(sealed.copyOfRange(0, Frame.SEALED_HEADER)) }
  }

  @Test fun eachSealTakesTheNextNonce() {
    val sealer = Sealer(key)
    val a = sealer.seal(Frame.MESSAGE, ByteArray(0))
    val b = sealer.seal(Frame.MESSAGE, ByteArray(0))
    assertTrue(!a.contentEquals(b))
  }

  /**
   * Why: `forget` zeroes the key when the link ends, while a writer may be sealing. A frame sealed
   * part or whole under an all-zero key would go out readable by anyone, so forgetting waits for a
   * seal in progress, and every seal after it throws instead of sealing.
   */
  @Test fun aForgottenSealerNeverSealsUnderZeros() {
    repeat(200) { round ->
      val sealer = Sealer(key)
      val out = java.util.Collections.synchronizedList(ArrayList<ByteArray>())
      var refused: NearbyException? = null
      val body = ByteArray(1024) { it.toByte() }
      // The writer seals until refused, or for a while after the forget if it never is.
      val until = java.util.concurrent.atomic.AtomicLong(Long.MAX_VALUE)
      val started = java.util.concurrent.CountDownLatch(1)
      val writer = Thread {
        try {
          while (System.nanoTime() < until.get()) {
            out.add(sealer.seal(Frame.MESSAGE, body))
            started.countDown()
          }
        } catch (e: NearbyException) {
          refused = e
        }
      }
      writer.start()
      started.await()
      if (round % 2 == 1) Thread.sleep(0, (round * 7919) % 300_000)
      sealer.forget()
      until.set(System.nanoTime() + 20_000_000)
      writer.join()
      assertEquals("round $round: a seal after forget throws", NearbyCode.LINK_CLOSED, refused?.code)
      val opener = Opener(key)
      for (sealed in out.toList()) {
        val h = opener.header(sealed.copyOfRange(0, Frame.SEALED_HEADER))
        assertEquals(body.size, h.len)
        assertArrayEquals(body, opener.body(sealed.copyOfRange(Frame.SEALED_HEADER, sealed.size)))
      }
    }
  }

  @Test fun aForgottenOpenerOpensNothing() {
    val sealed = Sealer(key).seal(Frame.MESSAGE, byteArrayOf(1))
    val opener = Opener(key)
    opener.forget()
    expectCode(NearbyCode.LINK_CLOSED) { opener.header(sealed.copyOfRange(0, Frame.SEALED_HEADER)) }
  }

  @Test fun fileBodiesCarryTheirIds() {
    val start = Frame.readFileBody(Frame.fileStart("t1", 300))
    assertEquals("t1", start.transferId)
    assertEquals(300L, Bytes.readU64(start.rest, start.restFrom))
    val data = Frame.readFileBody(Frame.fileData("t1", Vectors.pattern(10)))
    assertArrayEquals(Vectors.pattern(10), data.rest.copyOfRange(data.restFrom, data.rest.size))
    expectCode(NearbyCode.BAD_ARGUMENT) { Frame.fileEnd("") }
    expectCode(NearbyCode.BAD_ARGUMENT) { Frame.fileEnd("x".repeat(65)) }
    expectCode(NearbyCode.LINK_DROPPED) { Frame.readFileBody(byteArrayOf(5, 1)) }
  }
}
