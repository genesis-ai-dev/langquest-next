package expo.modules.nearbylink

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Give the app's share sheet as far as it needs no phone: the provider the manifest declares and the intent's flags (docs/nearby-sync-plan.md 14.5). */
class InstallFileShareTest {
  private val android = File(File(System.getProperty("nearby.vectors") ?: "../test-vectors.json").absoluteFile.parentFile, "android")
  private fun withoutComments(xml: String) = xml.replace(Regex("<!--[\\s\\S]*?-->"), "")
  private val manifest = withoutComments(File(android, "src/main/AndroidManifest.xml").readText())
  private val provider = Regex("<provider\\b([\\s\\S]*?)</provider>").findAll(manifest).map { it.groupValues[1] }.toList()

  private fun attribute(element: String, name: String): String? = Regex("android:$name=\"([^\"]*)\"").find(element)?.groupValues?.get(1)

  /** Why: `getUriForFile` finds the provider by the authority the Kotlin asks for; one that differs fails every share. */
  @Test fun theManifestDeclaresTheModulesOwnProviderUnderTheAuthorityTheKotlinAsksFor() {
    assertEquals(1, provider.size)
    val p = provider.single()
    assertEquals(InstallFileProvider::class.java.name, attribute(p, "name"))
    assertEquals(InstallFileShare.authority("\${applicationId}"), attribute(p, "authorities"))
    assertEquals("com.example.app.nearbylink.installfile", InstallFileShare.authority("com.example.app"))
  }

  /** Why: only the app the person picks may read the file, through the grant the sheet hands on. */
  @Test fun theProviderIsNotExportedAndGrantsOnlyWhatItIsAsked() {
    val p = provider.single()
    assertEquals("false", attribute(p, "exported"))
    assertEquals("true", attribute(p, "grantUriPermissions"))
    assertEquals("@xml/nearby_link_install_file", Regex("android:name=\"android\\.support\\.FILE_PROVIDER_PATHS\"\\s+android:resource=\"([^\"]+)\"").find(p)?.groupValues?.get(1))
  }

  /** Why: the provider can reach only what its paths name; the app's files folder holds people's work. */
  @Test fun thePathsNameOnlyTheKeptInstallFilesFolder() {
    val paths = withoutComments(File(android, "src/main/res/xml/nearby_link_install_file.xml").readText())
    val roots = Regex("<([a-z-]+-path)\\b([^>]*)/>").findAll(paths).map { it.groupValues[1] to Regex("\\bpath=\"([^\"]*)\"").find(it.groupValues[2])?.groupValues?.get(1) }.toList()
    assertEquals(listOf("files-path" to "${InstallFiles.FOLDER}/"), roots)
    // Nothing but that one element: a root written another way would be missed above.
    assertEquals(1, Regex("<[a-z-]+-path\\b").findAll(paths).count())
  }

  /** Why: a read grant on the one file and no more, and a chooser that can start without an activity behind it. */
  @Test fun theShareGrantsReadAloneAndStartsATaskOnlyWithoutAnActivity() {
    assertEquals("application/vnd.android.package-archive", InstallFileShare.MIME_TYPE)
    assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, InstallFileShare.SEND_FLAGS)
    assertEquals(0, InstallFileShare.SEND_FLAGS and (Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION))
    assertEquals(0, InstallFileShare.chooserFlags(fromActivity = true))
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, InstallFileShare.chooserFlags(fromActivity = false))
  }
}
