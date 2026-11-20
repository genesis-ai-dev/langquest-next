package expo.modules.nearbylink

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import androidx.annotation.RequiresApi
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Connects to `host:port`, trying again until the deadline: a group's address answers a moment after it forms. */
internal fun connectBy(deadline: Long, make: () -> Socket, host: InetAddress, port: Int): Socket {
  var last: IOException? = null
  while (System.currentTimeMillis() < deadline) {
    val socket = make()
    try {
      val left = (deadline - System.currentTimeMillis()).coerceIn(500, 5_000).toInt()
      socket.connect(InetSocketAddress(host, port), left)
      tune(socket)
      return socket
    } catch (e: IOException) {
      last = e
      try { socket.close() } catch (_: IOException) {}
      Thread.sleep(300)
    }
  }
  throw NearbyException(NearbyCode.JOIN_TIMEOUT, "could not reach the host", last)
}

internal fun <T> await(future: CompletableFuture<T>, ms: Long, timeout: NearbyCode): T = try {
  future.get(ms, TimeUnit.MILLISECONDS)
} catch (e: TimeoutException) {
  throw NearbyException(timeout, "no answer by the deadline")
} catch (e: ExecutionException) {
  throw (e.cause as? NearbyException) ?: NearbyException(NearbyCode.INTERNAL, "the radio failed", e.cause)
}

/**
 * Wi-Fi Direct by name and passphrase (docs/nearby-sync-plan.md 4, 5.12): `WifiP2pConfig.Builder`,
 * Android 10 and later, silent to join. JavaScript chooses a name in Android's usual form and a
 * random passphrase; the group is never persistent, because a saved group keeps the device
 * address. Peers and services are never discovered, since those are the calls that need Location.
 * Blocking calls, run on a background thread.
 */
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission")
class WifiDirect(private val context: Context, private val handler: Handler) {
  private fun manager(): WifiP2pManager =
    context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager ?: throw NearbyException(NearbyCode.P2P_UNSUPPORTED, "no Wi-Fi Direct")

  private fun failure(reason: Int) = when (reason) {
    WifiP2pManager.P2P_UNSUPPORTED -> NearbyException(NearbyCode.P2P_UNSUPPORTED, "Wi-Fi Direct is not supported")
    WifiP2pManager.BUSY -> NearbyException(NearbyCode.GROUP_BUSY, "Wi-Fi Direct is busy")
    else -> NearbyException(NearbyCode.GROUP_FAILED, "Wi-Fi Direct failed ($reason)")
  }

  private fun listener(future: CompletableFuture<Unit>) = object : WifiP2pManager.ActionListener {
    override fun onSuccess() { future.complete(Unit) }
    override fun onFailure(reason: Int) { future.completeExceptionally(failure(reason)) }
  }

  private fun config(ssid: String, passphrase: String, band: Int): WifiP2pConfig = try {
    WifiP2pConfig.Builder()
      .setNetworkName(ssid)
      .setPassphrase(passphrase)
      .setGroupOperatingBand(band)
      .enablePersistentMode(false)
      .build()
  } catch (e: IllegalArgumentException) {
    throw NearbyException(NearbyCode.BAD_ARGUMENT, "a Wi-Fi Direct name or passphrase Android will not take")
  }

  private fun info(manager: WifiP2pManager, channel: WifiP2pManager.Channel, deadline: Long, owner: Boolean): WifiP2pInfo {
    // The connection broadcast is not sticky from Android 10, so this asks until the group has formed.
    while (System.currentTimeMillis() < deadline) {
      val f = CompletableFuture<WifiP2pInfo?>()
      manager.requestConnectionInfo(channel) { f.complete(it) }
      val info = try { f.get(2_000, TimeUnit.MILLISECONDS) } catch (e: Exception) { null }
      if (info != null && info.groupFormed && info.isGroupOwner == owner && info.groupOwnerAddress != null) return info
      Thread.sleep(400)
    }
    throw NearbyException(if (owner) NearbyCode.GROUP_FAILED else NearbyCode.JOIN_TIMEOUT, "the group did not form")
  }

  /**
   * A group this phone owns: its own address, how to take it down, and how many phones are in it
   * now (`joined`, waiting at most the milliseconds given; null where it cannot tell).
   */
  class Owned(val address: InetAddress, val down: () -> Unit, val joined: (Long) -> Int? = { null })

  /**
   * The phones in this phone's group now, as the framework lists its clients
   * (`WifiP2pGroup.getClientList`); null when it has no group it owns, will not say (no
   * permission, or a SecurityException where a phone's Android throws one), or does not answer
   * within `waitMs`. A phone that joined as plain Wi-Fi by name and passphrase is listed too:
   * Android adds every station the group lets in, by its Wi-Fi address when it has no Wi-Fi Direct
   * one (AOSP's `createStaEventDevice`, and the group owner's AP_STA_CONNECTED_EVENT). It needs
   * what forming the group needed, and not Location turned on. The answer comes on the radio
   * thread; this waits on the caller's.
   */
  private fun clientsIn(manager: WifiP2pManager, channel: WifiP2pManager.Channel, waitMs: Long): Int? {
    val answer = CompletableFuture<Int?>()
    try {
      manager.requestGroupInfo(channel) { group -> answer.complete(group?.takeIf { it.isGroupOwner }?.clientList?.size) }
    } catch (e: Exception) {
      return null
    }
    return try { answer.get(waitMs, TimeUnit.MILLISECONDS) } catch (e: Exception) { null }
  }

  /**
   * Forms a group this phone owns, by name and passphrase on `band` (`WifiP2pConfig`'s
   * `GROUP_OWNER_BAND_*`), and waits until it has its address. Nearby's `host` and Give the app
   * both form theirs here.
   */
  fun form(ssid: String, passphrase: String, band: Int, deadlineMs: Long): Owned {
    val manager = manager()
    val channel = manager.initialize(context, handler.looper, null) ?: throw NearbyException(NearbyCode.P2P_UNSUPPORTED, "no Wi-Fi Direct channel")
    val down = { manager.removeGroup(channel, null); channel.close() }
    try {
      // A stale group can make createGroup answer busy.
      val removed = CompletableFuture<Unit>()
      manager.removeGroup(channel, object : WifiP2pManager.ActionListener {
        override fun onSuccess() { removed.complete(Unit) }
        override fun onFailure(reason: Int) { removed.complete(Unit) }
      })
      try { removed.get(3_000, TimeUnit.MILLISECONDS) } catch (_: Exception) {}
      val created = CompletableFuture<Unit>()
      manager.createGroup(channel, config(ssid, passphrase, band), listener(created))
      await(created, deadlineMs, NearbyCode.GROUP_FAILED)
      val info = info(manager, channel, System.currentTimeMillis() + deadlineMs, true)
      return Owned(info.groupOwnerAddress, down) { waitMs -> clientsIn(manager, channel, waitMs) }
    } catch (e: Exception) {
      try { down() } catch (_: Exception) {}
      throw e as? NearbyException ?: NearbyException(NearbyCode.GROUP_FAILED, "could not form a group", e)
    }
  }

  fun host(
    id: String, ssid: String, passphrase: String, band5: Boolean, deadlineMs: Long,
    adopt: (Socket, Hosted) -> LinkSession, refused: (Hosted) -> Unit,
  ): Hosted {
    val group = form(ssid, passphrase, if (band5) WifiP2pConfig.GROUP_OWNER_BAND_5GHZ else WifiP2pConfig.GROUP_OWNER_BAND_AUTO, deadlineMs)
    try {
      // Bound to the group's own address. That alone does not keep out a device on another network
      // this phone is on (Linux takes packets for the address on any interface): such a caller could
      // take the one link and end the attempt, no more, since the link's keys come from the code.
      val server = ServerSocket(0, 2, group.address)
      val hosted = Hosted(
        id, "wifi-direct",
        mapOf("kind" to "wifi-direct", "ssid" to ssid, "passphrase" to passphrase, "port" to server.localPort, "band" to if (band5) "5" else "auto"),
        server, group.down, adopt, refused,
      )
      hosted.acceptLoop()
      return hosted
    } catch (e: Exception) {
      try { group.down() } catch (_: Exception) {}
      throw e as? NearbyException ?: NearbyException(NearbyCode.GROUP_FAILED, "could not host a group", e)
    }
  }

  /**
   * Joins by name and passphrase, then connects to the group owner. The function given back takes
   * the group down when the link ends.
   *
   * First, a phone already on a group as plain Wi-Fi (a new phone still on Give the app's group,
   * docs/nearby-sync-plan.md 14.5) connects through that network: a Wi-Fi Direct join of the group
   * it is already on would fail. Only where a Wi-Fi network that may be such a group
   * (`GiveJoin.candidates`) has a gateway that answers `/join` with a link naming this very
   * group (`ssid`), and then takes a connection on `port`, all within `ALREADY_ON_MS`; its end
   * closes only the socket, since no network was asked for. Anywhere else (no such network, a
   * captive portal or offline router that takes any port, another group) the join goes on as
   * before, with what is left of the deadline. The opening must still match the link's pin.
   */
  fun join(ssid: String, passphrase: String, port: Int, deadlineMs: Long): Pair<Socket, () -> Unit> {
    val deadline = System.currentTimeMillis() + deadlineMs
    alreadyOn(ssid, port, deadlineMs)?.let { socket ->
      return socket to { try { socket.close() } catch (_: IOException) {} }
    }
    val left = deadline - System.currentTimeMillis()
    if (left <= 0) throw NearbyException(NearbyCode.JOIN_TIMEOUT, "no time left to join")
    val manager = manager()
    val channel = manager.initialize(context, handler.looper, null) ?: throw NearbyException(NearbyCode.P2P_UNSUPPORTED, "no Wi-Fi Direct channel")
    val down = { manager.removeGroup(channel, null); channel.close() }
    try {
      val connected = CompletableFuture<Unit>()
      manager.connect(channel, config(ssid, passphrase, WifiP2pConfig.GROUP_OWNER_BAND_AUTO), listener(connected))
      await(connected, left, NearbyCode.JOIN_TIMEOUT)
      val info = info(manager, channel, deadline, false)
      return connectBy(deadline, { Socket() }, info.groupOwnerAddress, port) to down
    } catch (e: Exception) {
      try { down() } catch (_: Exception) {}
      throw e as? NearbyException ?: NearbyException(NearbyCode.JOIN_FAILED, "could not join the group", e)
    }
  }

  /**
   * A connection on `port` to the owner of the group named `ssid`, through that group when this
   * phone is already on it as plain Wi-Fi: only where a candidate's gateway answers `/join` with a
   * link for this very group (`GiveJoinNetwork.connectOnGroup`), all within `ALREADY_ON_MS`; null
   * otherwise, and the join goes on as before.
   */
  private fun alreadyOn(ssid: String, port: Int, deadlineMs: Long): Socket? {
    val socket = GiveJoinNetwork.connectOnGroup(context, ssid, port, minOf(ALREADY_ON_MS, deadlineMs)) ?: return null
    tune(socket)
    return socket
  }

  private companion object {
    /** How long a connection through the network this phone is already on may take before the usual join. */
    const val ALREADY_ON_MS = 3_000L
  }
}

/**
 * The local-only hotspot, tried where Wi-Fi Direct fails (docs/nearby-sync-plan.md 4). The system
 * chooses the name and passphrase, and the joining phone sees a system dialog, which names the
 * application; a disguised phone never joins one (5.8). Blocking calls, run on a background thread.
 */
// The reservation's older configuration is read only below Android 11.
@Suppress("DEPRECATION")
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission")
class Hotspot(private val context: Context, private val handler: Handler) {
  private fun failure(reason: Int) = when (reason) {
    WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL -> NearbyException(NearbyCode.HOTSPOT_NO_CHANNEL, "no channel for a hotspot")
    WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE -> NearbyException(NearbyCode.HOTSPOT_INCOMPATIBLE, "the hotspot cannot run beside what Wi-Fi is doing")
    WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED -> NearbyException(NearbyCode.HOTSPOT_TETHERING_DISALLOWED, "this phone does not allow a hotspot")
    else -> NearbyException(NearbyCode.HOTSPOT_FAILED, "the hotspot did not start ($reason)")
  }

  /** `SoftApConfiguration.SECURITY_TYPE_*` (API 30), by value. */
  private fun securityOf(type: Int): String = when (type) {
    0 -> "open"
    1 -> "wpa2"
    2 -> "wpa3-transition"
    3 -> "wpa3"
    else -> "other"
  }

  fun host(id: String, deadlineMs: Long, adopt: (Socket, Hosted) -> LinkSession, refused: (Hosted) -> Unit): Hosted {
    val wifi = Radios.wifi(context) ?: throw NearbyException(NearbyCode.HOTSPOT_FAILED, "no Wi-Fi")
    val started = CompletableFuture<WifiManager.LocalOnlyHotspotReservation>()
    var held: WifiManager.LocalOnlyHotspotReservation? = null
    try {
      wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
        override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
          if (!started.complete(reservation)) reservation.close()
        }
        override fun onFailed(reason: Int) { started.completeExceptionally(failure(reason)) }
      }, handler)
    } catch (e: IllegalStateException) {
      throw NearbyException(NearbyCode.HOTSPOT_FAILED, "a hotspot is already running", e)
    } catch (e: SecurityException) {
      throw NearbyException(NearbyCode.NO_PERMISSION, "the hotspot needs a permission", e)
    }
    try {
      val reservation = await(started, deadlineMs, NearbyCode.HOTSPOT_FAILED)
      held = reservation
      val details = HashMap<String, Any?>()
      details["kind"] = "hotspot"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val c = reservation.softApConfiguration
        details["ssid"] = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) c.wifiSsid?.toString()?.removeSurrounding("\"") else c.ssid
        details["passphrase"] = c.passphrase
        details["security"] = securityOf(c.securityType)
      } else {
        val c = reservation.wifiConfiguration
        details["ssid"] = c?.SSID?.removeSurrounding("\"")
        details["passphrase"] = c?.preSharedKey?.removeSurrounding("\"")
        details["security"] = "wpa2"
      }
      if (details["ssid"] == null) throw NearbyException(NearbyCode.HOTSPOT_FAILED, "the hotspot has no name")
      // On every network: the hotspot's own address cannot be found reliably, so every connection
      // is a candidate until one proves the attempt's keys (Hosted).
      val server = ServerSocket(0, 4)
      details["port"] = server.localPort
      val hosted = Hosted(id, "hotspot", details, server, { reservation.close() }, adopt, refused, candidates = true)
      hosted.acceptLoop()
      return hosted
    } catch (e: Exception) {
      held?.close()
      throw e as? NearbyException ?: NearbyException(NearbyCode.HOTSPOT_FAILED, "could not host a hotspot", e)
    }
  }

  /** Asks the system for the network (it shows a dialog), then connects through it. */
  fun join(ssid: String, passphrase: String?, security: String?, port: Int, deadlineMs: Long): Pair<Socket, () -> Unit> {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: throw NearbyException(NearbyCode.JOIN_FAILED, "no connectivity service")
    val spec = try {
      WifiNetworkSpecifier.Builder().setSsid(ssid).apply {
        when {
          passphrase == null || security == "open" -> {}
          security == "wpa3" -> setWpa3Passphrase(passphrase)
          else -> setWpa2Passphrase(passphrase)
        }
      }.build()
    } catch (e: IllegalArgumentException) {
      throw NearbyException(NearbyCode.BAD_ARGUMENT, "a hotspot name or passphrase Android will not take")
    }
    val request = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .setNetworkSpecifier(spec)
      .build()
    val available = CompletableFuture<Network>()
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) { available.complete(network) }
      override fun onUnavailable() { available.completeExceptionally(NearbyException(NearbyCode.JOIN_TIMEOUT, "the hotspot was not joined")) }
    }
    val down = { try { cm.unregisterNetworkCallback(callback) } catch (_: Exception) {} }
    val deadline = System.currentTimeMillis() + deadlineMs
    try {
      cm.requestNetwork(request, callback, handler, deadlineMs.coerceIn(1, Int.MAX_VALUE.toLong()).toInt())
      val network = await(available, deadlineMs, NearbyCode.JOIN_TIMEOUT)
      val links = cm.getLinkProperties(network) ?: throw NearbyException(NearbyCode.JOIN_FAILED, "the hotspot's network has no address")
      val gateway = links.routes.mapNotNull { it.gateway }.firstOrNull { it is Inet4Address && !it.isAnyLocalAddress }
        ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) links.dhcpServerAddress else null)
        ?: throw NearbyException(NearbyCode.JOIN_FAILED, "the hotspot's address is not known")
      return connectBy(deadline, { network.socketFactory.createSocket() }, gateway, port) to down
    } catch (e: Exception) {
      down()
      throw e as? NearbyException ?: NearbyException(NearbyCode.JOIN_FAILED, "could not join the hotspot", e)
    }
  }
}
