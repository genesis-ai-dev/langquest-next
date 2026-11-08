package expo.modules.nearbylink

import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** The link's times and sizes, every one an argument from JavaScript (`configureLinks`). */
data class LinkTunables(
  /** Whole messages held for JavaScript before the reader stops reading, which slows the sender. */
  val queueMessages: Int = 8,
  /** The largest piece of a file in one frame. */
  val fileChunk: Int = 64 * 1024,
  /** How long a file that arrives before its `receiveFile` waits for it. */
  val fileWaitMs: Long = 10_000,
  /** Bytes a Bluetooth pipe holds unread before it counts as broken. */
  val pipeBytes: Int = 4 * 1024 * 1024,
  /** How long `close` waits to say goodbye before it just closes. */
  val byeWaitMs: Long = 500,
  /**
   * How long `close` reads on after its goodbye, until the other side closes too. A socket closed
   * with bytes unread is reset, and a reset can lose the goodbye on the other side.
   */
  val byeDrainMs: Long = 1_000,
)

/**
 * One link over any byte stream (docs/nearby-sync-plan.md 5.12), the same class on a Wi-Fi Direct
 * socket, a hotspot socket, a Bluetooth pipe and a JUnit loopback. Before `secure` it carries only
 * the opening's raw bytes, which JavaScript makes and checks; from `secure` on, only sealed frames
 * (`Frames.kt`): messages, files and a goodbye. A frame that fails its tag, a length past 1 MiB or
 * a stream that ends without a goodbye closes it, and every wait on it then fails. Files move
 * natively: sent from a file, received into a `PartWriter`, hashed on the way, so bulk bytes
 * never cross into JavaScript. Pure Kotlin on `java.*`, with blocking calls: the module runs each
 * on a background thread.
 */
class LinkSession(
  val id: String,
  val kind: String,
  private val transport: Transport,
  private val tune: LinkTunables,
  private val roots: List<File>,
  private val freeBytes: (File) -> Long = { it.usableSpace },
  private val onEnded: (LinkSession, NearbyCode) -> Unit = { _, _ -> },
) {
  private val writeLock = ReentrantLock()
  private val state = ReentrantLock()
  private val changed = state.newCondition()

  @Volatile private var sealer: Sealer? = null
  @Volatile private var opener: Opener? = null
  private val closedHere = AtomicBoolean(false)
  @Volatile private var ended: NearbyCode? = null
  /** True when the other side said goodbye: `receive` then gives null once the queue is empty. */
  @Volatile private var clean = false
  private val messages = ArrayDeque<ByteArray>()
  private val incoming = HashMap<String, Incoming>()
  private val outgoing = HashMap<String, Outgoing>()
  /** Transfers this side refused or cancelled: their frames are skipped. */
  private val skipped = HashSet<String>()
  private var reader: Thread? = null

  private class Incoming(val writer: PartWriter) {
    val done = CompletableFuture<PartWriter.Result>()
    var started = false
  }

  private class Outgoing {
    /** -1 while it runs; a `Frame` reason once the other side cancelled; `LOCAL` once this side did. */
    val stop = AtomicInteger(-1)
  }

  val isSecured: Boolean get() = sealer != null
  val isEnded: Boolean get() = ended != null

  // ---- the opening ---------------------------------------------------------------

  fun sendOpening(bytes: ByteArray) {
    usable()
    if (isSecured) throw NearbyException(NearbyCode.OPENING_AFTER_SECURE, "the opening comes before secure")
    write(bytes)
  }

  /** Exactly `size` raw bytes, or null at the deadline or once the other side has gone. */
  fun receiveOpening(size: Int, deadlineMs: Long): ByteArray? {
    usable()
    if (isSecured) throw NearbyException(NearbyCode.OPENING_AFTER_SECURE, "the opening comes before secure")
    if (size < 0 || size > Frame.MAX) throw NearbyException(NearbyCode.BAD_ARGUMENT, "an opening's size")
    val out = ByteArray(size)
    val deadline = System.currentTimeMillis() + deadlineMs
    var at = 0
    try {
      while (at < size) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) return null
        transport.setReadTimeout(left.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        val n = transport.input.read(out, at, size - at)
        if (n < 0) return null
        at += n
      }
      return out
    } catch (e: SocketTimeoutException) {
      return null
    } catch (e: IOException) {
      return null
    } finally {
      try { transport.setReadTimeout(0) } catch (_: Exception) {}
    }
  }

  /** Everything sealed from here on, both ways. Once per link. */
  fun secure(sendKey: ByteArray, receiveKey: ByteArray) {
    usable()
    state.withLock {
      if (sealer != null) throw NearbyException(NearbyCode.ALREADY_SECURED, "secure is once per link")
      sealer = Sealer(sendKey)
      opener = Opener(receiveKey)
    }
    reader = Thread({ readLoop() }, "nearby-link-reader").apply {
      isDaemon = true
      start()
    }
  }

  // ---- messages ------------------------------------------------------------------

  /** Resolved once written, so a slow link slows the sender. */
  fun send(message: ByteArray) {
    if (message.size > Frame.MAX) throw NearbyException(NearbyCode.MESSAGE_TOO_LARGE, "over the frame ceiling")
    frame(Frame.MESSAGE, message)
  }

  /**
   * The next whole message, in order; null once the other side closed cleanly. Messages that came
   * before a goodbye are still given after the link ended, however soon the reader saw it.
   */
  fun receive(): ByteArray? {
    if (closedHere.get()) throw NearbyException(NearbyCode.LINK_CLOSED, "closed here")
    if (!isSecured) throw NearbyException(NearbyCode.NOT_SECURED, "no frame is ever plain: secure first")
    state.withLock {
      while (messages.isEmpty() && ended == null) changed.await()
      if (messages.isNotEmpty()) {
        val m = messages.removeAt(0)
        changed.signalAll()
        return m
      }
      if (clean && !closedHere.get()) return null
      throw endedError()
    }
  }

  // ---- files ---------------------------------------------------------------------

  fun sendFile(transferId: String, file: File, size: Long) {
    sealedOnly()
    if (!inside(file)) throw NearbyException(NearbyCode.FILE_UNREADABLE, "a file outside the app's folders")
    if (!file.isFile || file.length() != size) throw NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "not the size given")
    val out = Outgoing()
    state.withLock {
      if (outgoing.containsKey(transferId)) throw NearbyException(NearbyCode.TRANSFER_BUSY, "that transfer is running")
      outgoing[transferId] = out
    }
    try {
      frame(Frame.FILE_START, Frame.fileStart(transferId, size))
      val buffer = ByteArray(tune.fileChunk.coerceIn(1024, Frame.MAX - 128))
      var sent = 0L
      val input = try { FileInputStream(file) } catch (e: IOException) {
        cancelOut(transferId, Frame.UNREADABLE)
        throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not open the file", e)
      }
      input.use {
        while (true) {
          stopped(out)
          val n = try { it.read(buffer) } catch (e: IOException) {
            cancelOut(transferId, Frame.UNREADABLE)
            throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not read the file", e)
          }
          if (n < 0) break
          if (sent + n > size) {
            cancelOut(transferId, Frame.UNREADABLE)
            throw NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "the file grew")
          }
          frame(Frame.FILE_DATA, Frame.fileData(transferId, buffer, 0, n))
          sent += n
        }
      }
      if (sent != size) {
        cancelOut(transferId, Frame.UNREADABLE)
        throw NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "the file shrank")
      }
      stopped(out)
      frame(Frame.FILE_END, Frame.fileEnd(transferId))
    } finally {
      state.withLock { outgoing.remove(transferId) }
    }
  }

  /** Into `staging` (a `.part` name in the app's folders); the size and SHA-256 once it is whole. */
  fun receiveFile(transferId: String, staging: File, maxBytes: Long, minFreeBytes: Long): PartWriter.Result {
    sealedOnly()
    val writer = PartWriter(staging, roots, maxBytes, minFreeBytes, freeBytes)
    val held = Incoming(writer)
    state.withLock {
      ended?.let { throw endedError() }
      if (incoming.containsKey(transferId)) throw NearbyException(NearbyCode.TRANSFER_BUSY, "that transfer is running")
      skipped.remove(transferId)
      incoming[transferId] = held
      changed.signalAll()
    }
    try {
      return held.done.get()
    } catch (e: ExecutionException) {
      throw (e.cause as? NearbyException) ?: NearbyException(NearbyCode.INTERNAL, "the transfer failed", e.cause)
    }
  }

  /** Stops a transfer either way, and tells the other side. */
  fun cancelFile(transferId: String) {
    var tell = false
    state.withLock {
      outgoing[transferId]?.stop?.compareAndSet(-1, LOCAL)
      val held = incoming.remove(transferId)
      skipped.add(transferId)
      if (held != null) {
        held.writer.discard()
        held.done.completeExceptionally(NearbyException(NearbyCode.FILE_CANCELLED, "cancelled here"))
        tell = true
      }
    }
    if (tell) try { frame(Frame.FILE_CANCEL, Frame.fileCancel(transferId, Frame.CANCELLED)) } catch (_: NearbyException) {}
  }

  // ---- closing -------------------------------------------------------------------

  /**
   * A goodbye if there is time, then the stream goes. Every wait here ends. After the goodbye this
   * side stops writing and the reader drops what still comes until the other side closes too (or
   * `byeDrainMs` passes), so nothing is left unread to turn the close into a reset.
   */
  fun close() {
    if (!closedHere.compareAndSet(false, true)) return
    state.withLock { changed.signalAll() }
    val s = sealer
    var said = false
    if (s != null && ended == null && writeLock.tryLock(tune.byeWaitMs, TimeUnit.MILLISECONDS)) {
      try {
        transport.output.write(s.seal(Frame.BYE, ByteArray(0)))
        transport.output.flush()
        transport.shutdownOutput()
        said = true
      } catch (_: Exception) {
      } finally {
        writeLock.unlock()
      }
    }
    val r = reader
    if (said && r != null && r !== Thread.currentThread()) {
      try { r.join(tune.byeDrainMs.coerceAtLeast(1)) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    }
    end(NearbyCode.LINK_CLOSED)
  }

  // ---- the reader ----------------------------------------------------------------

  private fun readLoop() {
    val open = opener ?: return
    try {
      while (true) {
        if (closedHere.get()) return drain()
        val head = readFully(Frame.SEALED_HEADER) ?: return stop(NearbyCode.LINK_DROPPED)
        val h = open.header(head)
        val sealedBody = readFully(h.len + Frame.TAG) ?: return stop(NearbyCode.LINK_DROPPED)
        val body = open.body(sealedBody)
        when (h.type) {
          Frame.MESSAGE -> queue(body)
          Frame.FILE_START -> fileStart(body)
          Frame.FILE_DATA -> fileData(body)
          Frame.FILE_END -> fileEnd(body)
          Frame.FILE_CANCEL -> fileCancelled(body)
          Frame.BYE -> {
            clean = true
            return stop(NearbyCode.LINK_DROPPED)
          }
          // A frame type from a later build: sealed and checked, so skipped.
          else -> {}
        }
      }
    } catch (e: NearbyException) {
      stop(e.code)
    } catch (e: IOException) {
      stop(NearbyCode.LINK_DROPPED)
    } catch (e: InterruptedException) {
      end(NearbyCode.LINK_CLOSED)
    } catch (e: RuntimeException) {
      stop(NearbyCode.INTERNAL)
    }
  }

  /** The reader's end; once this side is closing, `close` ends the link itself. */
  private fun stop(code: NearbyCode) {
    if (!closedHere.get()) end(code)
  }

  /** After this side's goodbye: drops what still comes, until the other side's end or `close` closes the stream. */
  private fun drain() {
    val sink = ByteArray(16 * 1024)
    try {
      while (transport.input.read(sink) >= 0) {}
    } catch (_: IOException) {}
  }

  private fun readFully(size: Int): ByteArray? {
    val out = ByteArray(size)
    var at = 0
    while (at < size) {
      val n = transport.input.read(out, at, size - at)
      if (n < 0) return null
      at += n
    }
    return out
  }

  private fun queue(message: ByteArray) = state.withLock {
    while (messages.size >= tune.queueMessages.coerceAtLeast(1) && ended == null && !closedHere.get()) changed.await()
    if (ended == null && !closedHere.get()) {
      messages.add(message)
      changed.signalAll()
    }
  }

  private fun fileStart(body: ByteArray) {
    val f = Frame.readFileBody(body)
    if (f.rest.size - f.restFrom != 8) throw NearbyException(NearbyCode.LINK_DROPPED, "a broken file start")
    val size = Bytes.readU64(f.rest, f.restFrom)
    val id = f.transferId
    val held: Incoming? = state.withLock {
      // JavaScript registers before it asks, so this wait is short; past it, the file is refused.
      val deadline = System.currentTimeMillis() + tune.fileWaitMs
      while (incoming[id] == null && id !in skipped && ended == null && !closedHere.get()) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) break
        changed.await(left, TimeUnit.MILLISECONDS)
      }
      incoming[id]?.takeIf { !it.started }
    }
    if (held == null) {
      state.withLock { skipped.add(id) }
      return cancelOut(id, Frame.UNWANTED)
    }
    try {
      held.writer.begin(size)
      held.started = true
    } catch (e: NearbyException) {
      failIncoming(id, held, e, true)
    }
  }

  private fun fileData(body: ByteArray) {
    val f = Frame.readFileBody(body)
    val held = state.withLock { if (f.transferId in skipped) null else incoming[f.transferId] } ?: return
    if (!held.started) return failIncoming(f.transferId, held, NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "data before its start"), true)
    try {
      held.writer.write(f.rest, f.restFrom, f.rest.size - f.restFrom)
    } catch (e: NearbyException) {
      failIncoming(f.transferId, held, e, true)
    }
  }

  private fun fileEnd(body: ByteArray) {
    val f = Frame.readFileBody(body)
    val held = state.withLock { if (f.transferId in skipped) null else incoming.remove(f.transferId) } ?: return
    try {
      if (!held.started) throw NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "an end before its start")
      held.done.complete(held.writer.finish())
    } catch (e: NearbyException) {
      held.writer.discard()
      held.done.completeExceptionally(e)
    }
  }

  private fun fileCancelled(body: ByteArray) {
    val f = Frame.readFileBody(body)
    val reason = if (f.rest.size > f.restFrom) f.rest[f.restFrom].toInt() and 0xff else Frame.CANCELLED
    val held = state.withLock {
      outgoing[f.transferId]?.stop?.compareAndSet(-1, reason)
      incoming.remove(f.transferId)
    }
    if (held != null) {
      held.writer.discard()
      held.done.completeExceptionally(NearbyException(NearbyCode.FILE_CANCELLED, "the other side stopped sending"))
    }
  }

  private fun failIncoming(id: String, held: Incoming, e: NearbyException, tell: Boolean) {
    state.withLock {
      incoming.remove(id)
      skipped.add(id)
    }
    held.writer.discard()
    held.done.completeExceptionally(e)
    if (tell) cancelOut(id, reasonOf(e.code))
  }

  private fun reasonOf(code: NearbyCode) = when (code) {
    NearbyCode.FILE_TOO_BIG -> Frame.TOO_BIG
    NearbyCode.FILE_NO_SPACE -> Frame.NO_SPACE
    else -> Frame.CANCELLED
  }

  private fun cancelOut(id: String, reason: Int) {
    try { frame(Frame.FILE_CANCEL, Frame.fileCancel(id, reason)) } catch (_: NearbyException) {}
  }

  private fun stopped(out: Outgoing) {
    ended?.let { throw endedError() }
    when (val why = out.stop.get()) {
      -1 -> {}
      LOCAL -> throw NearbyException(NearbyCode.FILE_CANCELLED, "cancelled here")
      Frame.TOO_BIG -> throw NearbyException(NearbyCode.FILE_REFUSED, "the other side refused it: too big")
      Frame.NO_SPACE -> throw NearbyException(NearbyCode.FILE_REFUSED, "the other side refused it: no room")
      else -> throw NearbyException(NearbyCode.FILE_REFUSED, "the other side refused it ($why)")
    }
  }

  // ---- the plumbing --------------------------------------------------------------

  private fun frame(type: Int, body: ByteArray) {
    sealedOnly()
    writeLock.withLock {
      ended?.let { throw endedError() }
      // Sealed under the lock, so the order of nonces is the order on the wire.
      val bytes = sealer!!.seal(type, body)
      try {
        transport.output.write(bytes)
        transport.output.flush()
      } catch (e: IOException) {
        end(if (closedHere.get()) NearbyCode.LINK_CLOSED else NearbyCode.LINK_DROPPED)
        throw endedError()
      }
    }
  }

  private fun write(bytes: ByteArray) = writeLock.withLock {
    try {
      transport.output.write(bytes)
      transport.output.flush()
    } catch (e: IOException) {
      end(NearbyCode.LINK_DROPPED)
      throw endedError()
    }
  }

  private fun usable() {
    if (closedHere.get()) throw NearbyException(NearbyCode.LINK_CLOSED, "closed here")
    ended?.let { throw endedError() }
  }

  private fun sealedOnly() {
    usable()
    if (!isSecured) throw NearbyException(NearbyCode.NOT_SECURED, "no frame is ever plain: secure first")
  }

  private fun endedError(): NearbyException {
    if (closedHere.get()) return NearbyException(NearbyCode.LINK_CLOSED, "closed here")
    val code = ended ?: NearbyCode.LINK_DROPPED
    return NearbyException(code, if (clean) "the other side closed the link" else "the link went")
  }

  private fun inside(file: File): Boolean {
    val path = file.canonicalPath
    return roots.any { path.startsWith(it.canonicalPath.trimEnd(File.separatorChar) + File.separator) }
  }

  /** Once: every wait ends, keys are forgotten, the stream closes. */
  private fun end(code: NearbyCode) {
    val pending: List<Incoming>
    state.withLock {
      if (ended != null) return
      ended = code
      pending = incoming.values.toList()
      incoming.clear()
      for (o in outgoing.values) o.stop.compareAndSet(-1, LOCAL)
      changed.signalAll()
    }
    for (held in pending) {
      held.writer.discard()
      held.done.completeExceptionally(NearbyException(if (closedHere.get()) NearbyCode.LINK_CLOSED else NearbyCode.LINK_DROPPED, "the link went during the file"))
    }
    sealer?.forget()
    opener?.forget()
    transport.close()
    onEnded(this, code)
  }

  private companion object {
    const val LOCAL = 1000
  }
}
