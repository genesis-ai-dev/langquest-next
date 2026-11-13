package expo.modules.nearbylink

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** A hosted group's server over loopback, as a Wi-Fi Direct group or a hotspot runs it (docs/nearby-sync-plan.md 5.12). */
class HostedTest {
  private val pool = Executors.newCachedThreadPool()
  private val opened = ArrayList<AutoCloseable>()
  private val refused = AtomicInteger()
  private val tornDown = AtomicInteger()
  private val keyA = ByteArray(32) { 1 }
  private val keyB = ByteArray(32) { 2 }

  @After fun tearDown() {
    opened.forEach { try { it.close() } catch (_: Exception) {} }
    pool.shutdownNow()
  }

  private fun session(socket: Socket, id: String) = LinkSession(id, "test", SocketTransport(socket), LinkTunables(), emptyList()).also { s -> opened.add(AutoCloseable { s.close() }) }

  private val ports = HashMap<Hosted, Int>()

  private fun connect(h: Hosted): Socket = Socket(InetAddress.getLoopbackAddress(), ports.getValue(h)).also { s -> opened.add(s) }

  private fun hostedOn(candidates: Boolean, adopt: ((Socket, Hosted) -> LinkSession)? = null): Hosted {
    val server = ServerSocket(0, 4, InetAddress.getLoopbackAddress())
    val h = Hosted("h", "test", emptyMap(), server, { tornDown.incrementAndGet() }, adopt ?: { s, _ -> session(s, "host") }, { refused.incrementAndGet() }, candidates)
    ports[h] = server.localPort
    opened.add(AutoCloseable { h.takeDown() })
    h.acceptLoop()
    return h
  }

  private fun next(h: Hosted): LinkSession = pool.submit(Callable { h.nextLink() }).get(5, TimeUnit.SECONDS)

  private fun noMore(h: Hosted) {
    try {
      next(h)
      fail("expected no more links")
    } catch (e: java.util.concurrent.ExecutionException) {
      assertEquals(NearbyCode.HOST_TAKEN_DOWN, (e.cause as NearbyException).code)
    }
  }

  private fun eventually(what: String, check: () -> Boolean) {
    val until = System.currentTimeMillis() + 5_000
    while (!check()) {
      if (System.currentTimeMillis() > until) fail(what)
      Thread.sleep(10)
    }
  }

  /** Why: a group taken down while a connection was being adopted left that link open, and nobody would ever close it. */
  @Test fun aLinkAdoptedAsTheGroupGoesDownIsClosed() {
    var made: LinkSession? = null
    val h = hostedOn(false) { s, hosted ->
      session(s, "host").also {
        made = it
        hosted.takeDown()
      }
    }
    connect(h)
    eventually("the link was adopted") { made != null }
    eventually("the link adopted as the group went down was closed") { made!!.isEnded }
    noMore(h)
    assertEquals(1, tornDown.get())
  }

  @Test fun onWiFiDirectTheFirstConnectionTakesTheLinkAndALaterOneIsRefused() {
    val h = hostedOn(false)
    connect(h)
    val first = next(h)
    connect(h)
    eventually("the second phone was refused and reported") { refused.get() == 1 }
    noMore(h)
    assertTrue(h.endTakesDown(first))
  }

  /**
   * Why: a hotspot's server listens on every network the phone is on, so a stranger there could
   * connect first and take the link. Every connection is tried; the one that proves the keys is it.
   */
  @Test fun onAHotspotEveryConnectionIsACandidateUntilOneProvesTheKeys() {
    val h = hostedOn(true)
    connect(h) // a stranger, silent
    val stranger = next(h)
    val teammate = session(connect(h), "teammate")
    val candidate = next(h)
    assertNotSame(stranger, candidate)
    teammate.secure(keyA, keyB)
    candidate.secure(keyB, keyA)
    stranger.secure(keyB, keyA)
    teammate.send(byteArrayOf(7))
    assertArrayEquals(byteArrayOf(7), candidate.receive())
    assertTrue(candidate.isProven)
    assertFalse(stranger.isProven)
    // The stranger's end takes nothing down; the link's would.
    assertFalse(h.endTakesDown(stranger))
    assertTrue(h.endTakesDown(candidate))
    stranger.close()
    // Settled: a later connection is refused and reported, and there are no more candidates.
    connect(h)
    eventually("a connection after the link was settled was refused") { refused.get() == 1 }
    noMore(h)
    assertEquals(0, tornDown.get())
  }

  /**
   * Why (security review, 2026-11-10): every candidate shares the attempt's keys, so the joiner's first frame copied onto
   * a second connection opened there too, and the second's goodbye then repeated the link's nonce under the same key.
   * Two joiners under the same keys send the same bytes, as a copy would.
   */
  @Test fun onAHotspotOnlyTheFirstCandidateToProveTheKeysIsProvenAndACopyEndsWithNoGoodbye() {
    val h = hostedOn(true)
    val joiner = session(connect(h), "joiner")
    val first = next(h)
    val copier = session(connect(h), "copier")
    val second = next(h)
    for (j in listOf(joiner, copier)) j.secure(keyA, keyB)
    for (c in listOf(first, second)) c.secure(keyB, keyA)
    joiner.send(byteArrayOf(7))
    assertArrayEquals(byteArrayOf(7), first.receive())
    copier.send(byteArrayOf(7))
    eventually("the copy's connection ended") { second.isEnded }
    assertFalse(second.isProven)
    assertTrue(first.isProven)
    second.close()
    // Nothing sealed came back to the copier: a goodbye would read as a clean end (null); its link only drops.
    try {
      copier.receive()
      fail("a goodbye came, sealed under the link's key and nonce")
    } catch (e: NearbyException) {
      assertEquals(NearbyCode.LINK_DROPPED, e.code)
    }
  }

  @Test fun aHotspotHoldsOnlySoManyCandidatesAtOnce() {
    val h = hostedOn(true)
    repeat(4) { connect(h); next(h) }
    val extra = connect(h)
    eventually("a fifth candidate was closed") { extra.getInputStream().read() == -1 }
    assertEquals(0, refused.get())
  }
}
