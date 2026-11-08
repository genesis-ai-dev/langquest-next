package expo.modules.nearbylink

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** A real pair over a loopback socket, as a Wi-Fi link runs (docs/nearby-sync-plan.md section 8, Native). */
class LinkSessionTest {
  @get:Rule val tmp = TemporaryFolder()
  private val pool = Executors.newCachedThreadPool()
  private val keyA = ByteArray(32) { 1 }
  private val keyB = ByteArray(32) { 2 }
  private val opened = ArrayList<LinkSession>()

  @After fun tearDown() {
    opened.forEach { it.close() }
    pool.shutdownNow()
  }

  /** Breaks the stream after `limit` bytes are written, as a link dropped mid-file. */
  private class Breaking(private val inner: Transport, private val limit: Long) : Transport {
    private var written = 0L
    override val input: InputStream get() = inner.input
    override val output: OutputStream = object : OutputStream() {
      override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
      override fun write(b: ByteArray, off: Int, len: Int) {
        if (written + len > limit) {
          inner.close()
          throw java.io.IOException("dropped")
        }
        written += len
        inner.output.write(b, off, len)
      }
      override fun flush() = inner.output.flush()
    }
    override fun setReadTimeout(ms: Int) = inner.setReadTimeout(ms)
    override fun close() = inner.close()
  }

  private fun pair(tune: LinkTunables = LinkTunables(), breakAfter: Long? = null, free: (File) -> Long = { Long.MAX_VALUE }): Pair<LinkSession, LinkSession> {
    val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
    val accepted = pool.submit(Callable { server.accept() })
    val client = Socket(InetAddress.getLoopbackAddress(), server.localPort)
    val other = accepted.get(5, TimeUnit.SECONDS)
    server.close()
    val ta: Transport = SocketTransport(client).let { if (breakAfter != null) Breaking(it, breakAfter) else it }
    val a = LinkSession("a", "test", ta, tune, listOf(tmp.root), free)
    val b = LinkSession("b", "test", SocketTransport(other), tune, listOf(tmp.root), free)
    opened.add(a)
    opened.add(b)
    return a to b
  }

  private fun secure(a: LinkSession, b: LinkSession) {
    a.secure(keyA, keyB)
    b.secure(keyB, keyA)
  }

  private fun expectCode(vararg codes: NearbyCode, block: () -> Unit) {
    try {
      block()
      fail("expected ${codes.toList()}")
    } catch (e: NearbyException) {
      assertTrue("${e.code}", e.code in codes)
    } catch (e: ExecutionException) {
      val c = e.cause
      assertTrue("$c", c is NearbyException && c.code in codes)
    }
  }

  @Test fun theOpeningIsRawBytesThenMessagesAreSealed() {
    val (a, b) = pair()
    a.sendOpening(Vectors.pattern(80))
    assertArrayEquals(Vectors.pattern(80), b.receiveOpening(80, 2000))
    b.sendOpening(Vectors.pattern(80).reversedArray())
    assertArrayEquals(Vectors.pattern(80).reversedArray(), a.receiveOpening(80, 2000))
    secure(a, b)
    a.send(Bytes.utf8("hello"))
    a.send(ByteArray(Frame.MAX))
    assertEquals("hello", String(b.receive()!!))
    assertEquals(Frame.MAX, b.receive()!!.size)
    b.send(Bytes.utf8("back"))
    assertEquals("back", String(a.receive()!!))
  }

  @Test fun anOpeningNotSentByTheDeadlineIsNull() {
    val (_, b) = pair()
    val started = System.currentTimeMillis()
    assertNull(b.receiveOpening(80, 200))
    assertTrue(System.currentTimeMillis() - started < 2000)
  }

  @Test fun noFrameIsPlainAndSecureIsOnce() {
    val (a, b) = pair()
    expectCode(NearbyCode.NOT_SECURED) { a.send(ByteArray(1)) }
    secure(a, b)
    expectCode(NearbyCode.ALREADY_SECURED) { a.secure(keyA, keyB) }
    expectCode(NearbyCode.OPENING_AFTER_SECURE) { a.sendOpening(ByteArray(1)) }
    expectCode(NearbyCode.MESSAGE_TOO_LARGE) { a.send(ByteArray(Frame.MAX + 1)) }
  }

  @Test fun aCleanCloseIsNullAndADropIsAnError() {
    val (a, b) = pair()
    secure(a, b)
    a.send(Bytes.utf8("last"))
    a.close()
    assertEquals("last", String(b.receive()!!))
    assertNull(b.receive())
    expectCode(NearbyCode.LINK_CLOSED) { a.receive() }

    val (c, d) = pair()
    secure(c, d)
    val waiting = pool.submit(Callable { d.receive() })
    // No goodbye: the socket just goes.
    (c.javaClass.getDeclaredField("transport").apply { isAccessible = true }.get(c) as Transport).close()
    expectCode(NearbyCode.LINK_DROPPED) { waiting.get(5, TimeUnit.SECONDS) }
  }

  @Test fun theWrongKeyClosesTheLink() {
    val (a, b) = pair()
    a.secure(keyA, keyB)
    b.secure(ByteArray(32) { 7 }, ByteArray(32) { 8 })
    a.send(Bytes.utf8("x"))
    expectCode(NearbyCode.TAG_FAILED) { b.receive() }
  }

  @Test fun moves50MegabytesEncryptedAndHashed() {
    val (a, b) = pair()
    secure(a, b)
    val size = 50 * 1024 * 1024
    val source = File(tmp.root, "source.m4a")
    val digest = MessageDigest.getInstance("SHA-256")
    source.outputStream().use { out ->
      val chunk = Vectors.pattern(1 shl 20)
      repeat(50) {
        out.write(chunk)
        digest.update(chunk)
      }
    }
    val staging = File(tmp.root, "blobs/x.m4a.nearby.part")
    val receiving = pool.submit(Callable { b.receiveFile("t1", staging, size.toLong(), 0) })
    // Messages keep moving beside the file, and the other side reads them as they come, as a session does.
    val chatting = pool.submit(Callable { repeat(20) { a.send(Bytes.utf8("m$it")) } })
    val reading = pool.submit(Callable { (0 until 20).map { String(b.receive()!!) } })
    a.sendFile("t1", source, size.toLong())
    val result = receiving.get(120, TimeUnit.SECONDS)
    chatting.get(10, TimeUnit.SECONDS)
    assertEquals((0 until 20).map { "m$it" }, reading.get(10, TimeUnit.SECONDS))
    assertEquals(size.toLong(), result.size)
    assertEquals(Bytes.hex(digest.digest()), result.sha256)
    assertEquals(size.toLong(), staging.length())
  }

  @Test fun aDropMidFileFailsBothSidesAndLeavesNoPart() {
    val (a, b) = pair(breakAfter = 3L * 1024 * 1024)
    secure(a, b)
    val source = File(tmp.root, "big.m4a").apply { writeBytes(ByteArray(8 * 1024 * 1024)) }
    val staging = File(tmp.root, "blobs/big.m4a.nearby.part")
    val receiving = pool.submit(Callable { b.receiveFile("t1", staging, Long.MAX_VALUE, 0) })
    expectCode(NearbyCode.LINK_DROPPED) { a.sendFile("t1", source, source.length()) }
    expectCode(NearbyCode.LINK_DROPPED) { receiving.get(10, TimeUnit.SECONDS) }
    assertFalse(staging.exists())
  }

  @Test fun aFileTooBigIsRefusedAndTheSenderIsTold() {
    val (a, b) = pair()
    secure(a, b)
    val source = File(tmp.root, "s.m4a").apply { writeBytes(ByteArray(5000)) }
    val staging = File(tmp.root, "blobs/s.part")
    val receiving = pool.submit(Callable { b.receiveFile("t1", staging, 1000, 0) })
    Thread.sleep(100) // the receiver registers first, as JavaScript does before it asks
    try {
      a.sendFile("t1", source, 5000)
    } catch (e: NearbyException) {
      assertTrue(e.code == NearbyCode.FILE_REFUSED)
    }
    expectCode(NearbyCode.FILE_TOO_BIG) { receiving.get(5, TimeUnit.SECONDS) }
    assertFalse(staging.exists())
    // The link is still good.
    a.send(Bytes.utf8("still here"))
    assertEquals("still here", String(b.receive()!!))
  }

  @Test fun aFileNobodyAskedForIsRefused() {
    val (a, b) = pair(LinkTunables(fileWaitMs = 100))
    secure(a, b)
    val source = File(tmp.root, "u.m4a").apply { writeBytes(ByteArray(300_000)) }
    try {
      a.sendFile("t9", source, source.length())
    } catch (e: NearbyException) {
      assertEquals(NearbyCode.FILE_REFUSED, e.code)
    }
    a.send(Bytes.utf8("next"))
    assertEquals("next", String(b.receive()!!))
  }

  @Test fun cancellingAReceiveStopsItAndDeletesThePart() {
    val (a, b) = pair()
    secure(a, b)
    val staging = File(tmp.root, "blobs/c.part")
    val receiving = pool.submit(Callable { b.receiveFile("t1", staging, 1000, 0) })
    Thread.sleep(100)
    b.cancelFile("t1")
    expectCode(NearbyCode.FILE_CANCELLED) { receiving.get(5, TimeUnit.SECONDS) }
    assertFalse(staging.exists())
  }

  @Test fun aFileOutsideTheAppsFoldersIsNotSent() {
    val (a, b) = pair()
    secure(a, b)
    val outside = File.createTempFile("outside", ".m4a")
    try {
      expectCode(NearbyCode.FILE_UNREADABLE) { a.sendFile("t1", outside, outside.length()) }
    } finally {
      outside.delete()
    }
  }
}
