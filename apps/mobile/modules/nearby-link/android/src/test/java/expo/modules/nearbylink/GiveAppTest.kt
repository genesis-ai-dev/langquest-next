package expo.modules.nearbylink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Give the app's names and the install file's checks that need no phone (docs/nearby-sync-plan.md 14.5). */
class GiveAppTest {
  private val random = SecureRandom()

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
}
