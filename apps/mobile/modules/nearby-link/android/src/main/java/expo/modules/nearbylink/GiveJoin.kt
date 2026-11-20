package expo.modules.nearbylink

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * Give the app's join link (docs/nearby-sync-plan.md 14.1 step 3, and 14.5): Let someone in hosts
 * its link on Give the app's own group, Give the app's server answers `GET /join` with the link
 * (a 302 to it), and the new phone's LangQuest, newly installed and still on that group's Wi-Fi,
 * reads it there, so nobody scans a third code. The link carries only how to connect, a one-time
 * secret and the pin on the inviter's opening, which the new phone checks, so a wrong group or a
 * wrong answer fails closed. Native checks only the link's shape: the carrier's JavaScript writes
 * it, and the new phone's checks its scheme (`parseKey`), where the scheme is named. Pure: what is
 * said, how an answer is read, and which networks are asked.
 */
object GiveJoin {
  /** Far past a join link's 120 or so characters. */
  const val MAX_LENGTH = 512
  /** Give the app's usual port (`RadioKit.startGiveApp`), where the new phone asks. */
  const val PORT = 8080
  /** How much of an answer is read: a 302's head is a few hundred bytes. */
  const val MAX_ANSWER = 4_096

  /**
   * The address Android usually gives the owner of a Wi-Fi Direct group: always on Android 10, and
   * on later ones unless the phone's maker set otherwise, the owner's own Wi-Fi uses that network,
   * or (Android 11's first tethering module) it chose a random `192.168.x.1` (AOSP's
   * `PrivateAddressCoordinator`, `LEGACY_WIFI_P2P_IFACE_ADDRESS`). So it is asked first, and not only.
   */
  val OWNER: InetAddress = InetAddress.getByAddress(byteArrayOf(192.toByte(), 168.toByte(), 49, 1))

  /** A scheme (RFC 3986 3.1, lower case), then `://join?`. */
  private val SHAPE = Regex("^[a-z][a-z0-9+.-]*://join\\?")

  /**
   * Whether `link` may be answered at `/join` or handed to JavaScript: a join link's shape, at most
   * `MAX_LENGTH` characters, all printable ASCII, so nothing can end the header it goes in. Every
   * value in a real link is percent-encoded (`inviteCode.ts`), so a real link always passes.
   */
  fun ok(link: String?): Boolean =
    link != null && link.length <= MAX_LENGTH && link.all { it in '!'..'~' } && SHAPE.containsMatchIn(link)

  /** What the new phone sends to `host`: the one request, closed after its answer. */
  fun request(host: InetAddress): ByteArray =
    "GET /join HTTP/1.1\r\nHost: ${host.hostAddress}:$PORT\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII)

  /**
   * The join link in the first `size` bytes of an answer to `request`: a 302 whose head came
   * whole, with exactly one `Location` that passes `ok`. Null for anything else: another status,
   * a head cut short, a header folded or without a colon, two locations, or one that is not a
   * join link.
   */
  fun linkFrom(answer: ByteArray, size: Int): String? {
    val text = String(answer, 0, size.coerceIn(0, answer.size), Charsets.ISO_8859_1)
    val lines = ArrayList<String>()
    var start = 0
    var whole = false
    while (true) {
      val end = text.indexOf('\n', start)
      if (end < 0) break
      val line = text.substring(start, end).removeSuffix("\r")
      start = end + 1
      if (line.isEmpty()) {
        whole = true
        break
      }
      lines.add(line)
    }
    if (!whole || lines.isEmpty()) return null
    if (!STATUS_302.matches(lines[0])) return null
    var location: String? = null
    for (line in lines.drop(1)) {
      if (line[0] == ' ' || line[0] == '\t') return null
      val colon = line.indexOf(':')
      if (colon <= 0) return null
      if (line.substring(0, colon).equals("Location", ignoreCase = true)) {
        if (location != null) return null
        location = line.substring(colon + 1).trim()
      }
    }
    return location?.takeIf { ok(it) }
  }

  private val STATUS_302 = Regex("^HTTP/1\\.[01] 302(?: .*)?$")

  /** A join link's query, as JavaScript's `parseJoinCode` takes it: no fragment and no space. */
  private val QUERY = Regex("^[a-z][a-z0-9+.-]*://join\\?([^#\\s]*)$")

  /**
   * The network name in a join link (its `s`), percent-decoded as JavaScript's `parseJoinCode`
   * reads it (`decodeURIComponent`, so a `+` stays a `+`). Null when the link has no join query,
   * a part without a name or `=`, a name twice, no `s`, or an `s` that does not decode: a `%`
   * without two hex digits after it, or bytes that are not UTF-8.
   */
  fun ssidOf(link: String): String? {
    val query = QUERY.find(link)?.groupValues?.get(1) ?: return null
    val names = HashSet<String>()
    var ssid: String? = null
    for (part in query.split('&')) {
      val at = part.indexOf('=')
      if (at < 1) return null
      val name = part.substring(0, at)
      if (!names.add(name)) return null
      if (name == "s") ssid = percentDecoded(part.substring(at + 1)) ?: return null
    }
    return ssid
  }

  /** `text` with each `%XX` as its byte, read as strict UTF-8; null for a stray `%` or bytes that are not UTF-8. */
  private fun percentDecoded(text: String): String? {
    val bytes = ByteArrayOutputStream()
    var i = 0
    while (i < text.length) {
      val c = text[i]
      if (c == '%') {
        if (i + 2 >= text.length) return null
        val hi = Character.digit(text[i + 1], 16)
        val lo = Character.digit(text[i + 2], 16)
        if (hi < 0 || lo < 0) return null
        bytes.write(hi * 16 + lo)
        i += 3
      } else {
        val b = c.toString().toByteArray(Charsets.UTF_8)
        bytes.write(b, 0, b.size)
        i += 1
      }
    }
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes.toByteArray()))
        .toString()
    } catch (e: CharacterCodingException) {
      null
    }
  }

  /** A connected network as the new phone sees it: its IPv4 gateway (null with none), whether Android found internet through it, and whether it is Wi-Fi. */
  data class Seen<T>(val network: T, val gateway: InetAddress?, val validated: Boolean, val wifi: Boolean)

  /**
   * The networks that may be Give the app's group, each with the gateway to ask, in the order to
   * ask them: Wi-Fi only, whose gateway is `OWNER`, or which has no internet (Give the app's group
   * never has) and a private IPv4 gateway (RFC 1918), where an owner on a random address is. Those
   * on `OWNER` first. A home router with working internet is never asked.
   */
  fun <T> candidates(seen: List<Seen<T>>): List<Pair<T, InetAddress>> {
    val asked = seen.mapNotNull { s ->
      val gateway = s.gateway as? Inet4Address ?: return@mapNotNull null
      val maybe = s.wifi && (gateway == OWNER || (!s.validated && gateway.isSiteLocalAddress))
      if (maybe) s.network to (gateway as InetAddress) else null
    }
    return asked.filter { it.second == OWNER } + asked.filter { it.second != OWNER }
  }
}

/**
 * The new phone's side of `GiveJoin`, on the networks it is already on: no network request, so no
 * dialog and no permission past ACCESS_NETWORK_STATE, and a raw socket bound to each network, so
 * the app's cleartext rules do not apply and the phone's default network is not used. Every call
 * is short and gives null for "not there"; none throws.
 */
object GiveJoinNetwork {
  private const val CONNECT_MS = 1_500L
  private const val READ_MS = 2_000L

  /**
   * Every network this phone is connected to, as `GiveJoin.candidates` reads them: its gateway
   * is its IPv4 default route's, or the DHCP server's on Android 11 and later.
   */
  // `allNetworks` is the one synchronous list of every network; a callback would only wait for the same answer.
  @Suppress("DEPRECATION")
  private fun seen(context: Context): List<GiveJoin.Seen<Network>> = try {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    if (cm == null) emptyList() else cm.allNetworks.orEmpty().mapNotNull { n ->
      val caps = cm.getNetworkCapabilities(n) ?: return@mapNotNull null
      val links = cm.getLinkProperties(n) ?: return@mapNotNull null
      val gateway = links.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway
        ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) links.dhcpServerAddress else null)
      GiveJoin.Seen(n, gateway, caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED), caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
    }
  } catch (e: Exception) {
    emptyList()
  }

  /** The networks that may be Give the app's group, with the gateway to ask on each (`GiveJoin.candidates`). */
  fun candidates(context: Context): List<Pair<Network, InetAddress>> = GiveJoin.candidates(seen(context))

  /** A connection to `host` on `port` through `network`, or null when nothing answers within `timeoutMs`. */
  fun connect(network: Network, host: InetAddress, port: Int, timeoutMs: Long): Socket? {
    if (timeoutMs <= 0) return null
    val socket = try { network.socketFactory.createSocket() } catch (e: Exception) { return null }
    return try {
      socket.connect(InetSocketAddress(host, port), timeoutMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
      socket
    } catch (e: Exception) {
      try { socket.close() } catch (_: IOException) {}
      null
    }
  }

  /**
   * A connection on `port` to the owner of the group named `ssid`, through a group this phone is
   * already on as plain Wi-Fi, all within `budgetMs`; null otherwise. Only a candidate whose
   * gateway answers `/join` with a link for that very group (its `s`, `GiveJoin.ssidOf`) is
   * connected to, so a captive portal or an offline router that takes any port is never taken
   * for the inviter's group, and the join goes on as before.
   */
  fun connectOnGroup(context: Context, ssid: String, port: Int, budgetMs: Long): Socket? {
    val until = System.nanoTime() + budgetMs * 1_000_000L
    for ((network, gateway) in candidates(context)) {
      val link = askJoin(network, gateway, until) ?: continue
      if (GiveJoin.ssidOf(link) != ssid) continue
      connect(network, gateway, port, (until - System.nanoTime()) / 1_000_000L)?.let { return it }
    }
    return null
  }

  /**
   * The join link Give the app's server answers at `/join` on a group this phone is on: each
   * candidate's gateway asked in turn on `GiveJoin.PORT`, the first link wins. Null when there is
   * no candidate, no server, no link set, or no answer that is one. The whole call takes at most
   * about `CONNECT_MS` and `READ_MS` together.
   */
  fun findLink(context: Context): String? {
    val until = System.nanoTime() + (CONNECT_MS + READ_MS) * 1_000_000L
    for ((network, gateway) in candidates(context)) askJoin(network, gateway, until)?.let { return it }
    return null
  }

  /** The join link `gateway` answers at `/join` on `GiveJoin.PORT` through `network`, by `until` (nanoTime); null otherwise. */
  private fun askJoin(network: Network, gateway: InetAddress, until: Long): String? {
    val left = (until - System.nanoTime()) / 1_000_000L
    if (left <= 0) return null
    val socket = connect(network, gateway, GiveJoin.PORT, minOf(CONNECT_MS, left)) ?: return null
    return ask(socket, gateway, until)
  }

  /** Sends the request on `socket` and reads the answer until it ends, `MAX_ANSWER` or `until`; closes the socket. */
  private fun ask(socket: Socket, host: InetAddress, until: Long): String? = try {
    socket.use { s ->
      s.getOutputStream().apply {
        write(GiveJoin.request(host))
        flush()
      }
      val input = s.getInputStream()
      val answer = ByteArray(GiveJoin.MAX_ANSWER)
      var size = 0
      while (size < answer.size) {
        val left = (until - System.nanoTime()) / 1_000_000L
        if (left <= 0) break
        s.soTimeout = left.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
        val n = input.read(answer, size, answer.size - size)
        if (n < 0) break
        size += n
      }
      GiveJoin.linkFrom(answer, size)
    }
  } catch (e: Exception) {
    null
  }
}
