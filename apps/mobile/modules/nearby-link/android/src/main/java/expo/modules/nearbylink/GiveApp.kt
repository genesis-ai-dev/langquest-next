package expo.modules.nearbylink

import java.security.SecureRandom

/**
 * Give the app's Wi-Fi name and passphrase (docs/nearby-sync-plan.md 14.5), fresh for each
 * session. The name is in Android's usual form, as nearby's are (`wifiDirectOptions` in
 * packages/sync/src/nearbySession.ts), so it says nothing about the app or anyone. The new phone's
 * person may type the passphrase, so it uses letters and digits that do not look alike. Pure.
 */
object GiveNames {
  private const val ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  private const val HEX = "0123456789abcdef"
  /** No i, l, o, 0 or 1. */
  const val TYPED = "abcdefghjkmnpqrstuvwxyz23456789"
  const val PASSPHRASE_LENGTH = 10

  private fun word(random: SecureRandom, size: Int, letters: String): String =
    String(CharArray(size) { letters[random.nextInt(letters.length)] })

  fun ssid(random: SecureRandom): String = "DIRECT-${word(random, 2, ALNUM)}-Android_${word(random, 4, HEX)}"

  fun passphrase(random: SecureRandom): String = word(random, PASSPHRASE_LENGTH, TYPED)
}

/**
 * A Give the app session: the page's server and the group it serves on. `close` stops the server,
 * then takes the group down; it is safe to call more than once. A session the server ended by
 * itself (its time ran out, or the group went) stays closed until a stop forgets it, so its
 * status says `serving: false` with what it did.
 */
class GiveApp(val details: Map<String, Any?>, private val server: InstallFileServer, private val teardown: () -> Unit) {
  @Volatile private var closed = false

  val isClosed: Boolean get() = closed

  fun status(): Map<String, Any?> = statusMap(server.status())

  fun close() {
    synchronized(this) {
      if (closed) return
      closed = true
    }
    try { server.close() } catch (_: Exception) {}
    try { teardown() } catch (_: Exception) {}
  }

  companion object {
    /** `NativeGiveStatus` in src/NearbyLinkModule.ts, with no session. */
    val IDLE: Map<String, Any?> = statusMap(InstallFileServer.Status(false, 0, 0, 0, 0, 0))

    private fun statusMap(s: InstallFileServer.Status): Map<String, Any?> = mapOf(
      "serving" to s.serving,
      "sent" to s.sent.toDouble(),
      "total" to s.total.toDouble(),
      "downloads" to s.downloads.toDouble(),
      "asked" to s.asked.toDouble(),
      "lastAskedMs" to s.lastAskedMs.toDouble(),
    )
  }
}
