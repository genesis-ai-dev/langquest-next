package expo.modules.nearbylink

/**
 * Find's bytes (docs/nearby-sync-plan.md 5.12, "Find"): the advert, the masked scan response and
 * the GATT UUIDs, all version 4 UUIDs in canonical byte order, worked out from `kFind` and the
 * salt. Pure. `kFind` is one of the two kinds of key native ever holds; nothing here keeps it
 * past its caller, logs it or sends it.
 */
object FindCodec {
  const val SALT_BYTES = 6
  const val R_BYTES = 2
  const val PAYLOAD_BYTES = 14
  const val UUID_BYTES = 16

  private val FIND = Bytes.utf8("find")
  private val SUM = Bytes.utf8("sum")
  private val GATT = Bytes.utf8("gatt")

  /** `v4(x)`: byte 6's top four bits 0100, byte 8's top two 10. */
  fun v4(x: ByteArray): ByteArray {
    require(x.size == UUID_BYTES) { "a UUID is 16 bytes" }
    val out = x.copyOf()
    out[6] = ((out[6].toInt() and 0x0f) or 0x40).toByte()
    out[8] = ((out[8].toInt() and 0x3f) or 0x80).toByte()
    return out
  }

  fun isV4(u: ByteArray): Boolean = u.size == UUID_BYTES && (u[6].toInt() and 0xf0) == 0x40 && (u[8].toInt() and 0xc0) == 0x80

  fun advertId(kFind: ByteArray, salt: ByteArray): ByteArray {
    require(salt.size == SALT_BYTES) { "a salt is 6 bytes" }
    return v4(Bytes.concat(salt, Bytes.hmacSha256(kFind, FIND, salt).copyOf(10)))
  }

  fun scanResponse(kFind: ByteArray, salt: ByteArray, r: ByteArray, payload: ByteArray): ByteArray {
    require(r.size == R_BYTES) { "r is 2 bytes" }
    require(payload.size == PAYLOAD_BYTES) { "a payload is 14 bytes" }
    val mask = Bytes.hmacSha256(kFind, SUM, salt, r)
    val masked = ByteArray(PAYLOAD_BYTES) { i -> (payload[i].toInt() xor mask[i].toInt()).toByte() }
    return v4(Bytes.concat(r, masked))
  }

  class Unmasked(val r: ByteArray, val tag: ByteArray, val summary: ByteArray, val echo: ByteArray)

  /** The bits `v4` overwrote read as cleared, as the sender cleared them. */
  fun unmask(kFind: ByteArray, salt: ByteArray, response: ByteArray): Unmasked {
    require(response.size == UUID_BYTES) { "a UUID is 16 bytes" }
    val r = response.copyOfRange(0, R_BYTES)
    val mask = Bytes.hmacSha256(kFind, SUM, salt, r)
    val p = ByteArray(PAYLOAD_BYTES) { i -> (response[i + R_BYTES].toInt() xor mask[i].toInt()).toByte() }
    p[4] = (p[4].toInt() and 0x0f).toByte()
    p[6] = (p[6].toInt() and 0x3f).toByte()
    return Unmasked(r, p.copyOfRange(0, 6), p.copyOfRange(6, 10), p.copyOfRange(10, 14))
  }

  /** The GATT service (0), the characteristic written to the advertiser (1), and the one it notifies on (2). */
  fun gattUuid(kFind: ByteArray, salt: ByteArray, which: Int): ByteArray {
    require(which in 0..2) { "0, 1 or 2" }
    return v4(Bytes.hmacSha256(kFind, GATT, salt, byteArrayOf(which.toByte())).copyOf(UUID_BYTES))
  }

  fun uuidOf(bytes: ByteArray): java.util.UUID {
    require(bytes.size == UUID_BYTES) { "a UUID is 16 bytes" }
    return java.util.UUID(Bytes.readU64(bytes, 0), Bytes.readU64(bytes, 8))
  }

  fun bytesOf(uuid: java.util.UUID): ByteArray = Bytes.concat(Bytes.u64(uuid.mostSignificantBits), Bytes.u64(uuid.leastSignificantBits))
}

/** What the scanner hands up for one scan record. */
sealed class Heard {
  /** A teammate under `scanKeys[scan]`, unmasked. */
  class Match(val scan: Int, val salt: ByteArray, val response: FindCodec.Unmasked) : Heard()

  /** An advert of this form that no key matched: its salt and nothing else. */
  class FormSalt(val salt: ByteArray) : Heard()
}

/**
 * Matches scan records against every key in `scanKeys`, newest first (5.12, "Generations"), with
 * a cache per salt so a phone heard ten times a second costs one HMAC per key once. Pure: the
 * scanner gives it the record's 128-bit service UUIDs, in the record's order, and whether the
 * record held anything else (a name, manufacturer or service data), which no advert of this form
 * does.
 */
class FindMatcher(scanKeys: List<ByteArray>, private val cacheSize: Int = 256) {
  private val keys = scanKeys.map { it.copyOf() }

  private class Cached(val id: ByteArray, val scan: Int)

  private val cache = object : LinkedHashMap<String, Cached>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Cached>?): Boolean = size > cacheSize
  }

  /** The place in `scanKeys` of the key this advert id was made under, or -1. */
  fun scanOf(id: ByteArray): Int {
    if (id.size != FindCodec.UUID_BYTES) return -1
    val salt = id.copyOfRange(0, FindCodec.SALT_BYTES)
    val name = Bytes.hex(salt)
    synchronized(cache) {
      val held = cache[name]
      if (held != null && Bytes.same(held.id, id)) return held.scan
    }
    var scan = -1
    for ((i, k) in keys.withIndex()) {
      if (Bytes.same(FindCodec.advertId(k, salt), id)) {
        scan = i
        break
      }
    }
    synchronized(cache) { cache[name] = Cached(id.copyOf(), scan) }
    return scan
  }

  /**
   * A teammate when one UUID is an advert under a key and the other its scan response; the salt
   * alone when the record has this form and no key matches; null otherwise, and for a match
   * whose scan response has not arrived yet.
   */
  fun hear(uuids: List<ByteArray>, otherData: Boolean): Heard? {
    if (otherData || uuids.isEmpty() || uuids.size > 2 || !uuids.all { FindCodec.isV4(it) }) return null
    for ((i, id) in uuids.withIndex()) {
      val scan = scanOf(id)
      if (scan < 0) continue
      if (uuids.size < 2) return null
      val salt = id.copyOfRange(0, FindCodec.SALT_BYTES)
      return Heard.Match(scan, salt, FindCodec.unmask(keys[scan], salt, uuids[1 - i]))
    }
    return Heard.FormSalt(uuids[0].copyOfRange(0, FindCodec.SALT_BYTES))
  }

  /** Forgets every key: Find stopped. */
  fun clear() {
    for (k in keys) k.fill(0)
    synchronized(cache) { cache.clear() }
  }

  fun keyAt(scan: Int): ByteArray? = keys.getOrNull(scan)
}
