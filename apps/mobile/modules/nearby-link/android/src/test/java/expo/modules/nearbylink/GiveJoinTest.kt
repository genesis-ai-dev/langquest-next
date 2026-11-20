package expo.modules.nearbylink

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/** The join link Give the app's server answers at `/join`, and how the new phone reads it (docs/nearby-sync-plan.md 14.5). */
class GiveJoinTest {
  private val link = "langquestnext://join?v=1&t=wifi-direct&s=DIRECT-ab-Android_12cd&p=abcdefghjk&h=40123&k=AAAAAAAAAAAAAAAAAAAAAA&c=BBBBBBBBBBBBBBBBBBBBBB"
  private val loopback = InetAddress.getLoopbackAddress()
  private val dir = File(System.getProperty("java.io.tmpdir"), "give-join-${System.nanoTime()}").apply { mkdirs() }

  @After fun tearDown() {
    dir.deleteRecursively()
  }

  /**
   * Why: the link goes into a `Location` header and to JavaScript as it is, so nothing in it may
   * end the header; native checks only its shape, and names no app (JavaScript checks the scheme).
   */
  @Test fun acceptsOnlyAJoinLinksShapeThatCannotEndAHeader() {
    val start = "x://join?"
    for (good in listOf(link, "other-app.dev+x://join?a=1", "$start" + "a".repeat(GiveJoin.MAX_LENGTH - start.length))) assertTrue(good, GiveJoin.ok(good))
    val bad = listOf(
      null, "", "https://example.org/", "langquestnext://join", "LANGQUESTNEXT://join?v=1", "langquestnext://joint?v=1",
      "1app://join?x=1", "://join?x=1", "-app://join?x=1", "a_b://join?x=1", "app:/join?x=1", " langquestnext://join?v=1",
      start + "a".repeat(GiveJoin.MAX_LENGTH - start.length + 1), "$link\r\nSet-Cookie: x=1", "$link\n", "$link\r",
      "langquestnext://join?a b", "langquestnext://join?\u00e9", "langquestnext://join?\u0000", "langquestnext://join?\t",
    )
    for (b in bad) assertFalse(b.toString(), GiveJoin.ok(b))
  }

  /** Why: the new phone asks each candidate's gateway, by its own address, on Give the app's usual port, and closes. */
  @Test fun asksForTheJoinLinkOnTheGatewaysOwnAddress() {
    assertEquals("192.168.49.1", GiveJoin.OWNER.hostAddress)
    assertEquals("GET /join HTTP/1.1\r\nHost: 192.168.49.1:8080\r\nConnection: close\r\n\r\n", String(GiveJoin.request(GiveJoin.OWNER), Charsets.US_ASCII))
    assertEquals("GET /join HTTP/1.1\r\nHost: 192.168.137.1:8080\r\nConnection: close\r\n\r\n", String(GiveJoin.request(ip("192.168.137.1")), Charsets.US_ASCII))
  }

  private fun ip(a: String): InetAddress = InetAddress.getByAddress(a.split('.').map { it.toInt().toByte() }.toByteArray())

  /**
   * Why: Android 11's first tethering module gives a group's owner a random `192.168.x.1`, so the
   * new phone also asks a Wi-Fi network with no internet behind a private gateway; never a router
   * with working internet, never a network that is not Wi-Fi, and the usual owner address first.
   */
  @Test fun asksOnlyWiFiThatMayBeAGroupWithTheUsualOwnerFirst() {
    val seen = listOf(
      GiveJoin.Seen("home", ip("192.168.1.1"), validated = true, wifi = true),
      GiveJoin.Seen("random-owner", ip("192.168.137.1"), validated = false, wifi = true),
      GiveJoin.Seen("cell", ip("10.0.0.1"), validated = false, wifi = false),
      GiveJoin.Seen("usual-owner", GiveJoin.OWNER, validated = false, wifi = true),
      GiveJoin.Seen("public-gateway", ip("8.8.8.1"), validated = false, wifi = true),
      GiveJoin.Seen("no-gateway", null, validated = false, wifi = true),
      GiveJoin.Seen("ten", ip("10.1.2.1"), validated = false, wifi = true),
      GiveJoin.Seen("172", ip("172.16.5.1"), validated = false, wifi = true),
      GiveJoin.Seen("172-outside", ip("172.32.0.1"), validated = false, wifi = true),
      GiveJoin.Seen("link-local", ip("169.254.1.1"), validated = false, wifi = true),
      GiveJoin.Seen("v6", InetAddress.getByName("fe80::1"), validated = false, wifi = true),
      GiveJoin.Seen("usual-with-internet", GiveJoin.OWNER, validated = true, wifi = true),
      GiveJoin.Seen("usual-not-wifi", GiveJoin.OWNER, validated = false, wifi = false),
    )
    assertEquals(
      listOf("usual-owner" to GiveJoin.OWNER, "usual-with-internet" to GiveJoin.OWNER, "random-owner" to ip("192.168.137.1"), "ten" to ip("10.1.2.1"), "172" to ip("172.16.5.1")),
      GiveJoin.candidates(seen),
    )
    assertEquals(emptyList<Pair<String, InetAddress>>(), GiveJoin.candidates(listOf(GiveJoin.Seen("home", ip("192.168.0.1"), validated = true, wifi = true))))
  }

  private fun read(text: String): String? = text.toByteArray(Charsets.ISO_8859_1).let { GiveJoin.linkFrom(it, it.size) }

  /** Why: whatever answers on that address may not be Give the app's server; only a whole 302 to one join link is taken. */
  @Test fun readsTheLinkFromAWhole302AndNothingElse() {
    assertEquals(link, read("HTTP/1.1 302 Found\r\nContent-Type: text/plain; charset=utf-8\r\nLocation: $link\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n"))
    assertEquals(link, read("HTTP/1.0 302\r\nlocation:$link  \r\n\r\n"))
    assertEquals(link, read("HTTP/1.1 302 Found\nLocation: $link\n\n"))
    // Only the bytes read count, and the head must have come whole.
    val whole = "HTTP/1.1 302 Found\r\nLocation: $link\r\n\r\n".toByteArray(Charsets.ISO_8859_1)
    assertEquals(link, GiveJoin.linkFrom(whole + ByteArray(10) { 'x'.code.toByte() }, whole.size))
    assertEquals(link, GiveJoin.linkFrom(whole, whole.size + 100))
    assertNull(GiveJoin.linkFrom(whole, whole.size - 2))
    assertNull(GiveJoin.linkFrom(whole, -1))
    val refused = listOf(
      "HTTP/1.1 404 Not Found\r\nContent-Length: 10\r\n\r\nNot found\n",
      "HTTP/1.1 200 OK\r\nLocation: $link\r\n\r\n",
      "HTTP/1.1 301 Moved Permanently\r\nLocation: $link\r\n\r\n",
      "HTTP/1.1 3020 Found\r\nLocation: $link\r\n\r\n",
      "HTTP/2 302\r\nLocation: $link\r\n\r\n",
      "HTTP/1.1 302 Found\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: $link\r\nLocation: $link\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: https://example.org/\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: langquestnext://join?a\r\n b=1\r\n\r\n",
      "HTTP/1.1 302 Found\r\nNo colon\r\nLocation: $link\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: $link\r\n",
      "\r\n\r\n",
      "",
      "garbage",
    )
    for (r in refused) assertNull(r, read(r))
  }

  /** Why: the two sides are written apart; what the server says, the new phone must read. */
  @Test fun readsWhatGiveTheAppsServerAnswers() {
    val name = "r21-l1-p1-0a1b2c3d.apk"
    val file = File(dir, name).apply { writeBytes(ByteArray(1_000)) }
    val socket = ServerSocket(0, 4, loopback)
    val server = InstallFileServer(socket, "<p>page".toByteArray(), name, file, Subnet(loopback, 8))
    server.start()
    fun askForJoin(): String? = Socket(loopback, socket.localPort).use { s ->
      s.soTimeout = 5_000
      s.getOutputStream().write(GiveJoin.request(loopback))
      s.getOutputStream().flush()
      val answer = s.getInputStream().readBytes()
      GiveJoin.linkFrom(answer, answer.size)
    }
    try {
      assertNull(askForJoin())
      server.setJoin(link)
      assertEquals(link, askForJoin())
      server.setJoin(null)
      assertNull(askForJoin())
    } finally {
      server.close()
    }
  }

  /**
   * Why: the join shortcut takes a group it is already on only when that group's `/join` names
   * the very network the join was asked for; the name is read as JavaScript's `parseJoinCode`
   * reads it, and anything it would refuse names nothing.
   */
  @Test fun readsTheNetworkNameFromAJoinLinkAsJavaScriptDoes() {
    assertEquals("DIRECT-ab-Android_12cd", GiveJoin.ssidOf(link))
    assertEquals("DIRECT-Ab-Android_12cd", GiveJoin.ssidOf("x://join?v=1&s=DIRECT-%41b-Android_12cd&h=1"))
    assertEquals("caf\u00e9 net", GiveJoin.ssidOf("x://join?s=caf%C3%A9%20net"))
    assertEquals("a+b", GiveJoin.ssidOf("x://join?s=a+b"))
    assertEquals("a=b", GiveJoin.ssidOf("x://join?s=a=b"))
    assertEquals("", GiveJoin.ssidOf("x://join?s="))
    val none = listOf(
      "x://join?v=1&t=wifi-direct",
      "x://join?s=a&s=a",
      "x://join?v=1&v=2&s=a",
      "x://join?s=%ZZ",
      "x://join?s=%4",
      "x://join?s=abc%",
      "x://join?s=%E9",
      "x://join?s=%C3",
      "x://join?s=a&&v=1",
      "x://join?=a&s=b",
      "x://join?s",
      "x://join?s=a#frag",
      "x://join?s=a b",
      "https://example.org/?s=a",
      "x://join",
      "",
    )
    for (n in none) assertNull(n, GiveJoin.ssidOf(n))
  }
}
