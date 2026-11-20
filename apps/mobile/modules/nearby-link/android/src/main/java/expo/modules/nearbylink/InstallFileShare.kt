package expo.modules.nearbylink

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.util.concurrent.CompletableFuture

/**
 * The module's own FileProvider, for the kept install file alone: its paths
 * (`res/xml/nearby_link_install_file.xml`) name only `files/install-file/`. A subclass, so its
 * manifest entry never merges with another library's `androidx.core.content.FileProvider`. Not
 * exported: an app reads the file only through the grant the share sheet hands on.
 */
class InstallFileProvider : FileProvider()

/**
 * Hands the kept install file to Android's share sheet (docs/nearby-sync-plan.md 14.5), so the
 * carrier can send it with Quick Share or whatever else the phone offers. No radio and no
 * permission: the person picks the app, and that app alone gets a read grant on the one file,
 * under the file's own name, which says the versions and nothing about anyone.
 */
object InstallFileShare {
  /** What Android calls an install file. */
  const val MIME_TYPE = "application/vnd.android.package-archive"

  /** A read grant and nothing else; `Intent.createChooser` carries it, with the clip, to the app picked. */
  const val SEND_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION

  /** The provider's authority, as the manifest writes it: `${applicationId}.nearbylink.installfile`. */
  fun authority(packageName: String): String = "$packageName.nearbylink.installfile"

  /** The chooser's own flags: a task of its own when there is no activity to start it from. */
  fun chooserFlags(fromActivity: Boolean): Int = if (fromActivity) 0 else Intent.FLAG_ACTIVITY_NEW_TASK

  /**
   * Shows the share sheet with `kept`, from `activity` when there is one, and returns once it has
   * been started. What the person picks is not known. Started on the main thread, as any UI is.
   */
  fun open(context: Context, activity: Activity?, kept: KeptFile) {
    val uri = FileProvider.getUriForFile(context, authority(context.packageName), kept.file)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = MIME_TYPE
      putExtra(Intent.EXTRA_STREAM, uri)
      // The clip, not the extra, is what a grant covers; the sheet also reads it for its preview.
      clipData = ClipData.newRawUri(kept.name, uri)
      addFlags(SEND_FLAGS)
    }
    val chooser = Intent.createChooser(send, null).addFlags(chooserFlags(activity != null))
    val started = CompletableFuture<Unit>()
    Handler(Looper.getMainLooper()).post {
      try {
        if (activity != null) activity.startActivity(chooser) else context.startActivity(chooser)
        started.complete(Unit)
      } catch (e: Exception) {
        started.completeExceptionally(e)
      }
    }
    await(started, START_WAIT_MS, NearbyCode.INTERNAL)
  }

  /** Far past how long the main thread takes to start an activity. */
  private const val START_WAIT_MS = 10_000L
}
