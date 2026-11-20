package expo.modules.nearbylink

import android.content.Context
import android.net.wifi.p2p.WifiP2pConfig
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.RequiresApi
import java.io.File
import java.io.IOException
import java.net.BindException
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** What the radios tell JavaScript, through the module's events. */
interface RadioEvents {
  fun found(seen: Map<String, Any?>)
  fun advert(heard: Map<String, Any?>)
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

  fun adopt(transport: Transport, kind: String, onGone: (LinkSession) -> Unit = {}): LinkSession {
    val id = "link-${ids.incrementAndGet()}"
    val session = LinkSession(id, kind, transport, tune(), roots(), onEnded = { s, code ->
      links.remove(s.id)
      try { onGone(s) } catch (_: Exception) {}
      events.linkDown(s.id, code)
    })
    links[id] = session
    return session
  }

  fun get(id: String): LinkSession = links[id] ?: throw NearbyException(NearbyCode.LINK_UNKNOWN, "no such link")

  fun closeAll() {
    // Straight over the map, never `toList()`, which can throw when a link ends between its size and its first element.
    for (link in links.values) link.close()
  }
}

/**
 * The radios, made only on Android 10 and later and only when JavaScript first asks: the module
 * does nothing at construction and names none of these classes in its fields. Find and the GATT
 * server run on one handler thread; connecting, hosting and joining block a background thread.
 *
 * A phone holds one Wi-Fi Direct group at a time, so Give the app (docs/nearby-sync-plan.md 14.5)
 * and nearby's groups, hosted or joined, never run at once: whichever comes second is refused
 * with GROUP_BUSY, counted from the moment it starts forming until its group is down.
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
    override fun advert(heard: Map<String, Any?>) = events.advert(heard)
    override fun formSalt(salt: String, rssi: Int) = events.formSalt(salt, rssi)
    override fun salt(salt: String) = events.salt(salt)
    override fun failed(code: NearbyCode) = events.findError(code)
  })

  private val wifiDirect = WifiDirect(context, handler)
  private val hotspot = Hotspot(context, handler)
  private val random = SecureRandom()

  /** Guards the three below: nearby's groups and Give the app's never at once. */
  private val groups = Any()
  /** Nearby's groups hosted or joined, and those forming. */
  private var nearbyGroups = 0
  /** Give the app's session, once it serves; it holds the group until it is closed. */
  private var giving: GiveApp? = null
  /** Give the app's group is forming. */
  private var giveForming = false
  /** Moves on at each stop, so a session that finishes forming after one is taken down at once. */
  private var giveStops = 0L

  /** A nearby group may start forming: none while Give the app runs. */
  private fun claimNearby() = synchronized(groups) {
    if (giving?.isClosed == false || giveForming) throw NearbyException(NearbyCode.GROUP_BUSY, "Give the app holds the Wi-Fi Direct group")
    nearbyGroups += 1
  }

  private fun releaseNearby() = synchronized(groups) { nearbyGroups -= 1 }

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
    claimNearby()
    try {
      return hostClaimed(kind, opts, deadlineMs)
    } catch (e: Exception) {
      releaseNearby()
      throw e
    }
  }

  /** `host` once its group is counted; the group is released when it is taken down. */
  private fun hostClaimed(kind: String, opts: Map<String, Any?>, deadlineMs: Long): Hosted {
    val id = "host-${hostIds.incrementAndGet()}"
    // The link's end takes its group down; a hotspot candidate that never proved the keys does not.
    val adopt = { socket: Socket, hosted: Hosted -> registry.adopt(SocketTransport(socket), kind) { s -> if (hosted.endTakesDown(s)) takeDown(hosted.id) } }
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

  /** The group's next link: its only one on Wi-Fi Direct, each candidate in turn on a hotspot (Hosted). */
  fun hostLink(hostId: String): LinkSession = (hosts[hostId] ?: throw NearbyException(NearbyCode.HOST_TAKEN_DOWN, "no such group")).nextLink()

  /** Takes down a group hosted for an attempt that was abandoned; a link it already gave keeps running. */
  fun takeDown(hostId: String) {
    val hosted = hosts.remove(hostId) ?: return
    try { hosted.takeDown() } finally { releaseNearby() }
  }

  fun join(kind: String, details: Map<String, Any?>, deadlineMs: Long): LinkSession {
    Radios.require(context, wifi = true, bluetooth = false)
    val ssid = details["ssid"] as? String ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "no network name")
    val port = (details["port"] as? Number)?.toInt()?.takeIf { it in 1..65535 } ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "no port")
    val passphrase = details["passphrase"] as? String
    claimNearby()
    val (socket, down) = try {
      joinGroup(kind, ssid, passphrase, details, port, deadlineMs)
    } catch (e: Exception) {
      releaseNearby()
      throw e
    }
    val gone = AtomicBoolean()
    val end = {
      if (gone.compareAndSet(false, true)) {
        try { down() } finally { releaseNearby() }
      }
    }
    try {
      return registry.adopt(SocketTransport(socket), kind) { end() }
    } catch (e: Exception) {
      // Joined, but no link was made of it: leave the network and let the group go.
      try { socket.close() } catch (_: IOException) {}
      end()
      throw e
    }
  }

  private fun joinGroup(kind: String, ssid: String, passphrase: String?, details: Map<String, Any?>, port: Int, deadlineMs: Long): Pair<Socket, () -> Unit> =
    when (kind) {
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

  /**
   * Give the app (docs/nearby-sync-plan.md 14.5): forms a Wi-Fi Direct group under a fresh name
   * and passphrase, and serves `page` and the kept file on the group's own address. GROUP_BUSY
   * while nearby holds a group or a session already runs; STOPPED when a stop came while the
   * group formed.
   */
  fun startGiveApp(page: ByteArray, kept: KeptFile, deadlineMs: Long): Map<String, Any?> {
    // Only Wi-Fi Direct's own permission: Give the app uses no Bluetooth (docs/nearby-sync-plan.md 14.5).
    Radios.requireWifiDirect(context)
    val stopsBefore = synchronized(groups) {
      if (giving?.isClosed == false || giveForming) throw NearbyException(NearbyCode.GROUP_BUSY, "Give the app is already running")
      if (nearbyGroups > 0) throw NearbyException(NearbyCode.GROUP_BUSY, "a nearby group holds Wi-Fi Direct")
      giveForming = true
      giveStops
    }
    val session = try {
      giveOnNewGroup(page, kept, deadlineMs)
    } catch (e: Exception) {
      synchronized(groups) { giveForming = false }
      throw e
    }
    val stillWanted = synchronized(groups) {
      giveForming = false
      (giveStops == stopsBefore).also { if (it) giving = session }
    }
    if (!stillWanted) {
      session.close()
      throw NearbyException(NearbyCode.STOPPED, "stopped while the group formed")
    }
    return session.details
  }

  private fun giveOnNewGroup(page: ByteArray, kept: KeptFile, deadlineMs: Long): GiveApp {
    val ssid = GiveNames.ssid(random)
    val passphrase = GiveNames.passphrase(random)
    // 2.4 GHz, which every phone that joins as plain Wi-Fi can see; some cannot see 5 GHz.
    val group = wifiDirect.form(ssid, passphrase, WifiP2pConfig.GROUP_OWNER_BAND_2GHZ, deadlineMs)
    try {
      val peers = Subnet(group.address, groupPrefix(group.address))
      val socket = giveSocket(group.address)
      var session: GiveApp? = null
      val server = try {
        InstallFileServer(
          socket, page, kept.name, kept.file, peers,
          // The group's interface goes when the group does; serving then stops, and so does the session.
          stillThere = { NetworkInterface.getByInetAddress(group.address) != null },
          onStopped = { session?.close() },
        )
      } catch (e: Exception) {
        try { socket.close() } catch (_: IOException) {}
        throw e
      }
      val details = mapOf("ssid" to ssid, "passphrase" to passphrase, "address" to group.address.hostAddress, "port" to socket.localPort)
      val made = GiveApp(details, server, group.down)
      session = made
      server.start()
      return made
    } catch (e: Exception) {
      try { group.down() } catch (_: Exception) {}
      throw e as? NearbyException ?: NearbyException(NearbyCode.GROUP_FAILED, "could not serve on the group", e)
    }
  }

  /** The group's network prefix, from its own interface: only phones on that network are answered. */
  private fun groupPrefix(address: InetAddress): Int {
    val prefix = try {
      NetworkInterface.getByInetAddress(address)?.interfaceAddresses?.firstOrNull { it.address == address }?.networkPrefixLength?.toInt()
    } catch (e: IOException) {
      null
    }
    return prefix?.takeIf { it in 1..32 } ?: throw NearbyException(NearbyCode.GROUP_FAILED, "the group's network is not known")
  }

  /** Only on the group's own address, so nobody on another network this phone is on reaches the page. */
  private fun giveSocket(address: InetAddress): ServerSocket = try {
    ServerSocket(GIVE_PORT, GIVE_BACKLOG, address)
  } catch (e: BindException) {
    try {
      ServerSocket(0, GIVE_BACKLOG, address)
    } catch (e: IOException) {
      throw NearbyException(NearbyCode.GROUP_FAILED, "no port for the page", e)
    }
  }

  fun giveAppStatus(): Map<String, Any?> = synchronized(groups) { giving }?.status() ?: GiveApp.IDLE

  /** Ends Give the app's session, or one still forming; nothing when there is none. */
  fun stopGiveApp() {
    val session = synchronized(groups) {
      giveStops += 1
      giving.also { giving = null }
    }
    session?.close()
  }

  fun stopAll() {
    stopGiveApp()
    for (id in hosts.keys) takeDown(id)
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

  private companion object {
    /** The page's usual port, so its address reads the same each time; any free one if it is taken. */
    const val GIVE_PORT = 8080
    const val GIVE_BACKLOG = 8
  }
}
