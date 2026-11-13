package expo.modules.nearbylink

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Byte helpers for the nearby link (docs/nearby-sync-plan.md 5.12). Pure Kotlin on the JVM's
 * own classes, so JUnit runs them as a phone does. `java.util.Base64` is API 26 and the module
 * loads on API 24, so base64url is written here.
 */
object Bytes {
  private const val HEX = "0123456789abcdef"
  private const val B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

  fun hex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) {
      val v = b.toInt() and 0xff
      out.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
    }
    return out.toString()
  }

  fun unhex(text: String): ByteArray {
    require(text.length % 2 == 0) { "odd hex" }
    return ByteArray(text.length / 2) { i ->
      val hi = Character.digit(text[i * 2], 16)
      val lo = Character.digit(text[i * 2 + 1], 16)
      require(hi >= 0 && lo >= 0) { "not hex" }
      ((hi shl 4) or lo).toByte()
    }
  }

  /** Base64url with no padding, as every byte string in a native callback is (5.12). */
  fun b64url(bytes: ByteArray): String {
    val out = StringBuilder((bytes.size * 4 + 2) / 3)
    var i = 0
    while (i < bytes.size) {
      val b0 = bytes[i].toInt() and 0xff
      val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
      val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
      val n = (b0 shl 16) or (b1 shl 8) or b2
      val left = bytes.size - i
      out.append(B64[(n ushr 18) and 63]).append(B64[(n ushr 12) and 63])
      if (left > 1) out.append(B64[(n ushr 6) and 63])
      if (left > 2) out.append(B64[n and 63])
      i += 3
    }
    return out.toString()
  }

  /** Null for anything that is not base64url with no padding. */
  fun unb64url(text: String): ByteArray? {
    if (text.length % 4 == 1) return null
    val out = java.io.ByteArrayOutputStream(text.length * 3 / 4)
    var acc = 0
    var bits = 0
    for (c in text) {
      val v = B64.indexOf(c)
      if (v < 0) return null
      acc = (acc shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write((acc ushr bits) and 0xff)
      }
    }
    // The bits left over must be zero, or two texts would read as one value.
    if (bits > 0 && (acc and ((1 shl bits) - 1)) != 0) return null
    return out.toByteArray()
  }

  fun concat(vararg parts: ByteArray): ByteArray {
    val out = ByteArray(parts.sumOf { it.size })
    var at = 0
    for (p in parts) {
      System.arraycopy(p, 0, out, at, p.size)
      at += p.size
    }
    return out
  }

  fun utf8(text: String): ByteArray = text.toByteArray(Charsets.UTF_8)

  fun hmacSha256(key: ByteArray, vararg parts: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    for (p in parts) mac.update(p)
    return mac.doFinal()
  }

  fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

  /** The whole length, whatever differs first. */
  fun same(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

  fun u32(value: Int): ByteArray = byteArrayOf((value ushr 24).toByte(), (value ushr 16).toByte(), (value ushr 8).toByte(), value.toByte())

  fun readU32(bytes: ByteArray, at: Int): Long =
    ((bytes[at].toLong() and 0xff) shl 24) or ((bytes[at + 1].toLong() and 0xff) shl 16) or
      ((bytes[at + 2].toLong() and 0xff) shl 8) or (bytes[at + 3].toLong() and 0xff)

  fun u64(value: Long): ByteArray = ByteArray(8) { i -> (value ushr (56 - 8 * i)).toByte() }

  fun readU64(bytes: ByteArray, at: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (bytes[at + i].toLong() and 0xff)
    return v
  }
}
