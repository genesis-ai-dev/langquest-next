import CoreBluetooth
import Foundation

/**
 * What an iPhone's radios can do and whether the app may use them (docs/nearby-sync-plan.md 5.8,
 * section 7's phase 5), as `Radios.kt` says it for an Android. Reading these makes no Bluetooth
 * manager, so it never shows the Bluetooth prompt: until `askPermission` or `startFind` made one,
 * Bluetooth reads as on. An app cannot read whether Wi-Fi or Location are on, and needs neither to
 * ask, so both read as on.
 */
enum Radios {
  /** Bluetooth is allowed for this app; reading it asks nothing. */
  static var granted: Bool { CBManager.authorization == .allowedAlways }

  static func capabilities(_ state: CBManagerState?) -> [String: Any] {
    let on: Bool
    if let state {
      on = state != .poweredOff && state != .unsupported
    } else {
      on = true
    }
    return [
      "sdk": ProcessInfo.processInfo.operatingSystemVersion.majorVersion,
      "bluetoothLe": true,
      "advertise": true,
      "directByName": false,
      "band5": true,
      "hotspot": false,
      "joinHotspot": true,
      "bluetoothOn": on,
      "wifiOn": true,
      "locationOn": true,
      "granted": granted,
      "scanResponse": false,
      "awdl": true,
      "joinDirect": true,
    ]
  }
}
