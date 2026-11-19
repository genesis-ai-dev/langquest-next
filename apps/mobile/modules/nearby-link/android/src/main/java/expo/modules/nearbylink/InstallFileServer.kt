package expo.modules.nearbylink

import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Give the app's page and file (docs/nearby-sync-plan.md 14.5): a small HTTP/1.1 server on the
 * Wi-Fi Direct group's own address, so only a phone in the group, which knows its passphrase,
 * reaches it. `GET /` is the page JavaScript wrote, `GET /<name>` the kept install file, with one
 * `Range` honoured (and `If-Range` against its validators) so a cut-off download resumes. Paths
 * are matched as exact strings and never normalised, so nothing else on the phone is ever
 * reachable: any other path is 404, any other method 405, and a request line and headers over
 * 8 KiB, or malformed, 400. Every answer closes its connection.
 *
 * It answers only `peers`, the group's own network: Linux takes packets for the group's address
 * that arrive on any interface, so the bound address alone does not keep other networks out.
 * At most `Limits.connections` are served at once; a further one is answered 503. A sweep on a
 * timer holds each connection to `Limits` (its whole life, and a floor on how fast an answer
 * moves), and stops serving altogether once the session's time is up or the group has gone
 * (`stillThere`), calling `onStopped`. Only requests for the page and the file count as asked,
 * so other requests cannot keep a session alive. It logs nothing. Pure Kotlin on `java.*`, so
 * JUnit runs it over loopback; the caller binds the socket, and `close` closes it.
 */
class InstallFileServer(
  private val server: ServerSocket,
  page: ByteArray,
  private val name: String,
  private val file: File,
  private val peers: Subnet,
  private val limits: Limits = Limits(),
  /** Whether the group is still there, asked at each sweep. */
  private val stillThere: () -> Boolean = { true },
  /** Called once when serving stops by itself: the session's time ran out, or the group went. */
  private val onStopped: () -> Unit = {},
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  /** How long and how slowly a connection and the session may run. */
  data class Limits(
    val connections: Int = 4,
    /** The request line and headers must all come within this. */
    val headMs: Long = 20_000,
    /** A connection's whole life, page or file. */
    val connectionMs: Long = 15 * 60_000L,
    /** While the file is sent, each window must move at least this many bytes a second. */
    val minBytesPerSecond: Long = 16 * 1024L,
    val rateWindowMs: Long = 15_000,
    /** The session's whole life, whatever JavaScript does. */
    val serveMs: Long = 30 * 60_000L,
    val sweepMs: Long = 1_000,
    /** How long a closing connection reads what the phone still sends. */
    val lingerMs: Long = 2_000,
  )

  private val page = page.copyOf()
  private val filePath = "/$name"
  /** The file's size when serving began: what `Content-Length` and `total` say. */
  val total: Long = file.length()
  /** The file's validators, so a browser can resume a download: its name holds a hash, so name and size are enough. */
  private val etag = "\"$name-$total\""
  private val lastModified = httpDate(file.lastModified())

  private val sentBytes = AtomicLong()
  private val downloadsDone = AtomicLong()
  private val askedCount = AtomicLong()
  private val lastAsked = AtomicLong()
  private val active = AtomicInteger()
  private val open = ConcurrentHashMap.newKeySet<Connection>()
  private val stoppedItself = AtomicBoolean()
  private val startedAt = System.nanoTime()
  @Volatile private var closed = false
  @Volatile private var accepting = false

  private val sweeper = Executors.newSingleThreadScheduledExecutor(daemon("give-app-sweep"))
  /** Answers 503 off the accept thread, one at a time, a few waiting; past that a connection is closed. */
  private val refuser = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(8), daemon("give-app-busy"))

  init {
    // The name goes into a header and a path as it is: a carried build's name is plain.
    require(name.isNotEmpty() && name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "._-" }) { "a plain file name" }
  }

  /** What the screen shows (`NativeGiveStatus` in src/NearbyLinkModule.ts). */
  data class Status(val serving: Boolean, val sent: Long, val total: Long, val downloads: Long, val asked: Long, val lastAskedMs: Long)

  fun status(): Status = Status(accepting && !closed, sentBytes.get(), total, downloadsDone.get(), askedCount.get(), lastAsked.get())

  private class Connection(val socket: Socket) {
    val since = System.nanoTime()
    /** While the file is being sent: when the current window began (0 otherwise), and what it has moved. */
    val windowStart = AtomicLong()
    val windowBytes = AtomicLong()

    fun close() {
      try { socket.close() } catch (_: IOException) {}
    }
  }

  fun start() {
    accepting = true
    sweeper.scheduleWithFixedDelay({
      try { sweep() } catch (_: Exception) {}
    }, limits.sweepMs, limits.sweepMs, TimeUnit.MILLISECONDS)
    Thread({ acceptLoop() }, "give-app-accept").apply {
      isDaemon = true
      start()
    }
  }

  private fun acceptLoop() {
    try {
      while (!closed) {
        val socket = try {
          server.accept()
        } catch (e: IOException) {
          if (closed || server.isClosed) break
          // A failure that can pass, such as too many open files: try again shortly.
          try { Thread.sleep(ACCEPT_BACKOFF_MS) } catch (_: InterruptedException) { break }
          continue
        }
        if (!peers.contains(socket.inetAddress)) {
          quietlyClose(socket)
          continue
        }
        if (active.incrementAndGet() > limits.connections) {
          active.decrementAndGet()
          refuse(socket)
          continue
        }
        val conn = Connection(socket)
        open.add(conn)
        if (closed) {
          done(conn)
          break
        }
        Thread({ serve(conn) }, "give-app-serve").apply {
          isDaemon = true
          start()
        }
      }
    } finally {
      accepting = false
    }
  }

  /** Stops accepting and closes every open connection. */
  fun close() {
    closed = true
    try { server.close() } catch (_: IOException) {}
    sweeper.shutdown()
    refuser.shutdownNow()
    // Straight over the set, never `toList()`: that reads the size, then takes the first element, and
    // the accept thread can remove a connection between the two (NoSuchElementException, CI 2026-11-19).
    for (c in open) c.close()
  }

  /** On the timer: the session's own limits, then each connection's. */
  private fun sweep() {
    if (closed) return
    val now = System.nanoTime()
    if (now - startedAt > nanos(limits.serveMs) || !stillThereNow()) {
      if (stoppedItself.compareAndSet(false, true)) {
        close()
        try { onStopped() } catch (_: Exception) {}
      }
      return
    }
    for (c in open) {
      if (now - c.since > nanos(limits.connectionMs)) {
        c.close()
        continue
      }
      val window = c.windowStart.get()
      if (window != 0L && now - window >= nanos(limits.rateWindowMs) && c.windowStart.compareAndSet(window, now)) {
        val moved = c.windowBytes.getAndSet(0)
        if (moved * 1_000 < limits.minBytesPerSecond * limits.rateWindowMs) c.close()
      }
    }
  }

  /** A check that cannot itself be answered says nothing: only a clear "gone" stops the session. */
  private fun stillThereNow(): Boolean = try { stillThere() } catch (e: Exception) { true }

  private fun done(conn: Connection) {
    open.remove(conn)
    conn.close()
    active.decrementAndGet()
  }

  /** Every place is taken: says so with 503 rather than a silent close, which a browser reads as a broken network. */
  private fun refuse(socket: Socket) {
    try {
      refuser.execute {
        try {
          val body = "Busy: try again in a moment\n".toByteArray(Charsets.UTF_8)
          val out = socket.getOutputStream()
          out.write(status(503, "Service Unavailable", listOf("Retry-After" to "2", "Content-Length" to "${body.size}"), TEXT) + body)
          out.flush()
          linger(socket, socket.getInputStream(), REFUSE_LINGER_MS)
        } catch (_: IOException) {
        } finally {
          quietlyClose(socket)
        }
      }
    } catch (e: RejectedExecutionException) {
      quietlyClose(socket)
    }
  }

  private fun serve(conn: Connection) {
    try {
      val socket = conn.socket
      val input = socket.getInputStream()
      val out = socket.getOutputStream()
      // Nothing came in time, or the phone went: there is nobody to answer.
      val lines = try { readHead(socket, input) ?: return } catch (e: HeadTooLarge) { null }
      val request = lines?.let { parse(it) }
      if (request == null) answer(out, 400, "Bad Request", emptyList(), text("Bad request"), false) else respond(conn, out, request)
      linger(socket, input, limits.lingerMs)
    } catch (_: IOException) {
    } finally {
      done(conn)
    }
  }

  private class HeadTooLarge : Exception()

  /**
   * The request line and headers, without the blank line that ends them; null at the end of the
   * stream, or when they have not all come by the head's deadline, which bounds every read (so a
   * phone sending a byte now and then holds no place for long). `HeadTooLarge` past `MAX_HEAD`.
   */
  private fun readHead(socket: Socket, input: InputStream): List<String>? {
    val until = System.nanoTime() + nanos(limits.headMs)
    val buf = ByteArray(MAX_HEAD)
    val lines = ArrayList<String>()
    var len = 0
    var lineStart = 0
    while (true) {
      val left = (until - System.nanoTime()) / 1_000_000
      if (left <= 0) return null
      if (len == buf.size) throw HeadTooLarge()
      socket.soTimeout = left.coerceIn(1, Int.MAX_VALUE.toLong()).toInt()
      val n = try { input.read(buf, len, buf.size - len) } catch (e: SocketTimeoutException) { return null }
      if (n < 0) return null
      var i = len
      len += n
      while (i < len) {
        if (buf[i] == '\n'.code.toByte()) {
          val text = String(buf, lineStart, i - lineStart, Charsets.ISO_8859_1).removeSuffix("\r")
          lineStart = i + 1
          // An empty line before the request line is skipped (RFC 9112 2.2); after it, it ends the head.
          if (text.isEmpty()) {
            if (lines.isNotEmpty()) return lines
          } else {
            lines.add(text)
          }
        }
        i++
      }
    }
  }

  private class Request(val method: String, val target: String, val range: String?, val ifRange: String?)

  /** The request, or null when it is malformed. */
  private fun parse(lines: List<String>): Request? {
    val parts = lines[0].split(' ')
    if (parts.size != 3) return null
    val (method, target, version) = parts
    if (method.isEmpty() || !method.all(::tchar)) return null
    if (target.isEmpty() || target.any { it.code <= 0x20 || it.code >= 0x7f }) return null
    if (version != "HTTP/1.1" && version != "HTTP/1.0") return null
    val ranges = ArrayList<String>()
    val ifRanges = ArrayList<String>()
    for (h in lines.drop(1)) {
      val colon = h.indexOf(':')
      if (colon <= 0) return null
      val field = h.substring(0, colon)
      // A folded line, or a space before the colon, is refused (RFC 9112 5.1, 5.2).
      if (!field.all(::tchar)) return null
      val value = h.substring(colon + 1).trim()
      if (field.equals("Range", ignoreCase = true)) ranges.add(value)
      if (field.equals("If-Range", ignoreCase = true)) ifRanges.add(value)
    }
    // Two If-Range headers cannot both hold: the whole file then.
    val range = if (ifRanges.size > 1) null else ranges.singleOrNull()
    return Request(method, target, range, ifRanges.singleOrNull())
  }

  private fun respond(conn: Connection, out: OutputStream, r: Request) {
    val head = r.method == "HEAD"
    if (r.method != "GET" && !head) {
      answer(out, 405, "Method Not Allowed", listOf("Allow" to "GET, HEAD"), text("Method not allowed"), false)
      return
    }
    when (r.target) {
      "/" -> {
        asked()
        answer(out, 200, "OK", PAGE_HEADERS, Body("text/html; charset=utf-8", page), head)
      }
      filePath -> {
        asked()
        sendFile(conn, out, r, head)
      }
      else -> answer(out, 404, "Not Found", emptyList(), text("Not found"), head)
    }
  }

  private fun sendFile(conn: Connection, out: OutputStream, r: Request, head: Boolean) {
    val size = total
    val validators = listOf("ETag" to etag, "Last-Modified" to lastModified, "Accept-Ranges" to "bytes")
    // If-Range names the copy the phone has part of: another copy gets the whole file (RFC 9110 13.1.5).
    val wanted = if (r.ifRange != null && r.ifRange != etag && r.ifRange != lastModified) null else r.range
    val range = parseRange(wanted, size)
    if (range == ByteRange.UNSATISFIABLE) {
      answer(out, 416, "Range Not Satisfiable", validators + ("Content-Range" to "bytes */$size"), text("Range not satisfiable"), head)
      return
    }
    val input = try {
      if (file.length() == size) FileInputStream(file) else null
    } catch (e: IOException) {
      null
    }
    if (input == null) {
      // The kept file went, or changed, since serving began.
      answer(out, 404, "Not Found", emptyList(), text("Not found"), head)
      return
    }
    input.use { stream ->
      val start = range?.start ?: 0L
      val end = range?.end ?: (size - 1)
      val length = if (size == 0L) 0L else end - start + 1
      val headers = listOf("Content-Disposition" to "attachment; filename=\"$name\"") + validators + ("Content-Length" to "$length") +
        (if (range != null) listOf("Content-Range" to "bytes $start-$end/$size") else emptyList())
      out.write(if (range != null) status(206, "Partial Content", headers, APK) else status(200, "OK", headers, APK))
      if (head) {
        out.flush()
        return
      }
      stream.channel.position(start)
      val buffer = ByteArray(CHUNK)
      var left = length
      conn.windowStart.set(System.nanoTime())
      try {
        while (left > 0) {
          val n = stream.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
          if (n < 0) return
          out.write(buffer, 0, n)
          conn.windowBytes.addAndGet(n.toLong())
          sentBytes.addAndGet(n.toLong())
          left -= n
        }
        out.flush()
      } finally {
        conn.windowStart.set(0)
      }
      if (end == size - 1) downloadsDone.incrementAndGet()
    }
  }

  private class Body(val type: String, val bytes: ByteArray)

  private fun text(words: String) = Body(TEXT, "$words\n".toByteArray(Charsets.UTF_8))

  private fun answer(out: OutputStream, code: Int, reason: String, headers: List<Pair<String, String>>, body: Body, head: Boolean) {
    val start = status(code, reason, headers + ("Content-Length" to "${body.bytes.size}"), body.type)
    out.write(if (head) start else start + body.bytes)
    out.flush()
  }

  private fun status(code: Int, reason: String, headers: List<Pair<String, String>>, type: String): ByteArray {
    val s = StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n")
    for ((k, v) in listOf("Content-Type" to type) + headers + COMMON) s.append(k).append(": ").append(v).append("\r\n")
    s.append("\r\n")
    return s.toString().toByteArray(Charsets.US_ASCII)
  }

  private fun asked() {
    askedCount.incrementAndGet()
    lastAsked.set(clock())
  }

  /**
   * Sends the end of the answer, then reads what the phone still sends for up to `ms` before
   * closing: closing with its bytes unread would reset the connection, and the phone could lose
   * the answer.
   */
  private fun linger(socket: Socket, input: InputStream, ms: Long) {
    try {
      socket.shutdownOutput()
      val until = System.nanoTime() + nanos(ms)
      val sink = ByteArray(4_096)
      var drained = 0
      while (drained < 65_536) {
        val left = (until - System.nanoTime()) / 1_000_000
        if (left <= 0) break
        socket.soTimeout = left.toInt().coerceAtLeast(1)
        val n = input.read(sink)
        if (n < 0) break
        drained += n
      }
    } catch (_: IOException) {}
  }

  companion object {
    /** The request line and headers, blank line and all. */
    const val MAX_HEAD = 8_192
    private const val CHUNK = 64 * 1024
    private const val ACCEPT_BACKOFF_MS = 250L
    private const val REFUSE_LINGER_MS = 200L
    private const val APK = "application/vnd.android.package-archive"
    private const val TEXT = "text/plain; charset=utf-8"
    private val COMMON = listOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff", "Connection" to "close")
    /** The page has inline styles and SVG, and no script or outside resource; nothing else may load, frame it or be sent from it. */
    private val PAGE_HEADERS = listOf(
      "Content-Security-Policy" to "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy" to "no-referrer",
    )

    private fun tchar(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "!#$%&'*+-.^_`|~"

    /** Milliseconds as nanoseconds, for `System.nanoTime`. */
    private fun nanos(ms: Long): Long = ms * 1_000_000L

    private fun quietlyClose(socket: Socket) {
      try { socket.close() } catch (_: IOException) {}
    }

    private fun daemon(name: String) = ThreadFactory { r -> Thread(r, name).apply { isDaemon = true } }

    /** An HTTP date (RFC 9110 5.6.7), as `Last-Modified` and `If-Range` write it. */
    fun httpDate(ms: Long): String =
      SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US).apply { timeZone = TimeZone.getTimeZone("GMT") }.format(Date(ms))
  }
}

/** A network: the first `prefix` bits of `base`. The group's own, so only phones in the group are answered. */
class Subnet(base: InetAddress, private val prefix: Int) {
  private val bytes = base.address

  init {
    require(prefix in 0..bytes.size * 8) { "a prefix within the address" }
  }

  fun contains(address: InetAddress?): Boolean {
    val other = address?.address ?: return false
    if (other.size != bytes.size) return false
    var bits = prefix
    var i = 0
    while (bits > 0) {
      val mask = if (bits >= 8) 0xff else (0xff shl (8 - bits)) and 0xff
      if ((other[i].toInt() and mask) != (bytes[i].toInt() and mask)) return false
      bits -= 8
      i++
    }
    return true
  }
}

/** One byte range of a file, both ends included; `UNSATISFIABLE` for a range outside it. */
data class ByteRange(val start: Long, val end: Long) {
  companion object {
    val UNSATISFIABLE = ByteRange(-1, -1)
  }
}

/**
 * The one range a `Range` header asks of a file of `size` bytes (RFC 9110 14.1): `bytes=a-b`,
 * `bytes=a-` or `bytes=-n`. Null means the whole file: no header, or one this server ignores
 * (another unit, several ranges, or one written wrongly), as the RFC allows. `UNSATISFIABLE` is a
 * range that starts past the end, or asks for none of it.
 */
fun parseRange(header: String?, size: Long): ByteRange? {
  if (header == null) return null
  val eq = header.indexOf('=')
  if (eq < 0 || !header.substring(0, eq).trim().equals("bytes", ignoreCase = true)) return null
  val spec = header.substring(eq + 1).trim()
  if (spec.contains(',')) return null
  val dash = spec.indexOf('-')
  if (dash < 0) return null
  val first = spec.substring(0, dash).trim()
  val last = spec.substring(dash + 1).trim()
  val number = { s: String -> if (s.isNotEmpty() && s.length <= 18 && s.all { it in '0'..'9' }) s.toLong() else null }
  if (first.isEmpty()) {
    val n = number(last) ?: return null
    if (n == 0L || size == 0L) return ByteRange.UNSATISFIABLE
    return ByteRange(maxOf(0L, size - n), size - 1)
  }
  val a = number(first) ?: return null
  val b = if (last.isEmpty()) null else (number(last) ?: return null)
  if (b != null && b < a) return null
  if (a >= size) return ByteRange.UNSATISFIABLE
  return ByteRange(a, minOf(b ?: (size - 1), size - 1))
}
