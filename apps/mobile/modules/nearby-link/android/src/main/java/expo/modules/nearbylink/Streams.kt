package expo.modules.nearbylink

import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.io.OutputStream
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Streams under a `LinkSession` (docs/nearby-sync-plan.md 5.12): a socket gives its own, and a
 * Bluetooth pipe gives these. A pipe is one byte stream cut into GATT values of
 * `min(mtu - 3, 512)` bytes, in order, with nothing added, so a value carries only the opening's
 * raw bytes or sealed frames. Pure: JUnit runs them.
 */
object GattChunks {
  /** A GATT attribute holds at most 512 bytes, whatever the MTU. */
  const val VALUE_MAX = 512

  fun sizeFor(mtu: Int): Int {
    val size = minOf(mtu - 3, VALUE_MAX)
    if (size < 1) throw NearbyException(NearbyCode.BAD_ARGUMENT, "an MTU leaves no room")
    return size
  }

  fun split(bytes: ByteArray, mtu: Int): List<ByteArray> {
    val size = sizeFor(mtu)
    val out = ArrayList<ByteArray>((bytes.size + size - 1) / size)
    var at = 0
    while (at < bytes.size) {
      val end = minOf(bytes.size, at + size)
      out.add(bytes.copyOfRange(at, end))
      at = end
    }
    return out
  }
}

/** A stream a link can read with a deadline: a socket's `soTimeout`, or a `ByteQueue`'s. */
interface Transport {
  val input: InputStream
  val output: OutputStream
  /** 0 waits for ever. */
  fun setReadTimeout(ms: Int)
  fun close()
}

/**
 * Bytes that arrive by GATT, read in order as a stream. Holds at most `capacity` bytes; past that
 * the pipe is broken, since only a hostile or broken peer floods it (a pipe carries events only).
 * `onDrained` lets a GATT server answer a held write once a reader made room.
 */
class ByteQueue(private val capacity: Int, private val onDrained: () -> Unit = {}) {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private val chunks = ArrayDeque<ByteArray>()
  private var head = 0
  private var held = 0
  private var ended = false
  private var broken: String? = null
  @Volatile var timeoutMs = 0

  val size: Int get() = lock.withLock { held }

  /** False when it would pass `capacity`: the pipe is then broken. */
  fun offer(bytes: ByteArray): Boolean = lock.withLock {
    if (ended || broken != null) return false
    if (held + bytes.size > capacity) {
      broken = "the pipe overflowed"
      changed.signalAll()
      return false
    }
    if (bytes.isNotEmpty()) chunks.addLast(bytes.copyOf())
    held += bytes.size
    changed.signalAll()
    true
  }

  /** No more bytes: a reader gets what is left, then the end. */
  fun end() = lock.withLock {
    ended = true
    changed.signalAll()
  }

  /** At least one byte, at most `len`; -1 at the end; throws on a break or past the timeout. */
  fun read(out: ByteArray, off: Int, len: Int): Int {
    var n = 0
    lock.withLock {
      val deadline = if (timeoutMs > 0) System.currentTimeMillis() + timeoutMs else 0L
      while (held == 0 && !ended && broken == null) {
        if (deadline == 0L) {
          changed.await()
        } else {
          val left = deadline - System.currentTimeMillis()
          if (left <= 0) throw SocketTimeoutException("no bytes by the deadline")
          changed.await(left, TimeUnit.MILLISECONDS)
        }
      }
      val why = broken
      if (held == 0 && why != null) throw IOException(why)
      if (held == 0) return -1
      while (n < len && chunks.isNotEmpty()) {
        val c = chunks[0]
        val take = minOf(len - n, c.size - head)
        System.arraycopy(c, head, out, off + n, take)
        n += take
        head += take
        if (head == c.size) {
          chunks.removeAt(0)
          head = 0
        }
      }
      held -= n
    }
    onDrained()
    return n
  }

  fun inputStream(): InputStream = object : InputStream() {
    override fun read(): Int {
      val one = ByteArray(1)
      val n = read(one, 0, 1)
      return if (n < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (len == 0) return 0
      try {
        return this@ByteQueue.read(b, off, len)
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        throw InterruptedIOException("interrupted")
      }
    }

    override fun available(): Int = size

    override fun close() = end()
  }
}

/**
 * Writes a pipe's stream as GATT values, one outstanding at a time: `send` blocks until the value
 * was acknowledged (a write's response, or a notification's `onNotificationSent`), which is the
 * pipe's flow control. `mtu` is read at each write, since it settles after the pipe opens.
 */
class ChunkedOutputStream(private val mtu: () -> Int, private val send: (ByteArray) -> Unit) : OutputStream() {
  override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

  override fun write(b: ByteArray, off: Int, len: Int) {
    var at = off
    val end = off + len
    while (at < end) {
      val size = minOf(GattChunks.sizeFor(mtu()), end - at)
      send(b.copyOfRange(at, at + size))
      at += size
    }
  }
}

/** A socket as a `Transport`. */
class SocketTransport(private val socket: java.net.Socket) : Transport {
  override val input: InputStream = java.io.BufferedInputStream(socket.getInputStream(), 64 * 1024)
  override val output: OutputStream = java.io.BufferedOutputStream(socket.getOutputStream(), 64 * 1024)
  override fun setReadTimeout(ms: Int) { socket.soTimeout = ms }
  override fun close() {
    try { socket.close() } catch (_: IOException) {}
  }
}
