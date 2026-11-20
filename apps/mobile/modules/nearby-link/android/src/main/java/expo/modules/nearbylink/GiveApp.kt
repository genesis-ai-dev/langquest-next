package expo.modules.nearbylink

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

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
 *
 * `joined` counts the phones in the group now, as the framework lists them, so JavaScript can move
 * from code 1 to code 2 by itself once one has joined; null where it cannot tell, and a throw reads
 * the same, so counting never breaks the status. It is asked only while the session is open: a
 * closed one has no group, so it says 0.
 */
class GiveApp(
  val details: Map<String, Any?>,
  private val server: InstallFileServer,
  private val teardown: () -> Unit,
  private val joined: () -> Int? = { null },
) {
  @Volatile private var closed = false

  val isClosed: Boolean get() = closed

  fun status(): Map<String, Any?> {
    val phones = if (closed) 0 else (try { joined() } catch (e: Exception) { null }) ?: 0
    return statusMap(server.status(), phones)
  }

  /** What the page's server answers at `/join` (`InstallFileServer.setJoin`). */
  fun setJoin(link: String?) = server.setJoin(link)

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
    val IDLE: Map<String, Any?> = statusMap(InstallFileServer.Status(false, 0, 0, 0, 0, 0), 0)

    private fun statusMap(s: InstallFileServer.Status, joined: Int): Map<String, Any?> = mapOf(
      "serving" to s.serving,
      "sent" to s.sent.toDouble(),
      "total" to s.total.toDouble(),
      "downloads" to s.downloads.toDouble(),
      "asked" to s.asked.toDouble(),
      "lastAskedMs" to s.lastAskedMs.toDouble(),
      "joined" to joined.coerceAtLeast(0).toDouble(),
    )
  }
}

/**
 * Give the app's Wi-Fi Direct group (docs/nearby-sync-plan.md 14.5), held by its session and by
 * each host Let someone in makes on it (`host`) and each link such a host gives, so a new phone
 * that installed from the page joins on the same group with no third code. The page's end lets go
 * of the session's hold; whichever hold lets go last takes the group down, once. `takeDown` ends
 * it at once, with every host still on it, for a stop of everything. Pure Kotlin on `java.*`, so
 * JUnit runs it over loopback.
 */
class GiveGroup(
  val ssid: String,
  val passphrase: String,
  val address: InetAddress,
  /** The group's own network: a host on it answers no one else (`Hosted.admits`), as the page's server does. */
  private val peers: Subnet,
  private val down: () -> Unit,
) {
  private val lock = Any()
  private var holds = 0
  private var gone = false
  /** Hosts made on the group and not yet taken down. */
  private val hosts = ArrayList<Hosted>()

  /** A hold, as the call that lets go of it, which counts once however often it runs; null once the group is down. */
  fun hold(): (() -> Unit)? {
    synchronized(lock) {
      if (gone) return null
      holds += 1
    }
    val released = AtomicBoolean()
    return { if (released.compareAndSet(false, true)) letGo() }
  }

  val isDown: Boolean get() = synchronized(lock) { gone }

  /** Holds not yet let go of. */
  val held: Int get() = synchronized(lock) { holds }

  private fun letGo() {
    val last = synchronized(lock) {
      holds -= 1
      (holds == 0 && !gone).also { if (it) gone = true }
    }
    if (last) try { down() } catch (_: Exception) {}
  }

  /** Takes the group down now, and every host still on it; a hold let go of later changes nothing. */
  fun takeDown() {
    val left = synchronized(lock) {
      if (gone) return
      gone = true
      ArrayList(hosts).also { hosts.clear() }
    }
    for (h in left) try { h.takeDown() } catch (_: Exception) {}
    try { down() } catch (_: Exception) {}
  }

  /**
   * One look at whether the group is still there (`there`: its interface still has its address),
   * and whether to look again. Once it has gone it is taken down now, with every host on it, so a
   * let-in code on it ends rather than waiting on a dead address and holding Wi-Fi Direct busy. A
   * look that cannot be answered says nothing, as the page's server reads it.
   */
  fun watch(there: () -> Boolean): Boolean {
    if (isDown) return false
    val gone = try { !there() } catch (e: Exception) { false }
    if (!gone) return true
    takeDown()
    return false
  }

  /**
   * A host on this group (Let someone in, `RadioKit.hostOnGiveGroup`): `server`, bound to the
   * group's own address, under the group's name and passphrase as `kind: 'wifi-direct'`, as
   * `WifiDirect.host` gives one. It answers only phones on the group's own network (`peers`):
   * Linux takes packets for the address that arrive on any interface, so a caller from another
   * network this phone is on is closed unanswered and never becomes the link. A connection that
   * cannot be made a link lets go of the hold it took, and the next is still taken. It holds the group until it is taken down, and its link holds it
   * until that link ends, so either keeps the group up once the page has gone; its own teardown
   * closes only its socket (`Hosted.takeDown`) and lets go of its hold. `adopt` makes a link of a
   * connection and calls the function it is given when that link ends; `linkEnded` then runs for
   * the caller, which takes the host down as for any Wi-Fi Direct link. Null when the group is
   * already down. Not yet accepting: the caller registers it, then calls `acceptLoop`.
   */
  fun host(
    id: String,
    server: ServerSocket,
    adopt: (Socket, (LinkSession) -> Unit) -> LinkSession,
    linkEnded: (Hosted, LinkSession) -> Unit,
    refused: (Hosted) -> Unit,
  ): Hosted? {
    val release = hold() ?: return null
    val details = mapOf("kind" to "wifi-direct", "ssid" to ssid, "passphrase" to passphrase, "port" to server.localPort)
    var made: Hosted? = null
    val teardown = {
      synchronized(lock) { made?.let { hosts.remove(it) } }
      release()
    }
    val hosted = Hosted(id, "wifi-direct", details, server, teardown, { socket, h ->
      val linkHold = hold()
      val link = try {
        adopt(socket) { s ->
          linkHold?.invoke()
          linkEnded(h, s)
        }
      } catch (e: Exception) {
        // No link was made, so nothing will end and let go of its hold; the host takes the next connection.
        linkHold?.invoke()
        throw e
      }
      // The group went while this phone connected: nothing can run on it.
      if (linkHold == null) link.close()
      link
    }, refused, admits = { peers.contains(it) })
    val kept = synchronized(lock) {
      made = hosted
      if (!gone) hosts.add(hosted)
      !gone
    }
    if (!kept) {
      hosted.takeDown()
      return null
    }
    return hosted
  }
}
