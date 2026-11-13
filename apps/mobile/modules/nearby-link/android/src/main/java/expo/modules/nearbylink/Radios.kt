package expo.modules.nearbylink

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import androidx.annotation.ChecksSdkIntAtLeast

/**
 * What this phone's radios can do and whether the app may use them (docs/nearby-sync-plan.md
 * 5.8, 9). Reading these needs no runtime permission and starts no radio. Below Android 10 the
 * module does nothing: `WifiP2pConfig.Builder` is API 29, so the screen shows a disabled row.
 */
// Reads state only; JavaScript asks for the runtime permissions before any radio starts (nearbyPermissionsModel.ts).
@SuppressLint("MissingPermission")
object Radios {
  /** The first Android the link runs on. */
  const val MIN_SDK = Build.VERSION_CODES.Q

  @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.Q)
  fun supported(): Boolean = Build.VERSION.SDK_INT >= MIN_SDK

  fun adapter(context: Context): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  fun wifi(context: Context): WifiManager? =
    context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

  /** The permissions Find, the pipe and the Wi-Fi links need on this Android, as the manifest declares them by API level. */
  fun needed(): List<String> = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> listOf(
      Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT,
      Manifest.permission.NEARBY_WIFI_DEVICES,
    )
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> listOf(
      Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT,
      Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    else -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
  }

  fun granted(context: Context): Boolean = needed().all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

  /** Throws the code JavaScript shows a line for: not here, not allowed, or a radio switched off. */
  fun require(context: Context, wifi: Boolean = false, bluetooth: Boolean = true) {
    if (!supported()) throw NearbyException(NearbyCode.NOT_AVAILABLE, "nearby sync needs Android 10 or later")
    if (!granted(context)) throw NearbyException(NearbyCode.NO_PERMISSION, "a nearby permission is not granted")
    if (bluetooth && adapter(context)?.isEnabled != true) throw NearbyException(NearbyCode.BLUETOOTH_OFF, "Bluetooth is off")
    if (wifi && wifi(context)?.isWifiEnabled != true) throw NearbyException(NearbyCode.WIFI_OFF, "Wi-Fi is off")
  }

  fun capabilities(context: Context): Map<String, Any?> {
    val pm = context.packageManager
    val adapter = adapter(context)
    val wifi = wifi(context)
    val le = pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) && adapter != null
    val direct = pm.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT)
    val location = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    val ok = supported()
    return mapOf(
      "sdk" to Build.VERSION.SDK_INT,
      "bluetoothLe" to le,
      "advertise" to (ok && le && adapter?.isMultipleAdvertisementSupported == true),
      "directByName" to (ok && direct),
      "band5" to (wifi?.is5GHzBandSupported == true),
      "hotspot" to (ok && wifi != null),
      "joinHotspot" to (ok && wifi != null),
      "bluetoothOn" to (adapter?.isEnabled == true),
      "wifiOn" to (wifi?.isWifiEnabled == true),
      "locationOn" to (location?.let { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.isLocationEnabled else true } ?: false),
      "granted" to (ok && granted(context)),
    )
  }
}
