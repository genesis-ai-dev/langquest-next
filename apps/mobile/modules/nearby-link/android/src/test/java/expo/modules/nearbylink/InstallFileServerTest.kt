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
import java.util.concurrent.atomic.AtomicLong

/** Give the app's page and file server over loopback, as the group serves it (docs/nearby-sync-plan.md 14.5). */
class InstallFileServerTest {
  private val name = "r21-l1-p1-0a1b2c3d.apk"
  private val page = "<!doctype html><title>Install</title><p>Télécharger</p>".toByteArray(Charsets.UTF_8)
  private val bytes = ByteArray(300_000).also { Random(7).nextBytes(it) }
  private val dir = File(System.getProperty("java.io.tmpdir"), "give-app-${System.nanoTime()}").apply { mkdirs() }
  private val file = File(dir, name).apply { writeBytes(bytes) }
  private val now = AtomicLong(1_000)
  private val opened = ArrayList<AutoCloseable>()

  @After fun tearDown() {
    opened.forEach { try { it.close() } catch (_: Exception) {} }
    dir.deleteRecursively()
  }

  private fun serving(maxConnections: Int = 4, timeoutMs: Int = 20_000): InstallFileServer {
    val socket = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
    val s = InstallFileServer(socket, page, name, file, maxConnections, timeoutMs) { now.get() }
    opened.add(AutoCloseable { s.close() })
    ports[s] = socket.localPort
    s.start()
    return s
  }

  private val ports = HashMap<InstallFileServer, Int>()

  private fun connect(s: InstallFileServer): Socket = Socket(InetAddress.getLoopbackAddress(), ports.getValue(s)).also {
    it.soTimeout = 5_000
    opened.add(it)
  }

  private class Answer(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
    fun header(name: String): String? = headers[name.lowercase()]
  }

  /** Sends `request` as it is, reads the answer to the end of the stream (every answer closes), and closes, as a browser does. */
  private fun send(socket: Socket, request: String): Answer {
    val raw = socket.use {
      it.getOutputStream().write(request.toByteArray(Charsets.ISO_8859_1))
      it.getOutputStream().flush()
      val all = ByteArrayOutputStream()
      it.getInputStream().copyTo(all)
      all.toByteArray()
    }
    val split = (0..raw.size - 4).firstOrNull { raw[it] == '\r'.code.toByte() && raw[it + 1] == '\n'.code.toByte() && raw[it + 2] == '\r'.code.toByte() && raw[it + 3] == '\n'.code.toByte() }
      ?: throw IOException("no answer")
    val lines = String(raw, 0, split, Charsets.ISO_8859_1).split("\r\n")
    val status = lines[0].split(' ')[1].toInt()
    assertTrue(lines[0], lines[0].startsWith("HTTP/1.1 "))
    val headers = lines.drop(1).associate { l -> l.substringBefore(':').lowercase() to l.substringAfter(':').trim() }
    return Answer(status, headers, raw.copyOfRange(split + 4, raw.size))
  }

  private fun ask(s: InstallFileServer, method: String, path: String, vararg headers: String): Answer =
    send(connect(s), "$method $path HTTP/1.1\r\nHost: 192.168.49.1:8080\r\n" + headers.joinToString("") { "$it\r\n" } + "\r\n")

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

  @Test fun servesThePageAtTheRoot() {
    val s = serving()
    val a = ask(s, "GET", "/")
    assertEquals(200, a.status)
    assertEquals("text/html; charset=utf-8", a.header("Content-Type"))
    assertArrayEquals(page, a.body)
    assertCommon(a)
    assertEquals(0L, s.status().sent)
  }

  @Test fun servesTheFileWholeAsAnAttachmentAndCountsADownload() {
    val s = serving()
    val a = ask(s, "GET", "/$name")
    assertEquals(200, a.status)
    assertEquals("application/vnd.android.package-archive", a.header("Content-Type"))
    assertEquals("attachment; filename=\"$name\"", a.header("Content-Disposition"))
    assertEquals("bytes", a.header("Accept-Ranges"))
    assertNull(a.header("Content-Range"))
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
    eventually("both were answered") { s.status().asked == 2L }
    assertEquals(0L, s.status().sent)
    assertEquals(0L, s.status().downloads)
  }

  @Test fun aRangeFromToIsPartOfTheFileAndNotADownload() {
    val s = serving()
    val a = ask(s, "GET", "/$name", "Range: bytes=100-199")
    assertEquals(206, a.status)
    assertEquals("bytes 100-199/${bytes.size}", a.header("Content-Range"))
    assertArrayEquals(bytes.copyOfRange(100, 200), a.body)
    assertCommon(a)
    eventually("it was answered") { s.status().asked == 1L }
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

  @Test fun countsEveryAnswerAndWhenTheLastCame() {
    val s = serving()
    assertEquals(InstallFileServer.Status(true, 0, bytes.size.toLong(), 0, 0, 0), s.status())
    ask(s, "GET", "/")
    now.set(5_000)
    ask(s, "GET", "/favicon.ico")
    now.set(9_000)
    ask(s, "GET", "/$name", "Range: bytes=0-9")
    eventually("three were answered") { s.status().asked == 3L }
    assertEquals(9_000L, s.status().lastAskedMs)
    assertEquals(10L, s.status().sent)
  }

  /** Why: a phone could open connections and hold them; past four at once, more are closed at once. */
  @Test fun servesAtMostFourAtOnceAndClosesAnyMore() {
    val s = serving()
    val held = (1..4).map { connect(s) }
    val extra = connect(s)
    assertTrue("a fifth was closed at once", closedBy(extra, 1_000))
    // The four are still served.
    for (c in held) assertEquals(200, send(c, "GET / HTTP/1.1\r\n\r\n").status)
    // And once they are done, another is.
    eventually("a fifth was served once the four were done") {
      try { ask(s, "GET", "/").status == 200 } catch (e: IOException) { false }
    }
  }

  @Test fun aConnectionThatSendsNothingIsClosedAfterTheTimeout() {
    val s = serving(timeoutMs = 200)
    val silent = connect(s)
    assertTrue("a silent connection was closed", closedBy(silent, 3_000))
    assertEquals(0L, s.status().asked)
  }

  @Test fun closeStopsServingAndClosesOpenConnections() {
    val s = serving()
    val waiting = connect(s)
    s.close()
    assertFalse(s.status().serving)
    assertTrue("an open connection was closed", closedBy(waiting, 2_000))
    try {
      val late = Socket(InetAddress.getLoopbackAddress(), ports.getValue(s))
      opened.add(late)
      assertTrue("a later connection was not served", closedBy(late, 2_000))
    } catch (e: ConnectException) {
      // Refused: nothing listens any more.
    }
    s.close()
  }

  @Test fun refusesANameThatIsNotPlain() {
    for (bad in listOf("", "a b.apk", "x\".apk", "a/b.apk", "a\r\nb.apk")) {
      try {
        InstallFileServer(ServerSocket(0, 1, InetAddress.getLoopbackAddress()).also { opened.add(it) }, page, bad, file)
        fail("took $bad")
      } catch (e: IllegalArgumentException) {}
    }
  }
}
