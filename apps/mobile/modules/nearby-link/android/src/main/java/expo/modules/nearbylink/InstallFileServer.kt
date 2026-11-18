package expo.modules.nearbylink

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Give the app's page and file (docs/nearby-sync-plan.md 14.5): a small HTTP/1.1 server on the
 * Wi-Fi Direct group's own address, so only a phone in the group, which knows its passphrase,
 * reaches it. `GET /` is the page JavaScript wrote, `GET /<name>` the kept install file, with one
 * `Range` honoured so a cut-off download resumes. Paths are matched as exact strings and never
 * normalised, so nothing else on the phone is ever reachable: any other path is 404, any other
 * method 405, and a request line and headers over 8 KiB, or malformed, 400. Every answer closes
 * its connection.
 *
 * At most `maxConnections` are served at once and a further one is closed at once. A connection
 * whose request has not all come within `timeoutMs`, or that takes nothing of an answer for as
 * long, is closed. It counts what it does for the screen, and logs nothing. Pure Kotlin on
 * `java.*`, so JUnit runs it over loopback; the caller binds the socket, and `close` closes it.
 */
class InstallFileServer(
  private val server: ServerSocket,
  page: ByteArray,
  private val name: String,
  private val file: File,
  private val maxConnections: Int = 4,
  private val timeoutMs: Int = 20_000,
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  private val page = page.copyOf()
  private val filePath = "/$name"
  /** The file's size when serving began: what `Content-Length` and `total` say. */
  val total: Long = file.length()

  private val sentBytes = AtomicLong()
  private val downloadsDone = AtomicLong()
  private val askedCount = AtomicLong()
  private val lastAsked = AtomicLong()
  private val active = AtomicInteger()
  private val open = ConcurrentHashMap.newKeySet<Connection>()
  @Volatile private var closed = false
  @Volatile private var accepting = false

  init {
    // The name goes into a header and a path as it is: a carried build's name is plain.
    require(name.isNotEmpty() && name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "._-" }) { "a plain file name" }
  }

  /** What the screen shows (`NativeGiveStatus` in src/NearbyLinkModule.ts). */
  data class Status(val serving: Boolean, val sent: Long, val total: Long, val downloads: Long, val asked: Long, val lastAskedMs: Long)

  fun status(): Status = Status(accepting && !closed, sentBytes.get(), total, downloadsDone.get(), askedCount.get(), lastAsked.get())

  private class Connection(val socket: Socket) {
    /** When a byte of the answer last left, while one is being sent; 0 otherwise. */
    @Volatile var writingSince = 0L

    fun close() {
      try { socket.close() } catch (_: IOException) {}
    }
  }

  fun start() {
    accepting = true
    Thread({
      try {
        // Wakes now and then to close a connection whose answer stopped moving.
        server.soTimeout = 1_000
        while (!closed) {
          val socket = try {
            server.accept()
          } catch (e: SocketTimeoutException) {
            sweep()
            continue
          } catch (e: IOException) {
            break
          }
          if (active.incrementAndGet() > maxConnections) {
            active.decrementAndGet()
            try { socket.close() } catch (_: IOException) {}
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
      } catch (_: IOException) {
      } finally {
        accepting = false
      }
    }, "give-app-accept").apply {
      isDaemon = true
      start()
    }
  }

  /** Stops accepting and closes every open connection. */
  fun close() {
    closed = true
    try { server.close() } catch (_: IOException) {}
    for (c in open.toList()) c.close()
  }

  private fun sweep() {
    val now = System.nanoTime()
    for (c in open) {
      val since = c.writingSince
      if (since != 0L && now - since > timeoutMs * 1_000_000L) c.close()
    }
  }

  private fun done(conn: Connection) {
    open.remove(conn)
    conn.close()
    active.decrementAndGet()
  }

  private fun serve(conn: Connection) {
    try {
      val socket = conn.socket
      socket.soTimeout = timeoutMs
      val input = BufferedInputStream(socket.getInputStream(), 1_024)
      val out = socket.getOutputStream()
      // Nothing came in time, or the phone went: there is nobody to answer.
      val lines = try { readHead(input) ?: return } catch (e: HeadTooLarge) { null }
      val request = lines?.let { parse(it) }
      answered()
      if (request == null) answer(conn, out, 400, "Bad Request", emptyList(), text("Bad request"), false) else respond(conn, out, request)
      linger(socket, input)
    } catch (_: IOException) {
    } finally {
      done(conn)
    }
  }

  private class HeadTooLarge : Exception()

  /**
   * The request line and headers, without the blank line that ends them; null at the end of the
   * stream, or when they have not all come within the timeout (a phone sending a byte now and then
   * holds no place for long). `HeadTooLarge` past `MAX_HEAD` bytes.
   */
  private fun readHead(input: InputStream): List<String>? {
    val lines = ArrayList<String>()
    val line = ByteArrayOutputStream(128)
    val until = System.nanoTime() + timeoutMs * 1_000_000L
    var size = 0
    while (true) {
      val b = try { input.read() } catch (e: SocketTimeoutException) { return null }
      if (b < 0 || System.nanoTime() > until) return null
      size += 1
      if (size > MAX_HEAD) throw HeadTooLarge()
      if (b == '\n'.code) {
        val text = String(line.toByteArray(), Charsets.ISO_8859_1).removeSuffix("\r")
        line.reset()
        if (text.isEmpty()) {
          // An empty line before the request line is skipped (RFC 9112 2.2).
          if (lines.isEmpty()) continue
          return lines
        }
        lines.add(text)
      } else {
        line.write(b)
      }
    }
  }

  private class Request(val method: String, val target: String, val range: String?)

  /** The request, or null when it is malformed. */
  private fun parse(lines: List<String>): Request? {
    val parts = lines[0].split(' ')
    if (parts.size != 3) return null
    val (method, target, version) = parts
    if (method.isEmpty() || !method.all(::tchar)) return null
    if (target.isEmpty() || target.any { it.code <= 0x20 || it.code >= 0x7f }) return null
    if (version != "HTTP/1.1" && version != "HTTP/1.0") return null
    val ranges = ArrayList<String>()
    for (h in lines.drop(1)) {
      val colon = h.indexOf(':')
      if (colon <= 0) return null
      val field = h.substring(0, colon)
      // A folded line, or a space before the colon, is refused (RFC 9112 5.1, 5.2).
      if (!field.all(::tchar)) return null
      if (field.equals("Range", ignoreCase = true)) ranges.add(h.substring(colon + 1).trim())
    }
    return Request(method, target, ranges.singleOrNull())
  }

  private fun respond(conn: Connection, out: OutputStream, r: Request) {
    val head = r.method == "HEAD"
    if (r.method != "GET" && !head) {
      answer(conn, out, 405, "Method Not Allowed", listOf("Allow" to "GET, HEAD"), text("Method not allowed"), false)
      return
    }
    when (r.target) {
      "/" -> answer(conn, out, 200, "OK", emptyList(), Body("text/html; charset=utf-8", page), head)
      filePath -> sendFile(conn, out, r.range, head)
      else -> answer(conn, out, 404, "Not Found", emptyList(), text("Not found"), head)
    }
  }

  private fun sendFile(conn: Connection, out: OutputStream, rangeHeader: String?, head: Boolean) {
    val size = total
    val range = parseRange(rangeHeader, size)
    if (range == ByteRange.UNSATISFIABLE) {
      answer(conn, out, 416, "Range Not Satisfiable", listOf("Accept-Ranges" to "bytes", "Content-Range" to "bytes */$size"), text("Range not satisfiable"), head)
      return
    }
    val input = try {
      if (this.file.length() == size) FileInputStream(this.file) else null
    } catch (e: IOException) {
      null
    }
    if (input == null) {
      // The kept file went, or changed, since serving began.
      answer(conn, out, 404, "Not Found", emptyList(), text("Not found"), head)
      return
    }
    input.use { stream ->
      val start = range?.start ?: 0L
      val end = range?.end ?: (size - 1)
      val length = if (size == 0L) 0L else end - start + 1
      val headers = listOf("Content-Disposition" to "attachment; filename=\"$name\"", "Accept-Ranges" to "bytes", "Content-Length" to "$length") +
        (if (range != null) listOf("Content-Range" to "bytes $start-$end/$size") else emptyList())
      if (range != null) {
        write(conn, out, status(206, "Partial Content", headers, APK))
      } else {
        write(conn, out, status(200, "OK", headers, APK))
      }
      if (head) return
      stream.channel.position(start)
      val buffer = ByteArray(CHUNK)
      var left = length
      while (left > 0) {
        val n = stream.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
        if (n < 0) return
        write(conn, out, buffer, n)
        sentBytes.addAndGet(n.toLong())
        left -= n
      }
      out.flush()
      if (end == size - 1) downloadsDone.incrementAndGet()
    }
  }

  private class Body(val type: String, val bytes: ByteArray)

  private fun text(words: String) = Body("text/plain; charset=utf-8", "$words\n".toByteArray(Charsets.UTF_8))

  private fun answer(conn: Connection, out: OutputStream, code: Int, reason: String, headers: List<Pair<String, String>>, body: Body, head: Boolean) {
    val start = status(code, reason, headers + ("Content-Length" to "${body.bytes.size}"), body.type)
    val all = if (head) start else start + body.bytes
    write(conn, out, all)
    out.flush()
  }

  private fun status(code: Int, reason: String, headers: List<Pair<String, String>>, type: String): ByteArray {
    val s = StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n")
    for ((k, v) in listOf("Content-Type" to type) + headers + COMMON) s.append(k).append(": ").append(v).append("\r\n")
    s.append("\r\n")
    return s.toString().toByteArray(Charsets.US_ASCII)
  }

  private fun write(conn: Connection, out: OutputStream, bytes: ByteArray, count: Int = bytes.size) {
    conn.writingSince = System.nanoTime()
    try {
      out.write(bytes, 0, count)
    } finally {
      conn.writingSince = 0L
    }
  }

  private fun answered() {
    askedCount.incrementAndGet()
    lastAsked.set(clock())
  }

  /**
   * Sends the end of the answer, then reads what the phone still sends for a moment before
   * closing: closing with its bytes unread would reset the connection, and the phone could lose
   * the answer.
   */
  private fun linger(socket: Socket, input: InputStream) {
    try {
      socket.shutdownOutput()
      socket.soTimeout = 500
      val until = System.nanoTime() + 2_000_000_000L
      val sink = ByteArray(4_096)
      var drained = 0
      while (System.nanoTime() < until && drained < 65_536) {
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
    private const val APK = "application/vnd.android.package-archive"
    private val COMMON = listOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff", "Connection" to "close")

    private fun tchar(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "!#$%&'*+-.^_`|~"
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
