package expo.modules.nearbylink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Give the app's names and the install file's checks that need no phone (docs/nearby-sync-plan.md 14.5). */
class GiveAppTest {
  private val random = SecureRandom()

  /**
   * Why: JavaScript moves from code 1 to code 2 by itself once a phone is in the group, asking
   * about once a second; a framework that cannot say, or a session already closed, must read as
   * nobody there rather than fail the status.
   */
  @Test fun theStatusCountsThePhonesInTheGroupAndSaysZeroWhereItCannotTell() {
    val loopback = InetAddress.getLoopbackAddress()
    val file = File.createTempFile("r21-l1-p1-0a1b2c3d", ".apk").apply { writeBytes(ByteArray(10)); deleteOnExit() }
    val server = InstallFileServer(ServerSocket(0, 1, loopback), "<p>page".toByteArray(), "r21-l1-p1-0a1b2c3d.apk", file, Subnet(loopback, 8))
    var listed: Int? = 2
    var asked = 0
    val give = GiveApp(emptyMap(), server, {}) {
      asked += 1
      if (listed == 99) throw SecurityException("taken back")
      listed
    }
    try {
      assertEquals(2.0, give.status()["joined"])
      listed = null
      assertEquals(0.0, give.status()["joined"])
      listed = -1
      assertEquals(0.0, give.status()["joined"])
      listed = 99
      assertEquals(0.0, give.status()["joined"])
      assertEquals(false, give.status()["serving"])
      give.close()
      listed = 3
      assertEquals(0.0, give.status()["joined"])
      assertEquals("a closed session asks nobody", 5, asked)
    } finally {
      give.close()
    }
    assertEquals(0.0, GiveApp.IDLE["joined"])
  }

  /** Why: JavaScript reads the status by `NativeGiveStatus`'s names; a field missing here reads as undefined there. */
  @Test fun theStatusHasExactlyNativeGiveStatussFields() {
    val root = File(System.getProperty("nearby.vectors") ?: "../test-vectors.json").absoluteFile.parentFile
    val ts = File(root, "src/NearbyLinkModule.ts").readText()
    val body = Regex("export interface NativeGiveStatus \\{([\\s\\S]*?)\\n\\}").find(ts)!!.groupValues[1].replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
    val fields = Regex("^\\s+(\\w+)\\??:", RegexOption.MULTILINE).findAll(body).map { it.groupValues[1] }.toSet()
    assertTrue(fields.toString(), "joined" in fields)
    assertEquals(fields, GiveApp.IDLE.keys)
  }

  @Test fun theWifiNameIsInAndroidsUsualFormAndNamesNothing() {
    val form = Regex("^DIRECT-[A-Za-z0-9]{2}-Android_[0-9a-f]{4}$")
    val names = (1..200).map { GiveNames.ssid(random) }
    for (n in names) assertTrue(n, form.matches(n))
    assertTrue("fresh each time", names.toSet().size > 150)
  }

  /** Why: the person with the new phone may type it, so no letters that look alike. */
  @Test fun thePassphraseIsTenLettersOrDigitsThatDoNotLookAlike() {
    val passphrases = (1..200).map { GiveNames.passphrase(random) }
    for (p in passphrases) {
      assertEquals(p, 10, p.length)
      assertTrue(p, p.all { it in "abcdefghjkmnpqrstuvwxyz23456789" })
    }
    assertEquals(200, passphrases.toSet().size)
  }

  @Test fun keepsOnlyACarriedBuildsName() {
    for (good in listOf("r21-l1-p1-0a1b2c3d.apk", "r21-l1-p1.2-0a1b2c3d.apk")) assertTrue(good, InstallFiles.nameOk(good))
    for (bad in listOf("r21-l1-p1-0A1B2C3D.apk", "r21-l1-p1-0a1b2c3.apk", "app.apk", "r21-l1-p1-0a1b2c3d.apk.part", "../r21-l1-p1-0a1b2c3d.apk", "r21-l1-p1-0a1b2c3d.apk/x", "r٢-l1-p1-0a1b2c3d.apk")) {
      assertFalse(bad, InstallFiles.nameOk(bad))
    }
  }

  /** Why: a real but older build renamed to today's name passed the signer check; its runtime version gives it away. */
  @Test fun aNameMustHoldTheBuildsOwnFingerprint() {
    val name = "r21-l1-p1.2-0a1b2c3d.apk"
    assertEquals("0a1b2c3d", InstallFiles.fingerprintOf(name))
    assertTrue(InstallFiles.runtimeMatches(name, "0a1b2c3d9f8e7d6c5b4a39281706f5e4d3c2b1a0"))
    assertTrue(InstallFiles.runtimeMatches(name, "0A1B2C3D9F8E"))
    assertFalse(InstallFiles.runtimeMatches(name, "ffffffff9f8e7d6c5b4a39281706f5e4d3c2b1a0"))
    assertFalse(InstallFiles.runtimeMatches(name, "1.0.0"))
    // A runtime version that cannot be read keeps the file: the signer check has shown it is the app's own.
    assertTrue(InstallFiles.runtimeMatches(name, null))
  }

  /** Why: under the fingerprint policy the meta-data says only where to look; expo-updates reads the build's own asset. */
  @Test fun readsTheRuntimeVersionAsExpoUpdatesDoes() {
    val asset = "0a1b2c3d9f8e7d6c5b4a39281706f5e4d3c2b1a0"
    assertEquals(asset, InstallFiles.runtimeVersionFrom("file:fingerprint") { "$asset\n" })
    assertNull(InstallFiles.runtimeVersionFrom("file:fingerprint") { null })
    assertEquals("12", InstallFiles.runtimeVersionFrom("string:12") { fail("no asset for a plain version"); null })
    assertEquals("0a1b2c3d", InstallFiles.runtimeVersionFrom(" 0a1b2c3d ") { null })
    assertNull(InstallFiles.runtimeVersionFrom(null) { asset })
    assertNull(InstallFiles.runtimeVersionFrom("") { asset })
  }

  /** Why: a file signed by anyone else, or by this app's key and another too, is not this app's own. */
  @Test fun signersMatchOnlyAsTheSameSet() {
    val a = byteArrayOf(1, 2, 3)
    val b = byteArrayOf(4, 5, 6)
    assertTrue(InstallFiles.sameSigners(listOf(a), listOf(a.copyOf())))
    assertTrue(InstallFiles.sameSigners(listOf(a, b), listOf(b, a)))
    assertFalse(InstallFiles.sameSigners(listOf(a), listOf(b)))
    assertFalse(InstallFiles.sameSigners(listOf(a, b), listOf(a)))
    assertFalse(InstallFiles.sameSigners(listOf(a), listOf(a, b)))
    assertFalse(InstallFiles.sameSigners(emptyList(), emptyList()))
  }

  private fun apkWith(vararg entries: Pair<String, String>): File {
    val file = File.createTempFile("carried", ".apk")
    file.deleteOnExit()
    ZipOutputStream(FileOutputStream(file)).use { zip ->
      for ((name, text) in entries) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(text.toByteArray())
        zip.closeEntry()
      }
    }
    return file
  }

  /**
   * Why: a carrier's kept copy kept its first JavaScript until the versions changed, so the app
   * compares when the copy was built with when its own app was, to say a newer file is ready
   * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md). The time is expo-updates'
   * `commitTime`, written into the build's assets as `app.manifest`.
   */
  @Test fun readsWhenAKeptBuildsJavaScriptWasBuiltFromItsUpdatesManifest() {
    val manifest = "{\"id\":\"6f1c\",\"commitTime\":1763500000000,\"assets\":[{\"name\":\"a\"}]}"
    assertEquals(1763500000000L, InstallFiles.builtAtOf(apkWith("classes.dex" to "dex", "assets/app.manifest" to manifest)))
    assertEquals(1763500000000L, InstallFiles.builtAtFrom("{ \"commitTime\" : 1763500000000 }"))
    // No manifest, one with no time, or a file that is not a zip: unknown, so nothing is said.
    assertNull(InstallFiles.builtAtOf(apkWith("classes.dex" to "dex")))
    assertNull(InstallFiles.builtAtOf(apkWith("assets/app.manifest" to "{\"id\":\"6f1c\"}")))
    assertNull(InstallFiles.builtAtOf(File.createTempFile("not-a-zip", ".apk").apply { writeText("hello"); deleteOnExit() }))
    assertNull(InstallFiles.builtAtOf(File("/nowhere/at/all.apk")))
    assertNull(InstallFiles.builtAtFrom("{\"commitTime\":0}"))
    assertNull(InstallFiles.builtAtFrom("{\"commitTime\":\"soon\"}"))
    assertNull(InstallFiles.builtAtFrom(null))
  }

  private fun group(downs: AtomicInteger, peers: Subnet = Subnet(InetAddress.getLoopbackAddress(), 8)) =
    GiveGroup("DIRECT-ab-Android_12cd", "abcdefghjk", InetAddress.getLoopbackAddress(), peers) { downs.incrementAndGet() }

  private fun eventually(what: String, check: () -> Boolean) {
    val until = System.currentTimeMillis() + 5_000
    while (!check()) {
      if (System.currentTimeMillis() > until) fail(what)
      Thread.sleep(10)
    }
  }

  /**
   * Why: Let someone in hosts its link on Give the app's group, so the group must outlive the page
   * while a host or link holds it, and go once, when the last lets go; a hold let go of twice
   * counts once, or a host and its link ending together would take it down under another.
   */
  @Test fun theGroupGoesOnceWhenTheLastHoldLetsGo() {
    val downs = AtomicInteger()
    val g = group(downs)
    val page = g.hold()!!
    val host = g.hold()!!
    page()
    page()
    assertEquals(0, downs.get())
    assertEquals(1, g.held)
    val link = g.hold()!!
    host()
    assertEquals(0, downs.get())
    assertFalse(g.isDown)
    link()
    assertEquals(1, downs.get())
    assertTrue(g.isDown)
    assertNull("nothing holds a group that has gone", g.hold())
    g.takeDown()
    link()
    assertEquals(1, downs.get())
  }

  /** Why: a stop of everything ends the group whatever still holds it, and a late let-go changes nothing. */
  @Test fun aStopOfEverythingTakesTheGroupDownWhateverHoldsIt() {
    val downs = AtomicInteger()
    val g = group(downs)
    val page = g.hold()!!
    g.hold()!!
    g.takeDown()
    assertEquals(1, downs.get())
    page()
    g.takeDown()
    assertEquals(1, downs.get())
    assertNull(g.hold())
  }

  /**
   * Why: the host Let someone in makes on the group gives one link; the page may stop first, and
   * the group must stay until the host and its link have both ended. The host's own teardown
   * closes only its listener. Wired as RadioKit wires it, over loopback.
   */
  @Test fun aHostOnTheGroupAndItsLinkKeepItUpAfterThePage() {
    val loopback = InetAddress.getLoopbackAddress()
    val downs = AtomicInteger()
    val refused = AtomicInteger()
    val g = group(downs)
    val page = g.hold()!!
    val server = ServerSocket(0, 2, loopback)
    val hosted = g.host(
      "host-1", server,
      adopt = { socket, gone -> LinkSession("link-1", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList(), onEnded = { s, _ -> gone(s) }) },
      linkEnded = { h, s -> if (h.endTakesDown(s)) h.takeDown() },
      refused = { refused.incrementAndGet() },
    )!!
    assertEquals(mapOf("kind" to "wifi-direct", "ssid" to "DIRECT-ab-Android_12cd", "passphrase" to "abcdefghjk", "port" to server.localPort), hosted.details)
    hosted.acceptLoop()
    val phone = Socket(loopback, server.localPort)
    try {
      val link = hosted.nextLink()
      page()
      assertEquals("the page's end leaves the group to the host and its link", 0, downs.get())
      // A second phone is refused, as on any Wi-Fi Direct host.
      Socket(loopback, server.localPort).use { eventually("a second phone refused") { refused.get() == 1 } }
      link.close()
      eventually("the group goes once the link has ended and taken its host down") { downs.get() == 1 }
      assertTrue(server.isClosed)
      assertTrue(g.isDown)
    } finally {
      phone.close()
      hosted.takeDown()
    }
    assertEquals(1, downs.get())
  }

  /** Why: a stop of everything takes down a host still waiting on the group, so its listener does not outlive it. */
  @Test fun takingTheGroupDownTakesItsHostsDown() {
    val loopback = InetAddress.getLoopbackAddress()
    val downs = AtomicInteger()
    val g = group(downs)
    g.hold()!!
    val server = ServerSocket(0, 2, loopback)
    val hosted = g.host("host-1", server, { socket, _ -> LinkSession("l", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList()) }, { _, _ -> }, {})!!
    hosted.acceptLoop()
    g.takeDown()
    assertTrue(server.isClosed)
    assertEquals(1, downs.get())
    assertNull("no host on a group that has gone", g.host("host-2", ServerSocket(0, 2, loopback).also { it.close() }, { socket, _ -> LinkSession("l", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList()) }, { _, _ -> }, {}))
  }

  /**
   * Why: a group whose interface has gone (Wi-Fi turned off, the framework took it) must end at
   * once with its let-in host, not hold Wi-Fi Direct busy for as long as the code lasts; a look
   * that cannot be answered says nothing.
   */
  @Test fun aGroupWhoseInterfaceHasGoneIsTakenDownWithItsHosts() {
    val loopback = InetAddress.getLoopbackAddress()
    val downs = AtomicInteger()
    val g = group(downs)
    g.hold()!!
    val server = ServerSocket(0, 2, loopback)
    val hosted = g.host("host-1", server, { socket, _ -> LinkSession("l", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList()) }, { _, _ -> }, {})!!
    hosted.acceptLoop()
    assertTrue("still there: look again", g.watch { true })
    assertTrue("a look that throws says nothing", g.watch { throw java.net.SocketException("no answer") })
    assertEquals(0, downs.get())
    assertFalse("gone: no more looks", g.watch { false })
    assertEquals(1, downs.get())
    assertTrue(g.isDown)
    assertTrue("its host went with it", server.isClosed)
    try {
      hosted.nextLink()
      fail("a host on a group that went gives no link")
    } catch (e: NearbyException) {
      assertEquals(NearbyCode.HOST_TAKEN_DOWN, e.code)
    }
    assertFalse("down already: nothing to look at", g.watch { fail("not asked"); true })
    assertEquals(1, downs.get())
  }

  /** A socket from `from`, another loopback address; skipped where the machine has only 127.0.0.1. */
  private fun socketFrom(from: String, to: Int): Socket {
    val socket = Socket()
    try {
      socket.bind(InetSocketAddress(InetAddress.getByName(from), 0))
    } catch (e: IOException) {
      socket.close()
      assumeTrue("no loopback address $from here", false)
    }
    socket.connect(InetSocketAddress(InetAddress.getLoopbackAddress(), to), 5_000)
    socket.soTimeout = 5_000
    return socket
  }

  /**
   * Why: Linux takes packets for the group's address that arrive on any interface, so a device on
   * another network the carrier is on could take the one link; it is closed unanswered instead,
   * reported as nothing, and the phone on the group still gets the link.
   */
  @Test fun aHostOnTheGroupAnswersOnlyThePhonesOnTheGroupsNetwork() {
    val loopback = InetAddress.getLoopbackAddress()
    val downs = AtomicInteger()
    val refused = AtomicInteger()
    val g = group(downs, peers = Subnet(loopback, 32))
    g.hold()!!
    val server = ServerSocket(0, 4, loopback)
    val hosted = g.host("host-1", server, { socket, _ -> LinkSession("l", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList()) }, { _, _ -> }, { refused.incrementAndGet() })!!
    hosted.acceptLoop()
    try {
      socketFrom("127.0.0.2", server.localPort).use { outsider ->
        val closed = try { outsider.getInputStream().read() == -1 } catch (e: java.net.SocketException) { true }
        assertTrue("closed unanswered", closed)
      }
      assertEquals(0, refused.get())
      assertEquals("an outsider takes no hold", 2, g.held)
      Socket(loopback, server.localPort).use {
        val link = hosted.nextLink()
        assertEquals("the phone on the group is the link", 3, g.held)
        link.close()
      }
    } finally {
      hosted.takeDown()
    }
  }

  /** Why: a connection that could not be made a link must let go of the hold it took, and the host must keep taking connections. */
  @Test fun aLinkThatCannotBeMadeLetsGoOfItsHoldAndTheNextConnectionIsTaken() {
    val loopback = InetAddress.getLoopbackAddress()
    val downs = AtomicInteger()
    val g = group(downs)
    g.hold()!!
    val tries = AtomicInteger()
    val server = ServerSocket(0, 4, loopback)
    val hosted = g.host("host-1", server, { socket, _ ->
      if (tries.incrementAndGet() == 1) throw IllegalStateException("no link this time")
      LinkSession("l", "wifi-direct", SocketTransport(socket), LinkTunables(), emptyList())
    }, { _, _ -> }, {})!!
    hosted.acceptLoop()
    try {
      Socket(loopback, server.localPort).use { first ->
        first.soTimeout = 5_000
        val closed = try { first.getInputStream().read() == -1 } catch (e: java.net.SocketException) { true }
        assertTrue("the failed one is closed", closed)
      }
      eventually("the failed link let go of its hold") { g.held == 2 }
      Socket(loopback, server.localPort).use {
        val link = hosted.nextLink()
        assertEquals(2, tries.get())
        assertEquals(3, g.held)
        link.close()
      }
    } finally {
      hosted.takeDown()
    }
  }
}
