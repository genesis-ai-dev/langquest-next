package expo.modules.nearbylink

import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The link's frames (docs/nearby-sync-plan.md 5.12): after `secure`, each frame is a sealed header
 * of 21 bytes (`u32be len || u8 type`) and a sealed body of `len + 16` bytes, each AES-256-GCM
 * with nonce `0^4 || u64be counter` per direction, header first, no associated data. A sniffer
 * sees no length prefix and no type byte. `len` is checked against 1 MiB once the header opens,
 * before the body is read or allocated. Any failure is final, and the link closes. Pure: JUnit
 * runs it against `test-vectors.json`. The two frame keys are the other kind of key native ever
 * holds; they live in these objects only, and are never logged.
 */
object Frame {
  const val MAX = 1024 * 1024
  const val HEADER_PLAIN = 5
  const val TAG = 16
  const val SEALED_HEADER = HEADER_PLAIN + TAG

  const val MESSAGE = 1
  const val FILE_START = 2
  const val FILE_DATA = 3
  const val FILE_END = 4
  const val FILE_CANCEL = 5
  const val BYE = 6

  /** Why a file stopped: a `FILE_CANCEL` frame's last byte. */
  const val CANCELLED = 0
  const val TOO_BIG = 1
  const val NO_SPACE = 2
  const val UNREADABLE = 3
  const val UNWANTED = 4

  fun nonce(counter: Long): ByteArray = Bytes.concat(ByteArray(4), Bytes.u64(counter))

  // ---- file bodies: u8 id length || id (1 to 64 bytes of UTF-8) || the rest ----

  private fun id(transferId: String): ByteArray {
    val bytes = Bytes.utf8(transferId)
    if (bytes.isEmpty() || bytes.size > 64) throw NearbyException(NearbyCode.BAD_ARGUMENT, "a transfer id is 1 to 64 bytes")
    return Bytes.concat(byteArrayOf(bytes.size.toByte()), bytes)
  }

  fun fileStart(transferId: String, size: Long): ByteArray = Bytes.concat(id(transferId), Bytes.u64(size))
  fun fileData(transferId: String, data: ByteArray, from: Int = 0, count: Int = data.size): ByteArray =
    Bytes.concat(id(transferId), data.copyOfRange(from, from + count))
  fun fileEnd(transferId: String): ByteArray = id(transferId)
  fun fileCancel(transferId: String, reason: Int): ByteArray = Bytes.concat(id(transferId), byteArrayOf(reason.toByte()))

  class FileBody(val transferId: String, val rest: ByteArray, val restFrom: Int)

  /** The id and where the rest starts. Throws on a body too short for its id. */
  fun readFileBody(body: ByteArray): FileBody {
    if (body.isEmpty()) throw NearbyException(NearbyCode.LINK_DROPPED, "a file frame with no id")
    val n = body[0].toInt() and 0xff
    if (n < 1 || n > 64 || body.size < 1 + n) throw NearbyException(NearbyCode.LINK_DROPPED, "a file frame with a broken id")
    return FileBody(String(body, 1, n, Charsets.UTF_8), body, 1 + n)
  }
}

private fun gcm(mode: Int, key: ByteArray, counter: Long): Cipher {
  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
  cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(Frame.TAG * 8, Frame.nonce(counter)))
  return cipher
}

/** One direction's sealing. Every seal takes the next nonce; a nonce is never used twice. */
class Sealer(key: ByteArray) {
  private val key = key.copyOf()
  private var counter = 0L

  init {
    if (key.size != 32) throw NearbyException(NearbyCode.BAD_ARGUMENT, "a frame key is 32 bytes")
  }

  @Synchronized
  fun seal(type: Int, body: ByteArray): ByteArray {
    if (body.size > Frame.MAX) throw NearbyException(NearbyCode.MESSAGE_TOO_LARGE, "over the frame ceiling")
    if (counter > Long.MAX_VALUE - 2) throw NearbyException(NearbyCode.LINK_CLOSED, "the counter ran out")
    val header = Bytes.concat(Bytes.u32(body.size), byteArrayOf(type.toByte()))
    val h = gcm(Cipher.ENCRYPT_MODE, key, counter++).doFinal(header)
    val b = gcm(Cipher.ENCRYPT_MODE, key, counter++).doFinal(body)
    return Bytes.concat(h, b)
  }

  fun forget() = key.fill(0)
}

/** One direction's opening, in order. A failed tag throws `TAG_FAILED`, and the link closes. */
class Opener(key: ByteArray) {
  private val key = key.copyOf()
  private var counter = 0L

  init {
    if (key.size != 32) throw NearbyException(NearbyCode.BAD_ARGUMENT, "a frame key is 32 bytes")
  }

  class Header(val len: Int, val type: Int)

  @Synchronized
  fun header(sealed: ByteArray): Header {
    if (sealed.size != Frame.SEALED_HEADER) throw NearbyException(NearbyCode.TAG_FAILED, "a sealed header is 21 bytes")
    val plain = open(sealed)
    val len = Bytes.readU32(plain, 0)
    if (len > Frame.MAX) throw NearbyException(NearbyCode.FRAME_TOO_LARGE, "over the frame ceiling")
    return Header(len.toInt(), plain[4].toInt() and 0xff)
  }

  @Synchronized
  fun body(sealed: ByteArray): ByteArray = open(sealed)

  private fun open(sealed: ByteArray): ByteArray {
    if (counter > Long.MAX_VALUE - 1) throw NearbyException(NearbyCode.LINK_CLOSED, "the counter ran out")
    val at = counter++
    if (sealed.size < Frame.TAG) throw NearbyException(NearbyCode.TAG_FAILED, "shorter than a tag")
    return try {
      gcm(Cipher.DECRYPT_MODE, key, at).doFinal(sealed)
    } catch (e: Exception) {
      // AEADBadTagException, and any other way a provider refuses: the same answer.
      throw NearbyException(NearbyCode.TAG_FAILED, "a frame failed its tag")
    }
  }

  fun forget() = key.fill(0)
}
