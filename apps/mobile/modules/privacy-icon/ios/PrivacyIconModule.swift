import ExpoModulesCore
import UIKit

public class PrivacyIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrivacyIcon")
    Function("isSupported") { true }
    AsyncFunction("setDisguised") { (enabled: Bool, promise: Promise) in
      guard UIApplication.shared.supportsAlternateIcons else {
        promise.reject("UNSUPPORTED", "Alternate icons are unavailable on this device.")
        return
      }
      UIApplication.shared.setAlternateIconName(enabled ? "NotesIcon" : nil) { error in
        if let error { promise.reject("ICON_CHANGE_FAILED", error.localizedDescription) }
        else { promise.resolve(nil) }
      }
    }.runOnQueue(.main)
  }
}
