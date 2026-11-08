package expo.modules.nearbylink

import android.annotation.SuppressLint
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.ParcelUuid
import android.os.SystemClock
import androidx.annotation.RequiresApi
import java.security.SecureRandom

/**
 * Find (docs/nearby-sync-plan.md 5.5, 5.12): a legacy advert holding one service UUID worked out
 * from `kFind` and a rotating salt, a scan response holding the masked tag, summary and echo, and
 * a scan for every key in `scanKeys`, matched here so that only teammates and the salts of
 * adverts of this form go up. No name, no transmit power, no manufacturer or service data, and no
 * fixed UUID anywhere. Rotation stops the set, swaps the GATT service and starts a new set with a
 * new salt, on a jittered period from JavaScript, and waits while a pipe that passed its opening
 * holds the salt. Every call runs on `handler`'s thread. `kFind` and the scan keys live here only
 * while Find runs and are never logged.
 */
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission")
class BleFind(
  private val context: Context,
  private val handler: Handler,
  private val pipes: GattServerPipes,
  private val events: Events,
) {
  interface Events {
    fun found(seen: Map<String, Any?>)
    fun formSalt(salt: String, rssi: Int)
    fun salt(salt: String)
    fun failed(code: NearbyCode)
  }

  private val random = SecureRandom()
  private var kFind: ByteArray? = null
  private var matcher: FindMatcher? = null
  private var tune: FindTunables? = null
  private var payload = ByteArray(FindCodec.PAYLOAD_BYTES)
  private var r = ByteArray(FindCodec.R_BYTES)
  private var salt: ByteArray? = null
  /** Every `r` sent under the current salt: a mask is never used twice. */
  private val usedR = HashSet<String>()
  private var set: AdvertisingSet? = null
  private var setCallback: AdvertisingSetCallback? = null
  private var advertising = false
  private var connectable = true
  private var lastFlip = 0L
  private var saltHeld = false
  private var rotationDue = false
  private var rotating = false
  private var scanHeld = false
  private var scanning = false
  private var lastScanStart = 0L
  private val heardResponses = HashMap<String, String>()
  private val formSaltsAt = HashMap<String, Long>()

  private val rotate = Runnable { rotateNow() }
  private val restartScan = Runnable { restartScanNow() }
  private val startScanLater = Runnable { startScan() }
  private val notConnectable = Runnable { setConnectable(false) }

  private val scanCallback = object : ScanCallback() {
    // Results come on the main thread; everything here runs on the handler's.
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      handler.post { heard(result) }
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>) {
      handler.post { results.forEach { heard(it) } }
    }

    override fun onScanFailed(errorCode: Int) {
      handler.post {
        scanning = false
        events.failed(NearbyCode.SCAN_FAILED)
      }
    }
  }

  val isRunning: Boolean get() = kFind != null

  /** Advertises under `kFind` when this phone can, and scans for every key in `scanKeys`, newest first. */
  fun start(kFind: ByteArray, scanKeys: List<ByteArray>, payload: ByteArray, r: ByteArray, tune: FindTunables, done: (NearbyException?) -> Unit) {
    stop()
    if (payload.size != FindCodec.PAYLOAD_BYTES || r.size != FindCodec.R_BYTES || kFind.size != 32 || scanKeys.isEmpty() || scanKeys.any { it.size != 32 }) {
      return done(NearbyException(NearbyCode.BAD_ARGUMENT, "Find's keys or payload"))
    }
    this.kFind = kFind.copyOf()
    this.matcher = FindMatcher(scanKeys)
    this.tune = tune
    this.payload = payload.copyOf()
    this.r = r.copyOf()
    connectable = tune.afterHearing == null
    startScan()
    handler.removeCallbacks(restartScan)
    if (tune.scanRestartMs > 0) handler.postDelayed(restartScan, tune.scanRestartMs)
    val adapter = Radios.adapter(context)
    if (adapter?.isMultipleAdvertisementSupported != true || adapter.bluetoothLeAdvertiser == null) {
      // A phone that cannot advertise still scans and connects (5.12, "The echo").
      return done(null)
    }
    startSet(newSalt()) { ok -> done(if (ok) null else NearbyException(NearbyCode.ADVERTISE_FAILED, "advertising did not start")) }
  }

  /** A new scan response under a new mask, never a new salt. An `r` already used under this salt is skipped. */
  fun update(payload: ByteArray, r: ByteArray) {
    if (kFind == null) throw NearbyException(NearbyCode.FIND_NOT_RUNNING, "Find is not running")
    if (payload.size != FindCodec.PAYLOAD_BYTES || r.size != FindCodec.R_BYTES) throw NearbyException(NearbyCode.BAD_ARGUMENT, "a payload is 14 bytes and r 2")
    this.payload = payload.copyOf()
    if (salt != null && !usedR.add(Bytes.hex(r))) return
    this.r = r.copyOf()
    val s = salt ?: return
    if (rotating) return
    set?.setScanResponseData(responseData(s))
  }

  /** While held, rotation waits; once released, a rotation that came due runs at once. */
  fun holdSalt(held: Boolean) {
    saltHeld = held
    if (!held && rotationDue) rotateNow()
  }

  /** While held, the scan stops and advertising carries on (5.12: a session notices nobody new). */
  fun holdScan(held: Boolean) {
    scanHeld = held
    if (held) stopScan() else startScan()
  }

  fun stop() {
    handler.removeCallbacks(rotate)
    handler.removeCallbacks(restartScan)
    handler.removeCallbacks(startScanLater)
    handler.removeCallbacks(notConnectable)
    stopScan()
    stopSet()
    pipes.unserve()
    matcher?.clear()
    matcher = null
    kFind?.fill(0)
    kFind = null
    salt = null
    usedR.clear()
    heardResponses.clear()
    formSaltsAt.clear()
    saltHeld = false
    rotationDue = false
    rotating = false
    scanHeld = false
  }

  /** The key a pipe to a phone heard under `scanKeys[scan]` is opened with. */
  fun keyAt(scan: Int): ByteArray? = matcher?.keyAt(scan)?.copyOf()

  // ---- advertising ---------------------------------------------------------------

  private fun newSalt(): ByteArray = ByteArray(FindCodec.SALT_BYTES).also { random.nextBytes(it) }

  private fun responseData(s: ByteArray): AdvertiseData =
    AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .addServiceUuid(ParcelUuid(FindCodec.uuidOf(FindCodec.scanResponse(kFind!!, s, r, payload))))
      .build()

  private fun parameters(): AdvertisingSetParameters {
    val b = AdvertisingSetParameters.Builder()
      .setLegacyMode(true)
      .setConnectable(connectable)
      .setScannable(true)
      .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM)
      .setInterval(
        when (tune?.advertiseInterval) {
          "high" -> AdvertisingSetParameters.INTERVAL_HIGH
          "medium" -> AdvertisingSetParameters.INTERVAL_MEDIUM
          else -> AdvertisingSetParameters.INTERVAL_LOW
        },
      )
    // Should stop unencrypted reads of the phone's name (0x2A00) where the controller has extended advertising (5.12).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) b.setDiscoverable(false)
    return b.build()
  }

  private fun startSet(newSalt: ByteArray, done: (Boolean) -> Unit) {
    val key = kFind ?: return done(false)
    val advertiser = Radios.adapter(context)?.bluetoothLeAdvertiser ?: return done(false)
    rotating = true
    pipes.serve(key, newSalt) { served ->
      handler.post {
        if (kFind == null) return@post done(false)
        if (!served) {
          rotating = false
          return@post done(false)
        }
        salt = newSalt
        usedR.clear()
        usedR.add(Bytes.hex(r))
        val data = AdvertiseData.Builder()
          .setIncludeDeviceName(false)
          .setIncludeTxPowerLevel(false)
          .addServiceUuid(ParcelUuid(FindCodec.uuidOf(FindCodec.advertId(key, newSalt))))
          .build()
        val callback = object : AdvertisingSetCallback() {
          override fun onAdvertisingSetStarted(started: AdvertisingSet?, txPower: Int, status: Int) {
            handler.post {
              rotating = false
              if (status != ADVERTISE_SUCCESS || started == null || kFind == null) {
                advertising = false
                events.failed(NearbyCode.ADVERTISE_FAILED)
                return@post done(false)
              }
              set = started
              advertising = true
              events.salt(Bytes.b64url(newSalt))
              scheduleRotation()
              done(true)
            }
          }

          override fun onAdvertisingSetStopped(stopped: AdvertisingSet?) {
            handler.post { afterStop?.invoke().also { afterStop = null } }
          }

          override fun onAdvertisingParametersUpdated(updated: AdvertisingSet?, txPower: Int, status: Int) {
            handler.post { set?.enableAdvertising(true, 0, 0) }
          }
        }
        setCallback = callback
        try {
          advertiser.startAdvertisingSet(parameters(), data, responseData(newSalt), null, null, callback)
        } catch (e: IllegalArgumentException) {
          rotating = false
          events.failed(NearbyCode.ADVERTISE_FAILED)
          done(false)
        }
      }
    }
  }

  private var afterStop: (() -> Unit)? = null

  private fun stopSet(then: (() -> Unit)? = null) {
    val callback = setCallback
    setCallback = null
    set = null
    advertising = false
    if (callback == null) {
      then?.invoke()
      return
    }
    afterStop = then
    try {
      Radios.adapter(context)?.bluetoothLeAdvertiser?.stopAdvertisingSet(callback)
    } catch (_: Exception) {
      afterStop = null
      then?.invoke()
    }
  }

  private fun scheduleRotation() {
    val t = tune ?: return
    handler.removeCallbacks(rotate)
    handler.postDelayed(rotate, t.rotationMs(random.nextDouble()))
  }

  /** The salt and the Bluetooth address change together: stop, wait for the stop, then a new set. */
  private fun rotateNow() {
    if (kFind == null || rotating) return
    if (saltHeld) {
      rotationDue = true
      return
    }
    rotationDue = false
    if (setCallback == null) return
    rotating = true
    stopSet {
      rotating = false
      if (kFind != null) startSet(newSalt()) { ok -> if (!ok) events.failed(NearbyCode.ADVERTISE_FAILED) }
    }
  }

  /** `'after-hearing'`: connectable for a while after a teammate is heard, keeping the salt. */
  private fun setConnectable(on: Boolean) {
    val s = set ?: return
    if (connectable == on) return
    connectable = on
    lastFlip = SystemClock.elapsedRealtime()
    s.enableAdvertising(false, 0, 0)
    s.setAdvertisingParameters(parameters())
  }

  // ---- scanning ------------------------------------------------------------------

  private fun startScan() {
    val t = tune ?: return
    if (scanning || scanHeld || kFind == null) return
    // Android allows about five scan starts in 30 seconds and past that fails without a word.
    val wait = lastScanStart + t.scanStartGapMs - SystemClock.elapsedRealtime()
    if (wait > 0) {
      handler.removeCallbacks(startScanLater)
      handler.postDelayed(startScanLater, wait)
      return
    }
    val scanner = Radios.adapter(context)?.bluetoothLeScanner ?: return events.failed(NearbyCode.SCAN_FAILED)
    val settings = ScanSettings.Builder()
      .setScanMode(
        when (t.scanMode) {
          "balanced" -> ScanSettings.SCAN_MODE_BALANCED
          "low-power" -> ScanSettings.SCAN_MODE_LOW_POWER
          else -> ScanSettings.SCAN_MODE_LOW_LATENCY
        },
      )
      .setReportDelay(0)
      .build()
    val filters = if (t.emptyScanFilter) listOf(ScanFilter.Builder().build()) else null
    try {
      scanner.startScan(filters, settings, scanCallback)
      scanning = true
      lastScanStart = SystemClock.elapsedRealtime()
    } catch (e: Exception) {
      events.failed(NearbyCode.SCAN_FAILED)
    }
  }

  private fun stopScan() {
    handler.removeCallbacks(startScanLater)
    if (!scanning) return
    scanning = false
    try { Radios.adapter(context)?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
  }

  /** A scan left running for 30 minutes is downgraded, so it is restarted first. */
  private fun restartScanNow() {
    val t = tune ?: return
    if (scanning) {
      stopScan()
      startScan()
    }
    handler.postDelayed(restartScan, t.scanRestartMs)
  }

  private fun heard(result: ScanResult) {
    val m = matcher ?: return
    val record = result.scanRecord ?: return
    val uuids = record.serviceUuids?.map { FindCodec.bytesOf(it.uuid) } ?: return
    val other = record.deviceName != null ||
      (record.manufacturerSpecificData?.size() ?: 0) > 0 ||
      !record.serviceData.isNullOrEmpty() ||
      !record.serviceSolicitationUuids.isNullOrEmpty()
    when (val h = m.hear(uuids, other)) {
      is Heard.Match -> {
        val peer = result.device.address
        val saltText = Bytes.b64url(h.salt)
        val rText = Bytes.b64url(h.response.r)
        // The same response heard again tells JavaScript nothing; a new one comes at each tick.
        if (heardResponses[peer] == "$saltText:$rText") return
        if (heardResponses.size > 512) heardResponses.clear()
        heardResponses[peer] = "$saltText:$rText"
        events.found(
          mapOf(
            "peer" to peer,
            "salt" to saltText,
            "r" to rText,
            "tag" to Bytes.hex(h.response.tag),
            "summary" to Bytes.hex(h.response.summary),
            "echo" to Bytes.b64url(h.response.echo),
            "connectable" to result.isConnectable,
            "rssi" to result.rssi,
            "scan" to h.scan,
          ),
        )
        heardTeammate()
      }
      is Heard.FormSalt -> {
        val saltText = Bytes.b64url(h.salt)
        val now = SystemClock.elapsedRealtime()
        val at = formSaltsAt[saltText]
        if (at != null && now - at < (tune?.formSaltRepeatMs ?: 5_000)) return
        if (formSaltsAt.size > 512) formSaltsAt.clear()
        formSaltsAt[saltText] = now
        events.formSalt(saltText, result.rssi)
      }
      null -> {}
    }
  }

  private fun heardTeammate() {
    val after = tune?.afterHearing ?: return
    if (!advertising) return
    if (!connectable && SystemClock.elapsedRealtime() - lastFlip >= after.listenMs) setConnectable(true)
    handler.removeCallbacks(notConnectable)
    handler.postDelayed(notConnectable, after.connectableMs)
  }
}
