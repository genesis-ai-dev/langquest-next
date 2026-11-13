package expo.modules.nearbylink

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.SocketTimeoutException

class StreamsTest {
  private val pipe = Vectors.json.getJSONObject("pipe")

  @Test fun theChunkerCutsAtMtuMinusThreeUpTo512AndAddsNothing() {
    val stream = Vectors.pattern(pipe.getInt("streamBytes"))
    val chunks = pipe.getJSONObject("chunks")
    for (mtu in chunks.keys()) {
      val sizes = chunks.getJSONArray(mtu)
      val made = GattChunks.split(stream, mtu.toInt())
      assertEquals(sizes.length(), made.size)
      for (i in made.indices) assertEquals(sizes.getInt(i), made[i].size)
      val joined = ByteArrayOutputStream().also { out -> made.forEach { out.write(it) } }.toByteArray()
      assertArrayEquals(stream, joined)
    }
    assertEquals(20, GattChunks.sizeFor(23))
    assertEquals(512, GattChunks.sizeFor(517))
  }

  @Test fun theChunkedStreamWritesOneValueAtATime() {
    val sent = ArrayList<ByteArray>()
    val out = ChunkedOutputStream({ 23 }) { sent.add(it) }
    out.write(Vectors.pattern(45))
    assertEquals(listOf(20, 20, 5), sent.map { it.size })
    val big = ArrayList<ByteArray>()
    ChunkedOutputStream({ 517 }) { big.add(it) }.write(Vectors.pattern(1200))
    assertEquals(listOf(512, 512, 176), big.map { it.size })
  }

  @Test fun aQueueReadsInOrderThenTheEnd() {
    val q = ByteQueue(1000)
    for (c in GattChunks.split(Vectors.pattern(300), 23)) assertTrue(q.offer(c))
    q.end()
    val read = q.inputStream().readBytes()
    assertArrayEquals(Vectors.pattern(300), read)
  }

  @Test fun aQueueBreaksPastItsCapacity() {
    val q = ByteQueue(10)
    assertTrue(q.offer(ByteArray(8)))
    assertFalse(q.offer(ByteArray(8)))
    val buf = ByteArray(8)
    assertEquals(8, q.read(buf, 0, 8))
    try {
      q.read(buf, 0, 8)
      fail("a broken pipe")
    } catch (e: IOException) {
    }
  }

  @Test fun aQueueReadTimesOut() {
    val q = ByteQueue(10)
    q.timeoutMs = 50
    try {
      q.read(ByteArray(1), 0, 1)
      fail("timed out")
    } catch (e: SocketTimeoutException) {
    }
  }

  @Test fun aQueueTellsWhenItDrained() {
    var drained = 0
    val q = ByteQueue(100) { drained++ }
    q.offer(ByteArray(10))
    q.read(ByteArray(10), 0, 10)
    assertEquals(1, drained)
  }

  /**
   * Why: a pipe that ends removed whatever pipe sat at its device's address, so a device that had
   * reconnected lost its new pipe to the old one's close. A pipe removes itself only.
   */
  @Test fun aPipeThatEndsRemovesItselfAndNotTheDevicesNewerPipe() {
    val ends = PipeEnds<Any>()
    val old = Any()
    val newer = Any()
    ends.put("AA", old)
    assertTrue(ends.remove("AA", old))
    ends.put("AA", newer)
    assertFalse(ends.remove("AA", old))
    assertSame(newer, ends["AA"])
    assertSame(newer, ends.remove("AA"))
    assertNull(ends["AA"])
    ends.put("AA", old)
    ends.put("BB", newer)
    assertEquals(setOf(old, newer), ends.takeAll().toSet())
    assertNull(ends["BB"])
  }
}
