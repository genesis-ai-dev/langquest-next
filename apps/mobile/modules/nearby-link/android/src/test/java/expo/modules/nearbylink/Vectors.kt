package expo.modules.nearbylink

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** `test-vectors.json`, which `src/vectors.ts` makes from `src/wire.ts` and vitest also reads. */
object Vectors {
  val json: JSONObject by lazy {
    val path = System.getProperty("nearby.vectors") ?: "../test-vectors.json"
    JSONObject(File(path).readText())
  }

  fun hex(s: String): ByteArray = Bytes.unhex(s)

  fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

  /** Bytes `i % 251`, as `pattern` in src/vectors.ts. */
  fun pattern(n: Int): ByteArray = ByteArray(n) { (it % 251).toByte() }
}
