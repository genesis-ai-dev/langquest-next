package expo.modules.nearbylink

import java.io.IOException
import java.net.ServerSocket
import java.net.Socket

/**
 * A group or hotspot this phone hosts, and the links that connect to it (docs/nearby-sync-plan.md
 * 5.12, The link and the radio). Pure Kotlin on `java.*`, so JUnit runs it over loopback.
 *
 * A Wi-Fi Direct group's server is bound to the group's own address, so only a phone in the
 * group, which knows its passphrase, can reach it: the first connection takes the link, and a
 * later one is closed and reported. A local-only hotspot's address cannot be found reliably (no
 * public API names its interface, and another app can share the same hotspot), so its server
 * listens on every network this phone is on, and anyone there could connect first. So with
 * `candidates` every connection is handed up in turn, and JavaScript tries each: the link is the
 * one that proves the attempt's keys (`LinkSession.isProven`). Until one has, a candidate that
 * ends takes nothing down; once one has, any later connection is refused.
 */
class Hosted(
  val id: String,
  val kind: String,
  val details: Map<String, Any?>,
  private val server: ServerSocket,
  private val teardown: () -> Unit,
  private val adopt: (Socket, Hosted) -> LinkSession,
  private val refused: (Hosted) -> Unit,
  val candidates: Boolean = false,
  /** Candidates held at once, unproven and not ended; past this a connection is closed. */
  private val maxCandidates: Int = 4,
) {
  private val lock = Object()
  @Volatile private var down = false
  /** Adopted and not yet handed to JavaScript. */
  private val waiting = ArrayDeque<LinkSession>()
  /** Every link adopted, handed or not. */
  private val adopted = ArrayList<LinkSession>()

  private fun proven(): Boolean = adopted.any { it.isProven }

  fun acceptLoop() {
    Thread({
      while (!down) {
        val socket = try { server.accept() } catch (e: IOException) { break }
        val verdict = synchronized(lock) {
          // A candidate that ended unproven is forgotten, so strangers coming and going hold nothing.
          if (candidates) adopted.removeAll { it.isEnded && !it.isProven }
          when {
            down -> Verdict.DROP
            !candidates && adopted.isNotEmpty() -> Verdict.REFUSE
            candidates && proven() -> Verdict.REFUSE
            candidates && adopted.size >= maxCandidates -> Verdict.DROP
            else -> Verdict.TAKE
          }
        }
        if (verdict != Verdict.TAKE) {
          try { socket.close() } catch (_: IOException) {}
          // A second phone once the link is settled is reported, so the inviter can be told.
          if (verdict == Verdict.REFUSE) refused(this)
          continue
        }
        tune(socket)
        val session = adopt(socket, this)
        val kept = synchronized(lock) {
          if (down) {
            false
          } else {
            adopted.add(session)
            waiting.addLast(session)
            lock.notifyAll()
            true
          }
        }
        // Taken down between accept and here: nobody will ever be handed this link.
        if (!kept) session.close()
      }
    }, "nearby-host-accept").apply {
      isDaemon = true
      start()
    }
  }

  /**
   * The next link to try. Without `candidates` only the first; with them, each in turn until one
   * has proven the keys. Throws `HOST_TAKEN_DOWN` once there will be no more.
   */
  fun nextLink(): LinkSession {
    synchronized(lock) {
      while (waiting.isEmpty()) {
        if (down || (!candidates && adopted.isNotEmpty()) || (candidates && proven())) {
          throw NearbyException(NearbyCode.HOST_TAKEN_DOWN, "no more links for this group")
        }
        // A candidate proves itself on its own reader, so the wait looks again now and then.
        lock.wait(250)
      }
      return waiting.removeFirst()
    }
  }

  /** Whether a link that ended takes the group down: the link, but not a candidate that never proved the keys. */
  fun endTakesDown(session: LinkSession): Boolean = !candidates || session.isProven

  /** Takes the group down: an abandoned attempt, a link that ended, or `stopAll`. A link already handed keeps running. */
  fun takeDown() {
    val unhanded: List<LinkSession>
    synchronized(lock) {
      if (down) return
      down = true
      unhanded = waiting.toList()
      waiting.clear()
      lock.notifyAll()
    }
    try { server.close() } catch (_: IOException) {}
    for (s in unhanded) s.close()
    try { teardown() } catch (_: Exception) {}
  }
}

internal fun tune(socket: Socket) {
  socket.tcpNoDelay = true
  socket.keepAlive = true
}

private enum class Verdict { TAKE, REFUSE, DROP }
