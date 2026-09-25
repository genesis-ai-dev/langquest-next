package expo.modules.privacyicon

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PrivacyIconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PrivacyIcon")
    Function("isSupported") { true }
    AsyncFunction("setDisguised") { enabled: Boolean ->
      val context = appContext.reactContext ?: error("Application context unavailable")
      val manager = context.packageManager
      val normal = ComponentName(context.packageName, context.packageName + ".DefaultLauncher")
      val notes = ComponentName(context.packageName, context.packageName + ".NotesLauncher")
      // Enable the destination first so the app never loses every launcher.
      manager.setComponentEnabledSetting(if (enabled) notes else normal,
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      manager.setComponentEnabledSetting(if (enabled) normal else notes,
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
  }
}
