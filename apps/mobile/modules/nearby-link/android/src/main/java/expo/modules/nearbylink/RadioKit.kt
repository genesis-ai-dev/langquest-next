package expo.modules.nearbylink

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.RequiresApi
import java.io.File
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** What the radios tell JavaScript, through the module's events. */
interface RadioEvents {
  fun found(seen: Map<String, Any?>)
  fun formSalt(salt: String, rssi: Int)
  fun salt(salt: String)
  fun pipe(linkId: String, salt: String)
  fun refused(hostId: String)
  fun linkDown(linkId: String, code: NearbyCode)
  fun findError(code: NearbyCode)
}

/**
 * Every link this module holds, by id (docs/nearby-sync-plan.md 5.12). JavaScript names a link by
 * the id it was given and nothing else; a link that ends is forgotten and reported once.
 */
class LinkRegistry(
  private val roots: () -> List<File>,
  private val tune: () -> LinkTunables,
  private val events: RadioEvents,
) {
  private val links = ConcurrentHashMap<String, LinkSession>()
  private val ids = AtomicLong()

  fun adopt(transport: Transport, kind: String, onGone: () -> Unit = {}): LinkSession {
    val id = "link-${ids.incrementAndGet()}"
    val session = LinkSession(id, kind, transport, tune(), roots(), onEnded = { s, code ->
      links.remove(s.id)
      try { onGone() } catch (_: Exception) {}
      events.linkDown(s.id, code)
    })
    links[id] = session
    return session
  }

  fun get(id: String): LinkSession = links[id] ?: throw NearbyException(NearbyCode.LINK_UNKNOWN, "no such link")

  fun closeAll() {
    for (link in links.values.toList()) link.close()
  }
}

/**
 * The radios, made only on Android 10 and later and only when JavaScript first asks: the module
 * does nothing at construction and names none of these classes in its fields. Find and the GATT
 * server run on one handler thread; connecting, hosting and joining block a background thread.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class RadioKit(
  private val context: Context,
  private val registry: LinkRegistry,
  private val tune: () -> LinkTunables,
  private val events: RadioEvents,
) {
  private val thread = HandlerThread("nearby-radio").apply { start() }
  private val handler = Handler(thread.looper)
  private val hosts = ConcurrentHashMap<String, Hosted>()
  private val hostIds = AtomicLong()
  /** Joins of the hotspot under way: its system dialog takes the app to the background, which must not stop it. */
  @Volatile var joiningHotspot = 0
    private set
  @Volatile private var findTune: FindTunables? = null

  private val pipes = GattServerPipes(context, tune) { transport, salt ->
    val link = registry.adopt(transport, "bluetooth")
    events.pipe(link.id, Bytes.b64url(salt))
  }

  private val find = BleFind(context, handler, pipes, object : BleFind.Events {
    override fun found(seen: Map<String, Any?>) = events.found(seen)
    override fun formSalt(salt: String, rssi: Int) = events.formSalt(salt, rssi)
    override fun salt(salt: String) = events.salt(salt)
    override fun failed(code: NearbyCode) = events.findError(code)
  })

  private val wifiDirect = WifiDirect(context, handler)
  private val hotspot = Hotspot(context, handler)

  /** Runs on the radio thread and waits for it. */
  private fun <T> onRadio(block: (CompletableFuture<T>) -> Unit): T {
    val f = CompletableFuture<T>()
    handler.post {
      try { block(f) } catch (e: Exception) { f.completeExceptionally(e) }
    }
    return await(f, 30_000, NearbyCode.INTERNAL)
  }

  fun startFind(kFind: ByteArray, scanKeys: List<ByteArray>, payload: ByteArray, r: ByteArray, tunables: FindTunables) {
    Radios.require(context)
    findTune = tunables
    onRadio<Unit> { f -> find.start(kFind, scanKeys, payload, r, tunables) { e -> if (e == null) f.complete(Unit) else f.completeExceptionally(e) } }
  }

  fun updateFind(payload: ByteArray, r: ByteArray) = onRadio<Unit> { f -> find.update(payload, r); f.complete(Unit) }

  fun stopFind() = onRadio<Unit> { f -> find.stop(); f.complete(Unit) }

  fun holdScan(held: Boolean) = onRadio<Unit> { f -> find.holdScan(held); f.complete(Unit) }

  fun holdSalt(held: Boolean) = onRadio<Unit> { f -> find.holdSalt(held); f.complete(Unit) }

  /** A pipe to a phone heard under `scanKeys[scan]`, to the GATT service its salt names. */
  fun openPipe(peer: String, salt: String, scan: Int): LinkSession {
    Radios.require(context)
    val t = findTune ?: throw NearbyException(NearbyCode.FIND_NOT_RUNNING, "Find is not running")
    val key = onRadio<ByteArray?> { f -> f.complete(find.keyAt(scan)) } ?: throw NearbyException(NearbyCode.FIND_NOT_RUNNING, "no such key")
    val saltBytes = Bytes.unb64url(salt)?.takeIf { it.size == FindCodec.SALT_BYTES } ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "a salt is 6 bytes")
    try {
      val client = GattClientPipe(context, peer, key, saltBytes, tune().pipeBytes)
      val transport = client.open(t.connectRetries, t.connectTimeoutMs)
      return registry.adopt(transport, "bluetooth")
    } finally {
      key.fill(0)
    }
  }

  fun host(kind: String, opts: Map<String, Any?>, deadlineMs: Long): Hosted {
    Radios.require(context, wifi = true, bluetooth = false)
    val id = "host-${hostIds.incrementAndGet()}"
    val adopt = { socket: Socket, hosted: Hosted -> registry.adopt(SocketTransport(socket), kind) { takeDown(hosted.id) } }
    val refused = { hosted: Hosted -> events.refused(hosted.id) }
    val hosted = when (kind) {
      "wifi-direct" -> {
        val ssid = opts["ssid"] as? String ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "a group needs a name")
        val passphrase = opts["passphrase"] as? String ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "a group needs a passphrase")
        wifiDirect.host(id, ssid, passphrase, opts["band5"] == true, deadlineMs, adopt, refused)
      }
      "hotspot" -> hotspot.host(id, deadlineMs, adopt, refused)
      else -> throw NearbyException(NearbyCode.BAD_ARGUMENT, "wifi-direct or hotspot")
    }
    hosts[id] = hosted
    return hosted
  }

  fun hostLink(hostId: String): LinkSession = (hosts[hostId] ?: throw NearbyException(NearbyCode.HOST_TAKEN_DOWN, "no such group")).awaitLink()

  /** Takes down a group hosted for an attempt that was abandoned; a link it already gave keeps running. */
  fun takeDown(hostId: String) {
    hosts.remove(hostId)?.takeDown()
  }

  fun join(kind: String, details: Map<String, Any?>, deadlineMs: Long): LinkSession {
    Radios.require(context, wifi = true, bluetooth = false)
    val ssid = details["ssid"] as? String ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "no network name")
    val port = (details["port"] as? Number)?.toInt()?.takeIf { it in 1..65535 } ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "no port")
    val passphrase = details["passphrase"] as? String
    val (socket, down) = when (kind) {
      "wifi-direct" -> wifiDirect.join(ssid, passphrase ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "no passphrase"), port, deadlineMs)
      "hotspot" -> {
        joiningHotspot += 1
        try {
          hotspot.join(ssid, passphrase, details["security"] as? String, port, deadlineMs)
        } finally {
          joiningHotspot -= 1
        }
      }
      else -> throw NearbyException(NearbyCode.BAD_ARGUMENT, "wifi-direct or hotspot")
    }
    return registry.adopt(SocketTransport(socket), kind, down)
  }

  fun stopAll() {
    for (id in hosts.keys.toList()) takeDown(id)
    val stopped = CompletableFuture<Unit>()
    handler.post {
      try { find.stop() } catch (_: Exception) {}
      try { pipes.close() } catch (_: Exception) {}
      stopped.complete(Unit)
    }
    try { await(stopped, 5_000, NearbyCode.INTERNAL) } catch (_: Exception) {}
    findTune = null
  }

  fun quit() {
    stopAll()
    thread.quitSafely()
  }
}
