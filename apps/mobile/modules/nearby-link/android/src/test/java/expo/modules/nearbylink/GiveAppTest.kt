package expo.modules.nearbylink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom

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
}
