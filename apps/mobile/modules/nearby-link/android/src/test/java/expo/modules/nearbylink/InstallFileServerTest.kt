package expo.modules.nearbylink

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.Random
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Give the app's page and file server over loopback, as the group serves it (docs/nearby-sync-plan.md 14.5). */
class InstallFileServerTest {
  private val name = "r21-l1-p1-0a1b2c3d.apk"
  private val page = "<!doctype html><title>Install</title><p>Télécharger</p>".toByteArray(Charsets.UTF_8)
  private val bytes = ByteArray(300_000).also { Random(7).nextBytes(it) }
  private val dir = File(System.getProperty("java.io.tmpdir"), "give-app-${System.nanoTime()}").apply { mkdirs() }
  private val file = File(dir, name).apply { writeBytes(bytes) }
  private val loopback = InetAddress.getLoopbackAddress()
  private val now = AtomicLong(1_000)
  private val opened = ArrayList<AutoCloseable>()
  private val ports = HashMap<InstallFileServer, Int>()

  @After fun tearDown() {
    opened.forEach { try { it.close() } catch (_: Exception) {} }
    dir.deleteRecursively()
  }

  private fun serving(
    limits: InstallFileServer.Limits = InstallFileServer.Limits(),
    peers: Subnet = Subnet(loopback, 8),
    served: File = file,
    stillThere: () -> Boolean = { true },
    onStopped: () -> Unit = {},
    socket: ServerSocket = ServerSocket(0, 8, loopback),
  ): InstallFileServer {
    val s = InstallFileServer(socket, page, name, served, peers, limits, stillThere, onStopped) { now.get() }
    opened.add(AutoCloseable { s.close() })
    ports[s] = socket.localPort
    s.start()
    return s
  }

  private fun connect(s: InstallFileServer): Socket = Socket(loopback, ports.getValue(s)).also {
    it.soTimeout = 5_000
    opened.add(it)
  }

  private class Answer(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
    fun header(name: String): String? = headers[name.lowercase()]
  }

  private fun readAll(socket: Socket): ByteArray {
    val all = ByteArrayOutputStream()
    try { socket.getInputStream().copyTo(all) } catch (e: SocketException) {}
    return all.toByteArray()
  }

  /** Sends `request` as it is, reads the answer to the end of the stream (every answer closes), and closes, as a browser does. */
  private fun send(socket: Socket, request: String): Answer {
    val raw = socket.use {
      it.getOutputStream().write(request.toByteArray(Charsets.ISO_8859_1))
      it.getOutputStream().flush()
      readAll(it)
    }
    val split = (0..raw.size - 4).firstOrNull { raw[it] == '\r'.code.toByte() && raw[it + 1] == '\n'.code.toByte() && raw[it + 2] == '\r'.code.toByte() && raw[it + 3] == '\n'.code.toByte() }
      ?: throw IOException("no answer")
    val lines = String(raw, 0, split, Charsets.ISO_8859_1).split("\r\n")
    val status = lines[0].split(' ')[1].toInt()
    assertTrue(lines[0], lines[0].startsWith("HTTP/1.1 "))
    val headers = lines.drop(1).associate { l -> l.substringBefore(':').lowercase() to l.substringAfter(':').trim() }
    return Answer(status, headers, raw.copyOfRange(split + 4, raw.size))
  }

  private fun request(method: String, path: String, vararg headers: String) =
    "$method $path HTTP/1.1\r\nHost: 192.168.49.1:8080\r\n" + headers.joinToString("") { "$it\r\n" } + "\r\n"

  private fun ask(s: InstallFileServer, method: String, path: String, vararg headers: String): Answer = send(connect(s), request(method, path, *headers))

  /** Whether the server closed `socket` within `ms`: the end of the stream or a reset, and not a wait that ran out. */
  private fun closedBy(socket: Socket, ms: Int): Boolean {
    socket.soTimeout = ms
    return try {
      socket.getInputStream().read() == -1
    } catch (e: SocketTimeoutException) {
      false
    } catch (e: SocketException) {
      true
    }
  }

  private fun eventually(what: String, check: () -> Boolean) {
    val until = System.currentTimeMillis() + 5_000
    while (!check()) {
      if (System.currentTimeMillis() > until) fail(what)
      Thread.sleep(10)
    }
  }

  private fun assertCommon(a: Answer) {
    assertEquals("no-store", a.header("Cache-Control"))
    assertEquals("nosniff", a.header("X-Content-Type-Options"))
    assertEquals("close", a.header("Connection"))
    assertEquals("${a.body.size}", a.header("Content-Length"))
  }

  private val etag = "\"$name-${bytes.size}\""

  @Test fun servesThePageAtTheRootUnderAStrictPolicy() {
    val s = serving()
    val a = ask(s, "GET", "/")
    assertEquals(200, a.status)
    assertEquals("text/html; charset=utf-8", a.header("Content-Type"))
    assertArrayEquals(page, a.body)
    assertCommon(a)
    assertEquals("default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", a.header("Content-Security-Policy"))
    assertEquals("no-referrer", a.header("Referrer-Policy"))
    assertEquals(0L, s.status().sent)
  }

  @Test fun servesTheFileWholeAsAnAttachmentWithValidatorsAndCountsADownload() {
    val s = serving()
    val a = ask(s, "GET", "/$name")
    assertEquals(200, a.status)
    assertEquals("application/vnd.android.package-archive", a.header("Content-Type"))
    assertEquals("attachment; filename=\"$name\"", a.header("Content-Disposition"))
    assertEquals("bytes", a.header("Accept-Ranges"))
    assertEquals(etag, a.header("ETag"))
    assertEquals(InstallFileServer.httpDate(file.lastModified()), a.header("Last-Modified"))
    assertNull(a.header("Content-Range"))
    assertNull(a.header("Content-Security-Policy"))
    assertArrayEquals(bytes, a.body)
    assertCommon(a)
    eventually("the download was counted") { s.status().downloads == 1L }
    assertEquals(bytes.size.toLong(), s.status().sent)
    assertEquals(bytes.size.toLong(), s.status().total)
  }

  @Test fun aHeadSaysWhatAGetWouldWithNoBody() {
    val s = serving()
    val file = ask(s, "HEAD", "/$name")
    assertEquals(200, file.status)
    assertEquals("${bytes.size}", file.header("Content-Length"))
    assertEquals("attachment; filename=\"$name\"", file.header("Content-Disposition"))
    assertEquals(0, file.body.size)
    val root = ask(s, "HEAD", "/")
    assertEquals(200, root.status)
    assertEquals("${page.size}", root.header("Content-Length"))
    assertEquals(0, root.body.size)
    assertEquals(2L, s.status().asked)
    assertEquals(0L, s.status().sent)
    assertEquals(0L, s.status().downloads)
  }

  @Test fun aRangeFromToIsPartOfTheFileAndNotADownload() {
    val s = serving()
    val a = ask(s, "GET", "/$name", "Range: bytes=100-199")
    assertEquals(206, a.status)
    assertEquals("bytes 100-199/${bytes.size}", a.header("Content-Range"))
    assertEquals(etag, a.header("ETag"))
    assertArrayEquals(bytes.copyOfRange(100, 200), a.body)
    assertCommon(a)
    assertEquals(100L, s.status().sent)
    assertEquals(0L, s.status().downloads)
    // An end past the file's is the file's end.
    val past = ask(s, "GET", "/$name", "Range: bytes=299990-400000")
    assertEquals(206, past.status)
    assertEquals("bytes 299990-299999/${bytes.size}", past.header("Content-Range"))
    assertArrayEquals(bytes.copyOfRange(299_990, 300_000), past.body)
  }

  /** Why: a download cut off resumes from where it stopped, and reaching the end then is a download. */
  @Test fun aRangeFromToTheEndResumesAndCountsADownload() {
    val s = serving()
    val a = ask(s, "GET", "/$name", "range: bytes=250000-")
    assertEquals(206, a.status)
    assertEquals("bytes 250000-299999/${bytes.size}", a.header("Content-Range"))
    assertArrayEquals(bytes.copyOfRange(250_000, 300_000), a.body)
    eventually("the download was counted") { s.status().downloads == 1L }
    assertEquals(50_000L, s.status().sent)
  }

  /** Why: Chrome resumes only with a validator, and sends it back in If-Range; another copy must start again. */
  @Test fun aRangeIsHonouredOnlyWhenIfRangeNamesThisCopy() {
    val s = serving()
    val lastModified = InstallFileServer.httpDate(file.lastModified())
    for (ok in listOf(etag, lastModified)) {
      val a = ask(s, "GET", "/$name", "Range: bytes=10-19", "If-Range: $ok")
      assertEquals(ok, 206, a.status)
      assertArrayEquals(bytes.copyOfRange(10, 20), a.body)
    }
    for (other in listOf("\"$name-1\"", "W/$etag", "Mon, 01 Jan 2001 00:00:00 GMT")) {
      val a = ask(s, "GET", "/$name", "Range: bytes=10-19", "If-Range: $other")
      assertEquals(other, 200, a.status)
      assertArrayEquals(bytes, a.body)
    }
    // Two If-Range headers cannot both hold.
    assertEquals(200, ask(s, "GET", "/$name", "Range: bytes=10-19", "If-Range: $etag", "If-Range: $etag").status)
  }

  @Test fun aSuffixRangeIsTheFilesLastBytes() {
    val s = serving()
    val a = ask(s, "GET", "/$name", "Range: bytes=-500")
    assertEquals(206, a.status)
    assertEquals("bytes 299500-299999/${bytes.size}", a.header("Content-Range"))
    assertArrayEquals(bytes.copyOfRange(299_500, 300_000), a.body)
    // More than the file is the whole file.
    val all = ask(s, "GET", "/$name", "Range: bytes=-999999")
    assertEquals(206, all.status)
    assertArrayEquals(bytes, all.body)
  }

  @Test fun aRangeOutsideTheFileIs416() {
    val s = serving()
    for (range in listOf("bytes=300000-", "bytes=400000-400010", "bytes=-0")) {
      val a = ask(s, "GET", "/$name", "Range: $range")
      assertEquals(range, 416, a.status)
      assertEquals("bytes */${bytes.size}", a.header("Content-Range"))
      assertCommon(a)
    }
    assertEquals(0L, s.status().sent)
  }

  @Test fun aRangeWrittenWronglyOrSeveralAreIgnoredForTheWholeFile() {
    val s = serving()
    for (range in listOf("bytes=0-10,20-30", "items=0-10", "bytes=20-10", "bytes=x-", "bytes=-")) {
      val a = ask(s, "GET", "/$name", "Range: $range")
      assertEquals(range, 200, a.status)
      assertEquals(bytes.size, a.body.size)
    }
  }

  @Test fun parsesEachRangeForm() {
    assertEquals(ByteRange(0, 9), parseRange("bytes=0-9", 100))
    assertEquals(ByteRange(90, 99), parseRange("bytes=90-", 100))
    assertEquals(ByteRange(80, 99), parseRange("bytes=-20", 100))
    assertEquals(ByteRange(0, 99), parseRange(" bytes = 0 - 1000 ", 100))
    assertEquals(ByteRange.UNSATISFIABLE, parseRange("bytes=100-", 100))
    assertNull(parseRange(null, 100))
    assertNull(parseRange("bytes=99999999999999999999-", 100))
  }

  /** Why: only the page and the one file are ever reachable; nothing is normalised into another path. */
  @Test fun anyOtherPathIs404() {
    val s = serving()
    for (path in listOf("/x", "/$name/", "//$name", "/./$name", "/%72${name.drop(1)}", "/?a=1", "/$name?x", "/index.html", "/../etc/hosts", "http://192.168.49.1/")) {
      val a = ask(s, "GET", path)
      assertEquals(path, 404, a.status)
      assertCommon(a)
    }
    assertEquals(0L, s.status().sent)
  }

  @Test fun anyOtherMethodIs405() {
    val s = serving()
    for (method in listOf("POST", "PUT", "DELETE", "OPTIONS", "get")) {
      val a = ask(s, method, "/")
      assertEquals(method, 405, a.status)
      assertEquals("GET, HEAD", a.header("Allow"))
      assertCommon(a)
    }
  }

  @Test fun aHeadOver8KiBIs400() {
    val s = serving()
    val a = ask(s, "GET", "/", "X-Pad: " + "a".repeat(9_000))
    assertEquals(400, a.status)
    assertCommon(a)
    // Just under the limit is still answered.
    val fits = "GET / HTTP/1.1\r\nX-Pad: ".length + "\r\n\r\n".length
    assertEquals(200, send(connect(s), "GET / HTTP/1.1\r\nX-Pad: " + "a".repeat(InstallFileServer.MAX_HEAD - fits) + "\r\n\r\n").status)
  }

  @Test fun aMalformedRequestIs400() {
    val s = serving()
    for (request in listOf("GET /\r\n\r\n", "GET / HTTP/2.0\r\n\r\n", "GET  / HTTP/1.1\r\n\r\n", "GET / HTTP/1.1\r\nNo colon\r\n\r\n", "GET / HTTP/1.1\r\nHost : x\r\n\r\n", "GET / HTTP/1.1\r\nA: b\r\n folded: c\r\n\r\n", "G(T / HTTP/1.1\r\n\r\n")) {
      assertEquals(request, 400, send(connect(s), request).status)
    }
  }

  /** Why: the screen ends a session nobody asks anything of; requests for anything else must not keep it alive. */
  @Test fun countsOnlyThePageAndTheFileAsAskedAndWhenTheLastCame() {
    val s = serving()
    assertEquals(InstallFileServer.Status(true, 0, bytes.size.toLong(), 0, 0, 0), s.status())
    ask(s, "GET", "/")
    now.set(5_000)
    ask(s, "GET", "/$name", "Range: bytes=0-9")
    now.set(9_000)
    ask(s, "GET", "/favicon.ico")
    ask(s, "POST", "/")
    send(connect(s), "nonsense\r\n\r\n")
    assertEquals(2L, s.status().asked)
    assertEquals(5_000L, s.status().lastAskedMs)
    assertEquals(10L, s.status().sent)
  }

  /** Why: a phone could open connections and hold them; past four at once, another is told to come back, not dropped. */
  @Test fun servesAtMostFourAtOnceAndAnswersAnyMore503() {
    val s = serving()
    val held = (1..4).map { connect(s) }
    val busy = send(connect(s), request("GET", "/"))
    assertEquals(503, busy.status)
    assertEquals("close", busy.header("Connection"))
    assertEquals("2", busy.header("Retry-After"))
    assertEquals("${busy.body.size}", busy.header("Content-Length"))
    assertEquals(0L, s.status().asked)
    // The four are still served, and once they are done, another is.
    for (c in held) assertEquals(200, send(c, request("GET", "/")).status)
    eventually("a fifth was served once the four were done") {
      try { ask(s, "GET", "/").status == 200 } catch (e: IOException) { false }
    }
  }

  /** Why: Linux takes packets for the group's address that arrive on any network; only the group's own phones are answered. */
  @Test fun closesAConnectionFromOutsideTheGroupUnanswered() {
    val s = serving(peers = Subnet(InetAddress.getByName("10.0.0.0"), 8))
    val outsider = connect(s)
    try { outsider.getOutputStream().write(request("GET", "/").toByteArray(Charsets.ISO_8859_1)) } catch (e: IOException) {}
    assertEquals(0, readAll(outsider).size)
    assertEquals(0L, s.status().asked)
    assertTrue(s.status().serving)
  }

  @Test fun aSubnetHoldsOnlyItsOwnAddresses() {
    val group = Subnet(InetAddress.getByName("192.168.49.1"), 24)
    assertTrue(group.contains(InetAddress.getByName("192.168.49.23")))
    assertTrue(group.contains(InetAddress.getByName("192.168.49.255")))
    assertFalse(group.contains(InetAddress.getByName("192.168.50.1")))
    assertFalse(group.contains(InetAddress.getByName("10.0.0.1")))
    assertFalse(group.contains(InetAddress.getByName("::1")))
    assertFalse(group.contains(null))
    val odd = Subnet(InetAddress.getByName("10.0.0.0"), 9)
    assertTrue(odd.contains(InetAddress.getByName("10.127.255.255")))
    assertFalse(odd.contains(InetAddress.getByName("10.128.0.0")))
    assertTrue(Subnet(InetAddress.getByName("10.0.0.0"), 0).contains(InetAddress.getByName("8.8.8.8")))
  }

  @Test fun aConnectionThatSendsNothingIsClosedAfterTheHeadsTime() {
    val s = serving(InstallFileServer.Limits(headMs = 200))
    val silent = connect(s)
    assertTrue("a silent connection was closed", closedBy(silent, 3_000))
    assertEquals(0L, s.status().asked)
  }

  /**
   * Why: the head's deadline bounds every read. Checked only after a read returned, a byte just
   * before the deadline bought a whole new wait, so a byte now and then held a place for good.
   */
  @Test fun aHeadThatGoesQuietJustBeforeItsDeadlineIsClosedAtTheDeadline() {
    val s = serving(InstallFileServer.Limits(headMs = 1_000))
    val trickle = connect(s)
    val started = System.currentTimeMillis()
    for (c in "GET / HTT") {
      trickle.getOutputStream().write(c.code)
      Thread.sleep(100)
    }
    assertTrue("the quiet head was closed", closedBy(trickle, 3_000))
    val took = System.currentTimeMillis() - started
    assertTrue("closed at the deadline, not a read's wait after it: $took ms", took < 1_600)
    assertEquals(0L, s.status().asked)
  }

  @Test fun aConnectionIsClosedPastItsWholeLife() {
    val s = serving(InstallFileServer.Limits(headMs = 60_000, connectionMs = 200, sweepMs = 50))
    assertTrue("a connection past its life was closed", closedBy(connect(s), 3_000))
  }

  /** Why: a phone that takes the file too slowly, or not at all, would hold its place for as long as it liked. */
  @Test fun aFileTakenTooSlowlyIsCutOffAndAHealthyOneIsNot() {
    val big = File(dir, "big.apk").apply { writeBytes(ByteArray(16 shl 20)) }
    val limits = InstallFileServer.Limits(minBytesPerSecond = 1L shl 20, rateWindowMs = 300, sweepMs = 50)
    val s = serving(limits, served = big)
    val slow = connect(s)
    slow.getOutputStream().write(request("GET", "/$name").toByteArray(Charsets.ISO_8859_1))
    // Takes nothing until well past a window, then reads what got through.
    Thread.sleep(1_000)
    val got = readAll(slow)
    assertTrue("cut off short of the file: ${got.size}", got.size < big.length())
    assertEquals(0L, s.status().downloads)
    // At loopback's speed the same limits let the whole file through.
    val whole = ask(s, "GET", "/$name")
    assertEquals(200, whole.status)
    assertEquals(big.length().toInt(), whole.body.size)
  }

  /** Why: a session JavaScript forgot would otherwise hold the Wi-Fi group for as long as the app ran. */
  @Test fun stopsItselfWhenTheSessionsTimeIsUp() {
    val stopped = AtomicInteger()
    val s = serving(InstallFileServer.Limits(serveMs = 300, sweepMs = 50), onStopped = { stopped.incrementAndGet() })
    assertTrue(s.status().serving)
    eventually("serving stopped") { !s.status().serving }
    eventually("the session was told") { stopped.get() == 1 }
    Thread.sleep(200)
    assertEquals(1, stopped.get())
  }

  @Test fun stopsItselfWhenTheGroupHasGone() {
    val there = AtomicBoolean(true)
    val stopped = AtomicInteger()
    val s = serving(InstallFileServer.Limits(sweepMs = 50), stillThere = { there.get() }, onStopped = { stopped.incrementAndGet() })
    val waiting = connect(s)
    assertEquals(200, ask(s, "GET", "/").status)
    there.set(false)
    eventually("serving stopped") { !s.status().serving }
    assertEquals(1, stopped.get())
    assertTrue("an open connection was closed", closedBy(waiting, 2_000))
  }

  /** Why: one failed accept (too many open files, say) ended the server for good. */
  @Test fun keepsAcceptingAfterAnAcceptFails() {
    val failing = object : ServerSocket(0, 8, loopback) {
      val failures = AtomicInteger(1)
      override fun accept(): Socket {
        if (failures.getAndDecrement() > 0) throw IOException("too many open files")
        return super.accept()
      }
    }
    val s = serving(socket = failing)
    assertEquals(200, ask(s, "GET", "/").status)
    assertTrue(s.status().serving)
  }

  @Test fun closeStopsServingAndClosesOpenConnections() {
    val stopped = AtomicInteger()
    val s = serving(onStopped = { stopped.incrementAndGet() })
    val waiting = connect(s)
    s.close()
    assertFalse(s.status().serving)
    assertTrue("an open connection was closed", closedBy(waiting, 2_000))
    try {
      val late = Socket(loopback, ports.getValue(s))
      opened.add(late)
      assertTrue("a later connection was not served", closedBy(late, 2_000))
    } catch (e: ConnectException) {
      // Refused: nothing listens any more.
    }
    s.close()
    // A close from outside is not the server stopping itself.
    assertEquals(0, stopped.get())
  }

  @Test fun closeWhileAConnectionArrivesNeverThrows() {
    // Why: close() took a copy of the open connections with toList(), which threw when the accept
    // thread dropped one between the copy's size and its first element (CI on PR 527). This loop
    // threw before the fix.
    repeat(400) {
      val s = serving()
      Socket(loopback, ports.getValue(s)).also { opened.add(it) }
      s.close()
    }
  }

  @Test fun refusesANameThatIsNotPlain() {
    for (bad in listOf("", "a b.apk", "x\".apk", "a/b.apk", "a\r\nb.apk")) {
      try {
        InstallFileServer(ServerSocket(0, 1, loopback).also { opened.add(it) }, page, bad, file, Subnet(loopback, 8))
        fail("took $bad")
      } catch (e: IllegalArgumentException) {}
    }
  }
}
