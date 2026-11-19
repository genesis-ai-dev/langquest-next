package expo.modules.nearbylink

import java.io.File

/**
 * `test-vectors.json`, which `src/vectors.ts` makes from `src/wire.ts` and vitest also reads.
 * Read with the small parser below, not org.json: android.jar's copy is a stub in local unit
 * tests, and which one a classpath finds first is not worth depending on.
 */
object Vectors {
  val json: JObject by lazy {
    val path = System.getProperty("nearby.vectors") ?: "../test-vectors.json"
    JObject(Json(File(path).readText()).value() as Map<*, *>)
  }

  fun strings(a: JArray): List<String> = (0 until a.length()).map { a.getString(it) }

  /** Bytes `i % 251`, as `pattern` in src/vectors.ts. */
  fun pattern(n: Int): ByteArray = ByteArray(n) { (it % 251).toByte() }
}

class JObject(private val m: Map<*, *>) {
  fun getString(k: String) = m[k] as String
  fun getInt(k: String) = (m[k] as Number).toInt()
  fun getLong(k: String) = (m[k] as Number).toLong()
  fun getJSONObject(k: String) = JObject(m[k] as Map<*, *>)
  fun getJSONArray(k: String) = JArray(m[k] as List<*>)
  fun keys(): Iterator<String> = m.keys.map { it as String }.iterator()
}

class JArray(private val l: List<*>) {
  fun length() = l.size
  fun getString(i: Int) = l[i] as String
  fun getInt(i: Int) = (l[i] as Number).toInt()
  fun getJSONObject(i: Int) = JObject(l[i] as Map<*, *>)
}

/** Enough JSON for the vectors: objects, arrays, strings without escapes past \" and \\, numbers, true, false, null. */
private class Json(private val s: String) {
  private var at = 0

  fun value(): Any? {
    space()
    return when (val c = s[at]) {
      '{' -> obj()
      '[' -> arr()
      '"' -> str()
      't' -> word("true", true)
      'f' -> word("false", false)
      'n' -> word("null", null)
      else -> if (c == '-' || c.isDigit()) num() else error("unexpected $c at $at")
    }
  }

  private fun space() { while (at < s.length && s[at].isWhitespace()) at++ }

  private fun word(w: String, v: Any?): Any? {
    check(s.startsWith(w, at)) { "bad word at $at" }
    at += w.length
    return v
  }

  private fun num(): Number {
    val start = at
    while (at < s.length && (s[at].isDigit() || s[at] in "-+.eE")) at++
    val t = s.substring(start, at)
    return if (t.any { it in ".eE" }) t.toDouble() else t.toLong()
  }

  private fun str(): String {
    at++
    val out = StringBuilder()
    while (s[at] != '"') {
      if (s[at] == '\\') {
        at++
        out.append(
          when (s[at]) {
            'n' -> '\n'
            't' -> '\t'
            'u' -> s.substring(at + 1, at + 5).toInt(16).toChar().also { at += 4 }
            else -> s[at]
          },
        )
      } else out.append(s[at])
      at++
    }
    at++
    return out.toString()
  }

  private fun arr(): List<Any?> {
    at++
    val out = ArrayList<Any?>()
    space()
    if (s[at] == ']') { at++; return out }
    while (true) {
      out.add(value())
      space()
      if (s[at++] == ']') return out
    }
  }

  private fun obj(): Map<String, Any?> {
    at++
    val out = LinkedHashMap<String, Any?>()
    space()
    if (s[at] == '}') { at++; return out }
    while (true) {
      space()
      val k = str()
      space()
      check(s[at++] == ':') { "expected : at $at" }
      out[k] = value()
      space()
      if (s[at++] == '}') return out
    }
  }
}
