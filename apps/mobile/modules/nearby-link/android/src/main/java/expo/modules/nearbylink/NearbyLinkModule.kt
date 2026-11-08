package expo.modules.nearbylink

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

/**
 * Nearby sync's link on Android (docs/nearby-sync-plan.md 4, 5.9, 5.12): Bluetooth LE to find
 * teammates, a GATT pipe for the short exchange, a Wi-Fi Direct group or the local-only hotspot to
 * move work, and sockets with native framing and AES-GCM. Mechanism only: every tunable is an
 * argument from JavaScript, and JavaScript decides who to trust. It does nothing at construction,
 * holds no radio until asked, and names no API 29 class in its fields. Every call that can wait
 * runs on a background thread. Native never sees a key but `kFind` and a link's two frame keys,
 * and never logs them; rejections carry a `NearbyCode` and no key, salt or address.
 *
 * `src/NearbyLinkModule.ts` is its JavaScript face, read through `requireOptionalNativeModule`, so
 * a build without it (the web, an iPhone, a development client made before it) has none and
 * never crashes. apps/mobile/test/nearbyNative.test.ts holds the two lists of functions equal.
 */
class NearbyLinkModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newCachedThreadPool(ThreadFactory { r -> Thread(r, "nearby-link").apply { isDaemon = true } })
  @Volatile private var linkTune = LinkTunables()
  /** `RadioKit`, made on Android 10 and later at the first call that needs it; typed loosely so API 24 never loads it. */
  @Volatile private var kitHeld: Any? = null

  private val context: Context
    get() = appContext.reactContext ?: throw NearbyException(NearbyCode.INTERNAL, "no React context")

  /** The app's own folders: the only places a file is sent from or received into. */
  private fun roots(): List<File> {
    val c = context
    return listOfNotNull(c.filesDir, c.cacheDir, c.noBackupFilesDir)
  }

  private val events = object : RadioEvents {
    override fun found(seen: Map<String, Any?>) = emit("onFound", seen)
    override fun formSalt(salt: String, rssi: Int) = emit("onFormSalt", mapOf("salt" to salt, "rssi" to rssi))
    override fun salt(salt: String) = emit("onSalt", mapOf("salt" to salt))
    override fun pipe(linkId: String, salt: String) = emit("onPipe", mapOf("linkId" to linkId, "salt" to salt))
    override fun refused(hostId: String) = emit("onRefused", mapOf("hostId" to hostId))
    override fun linkDown(linkId: String, code: NearbyCode) = emit("onLinkDown", mapOf("linkId" to linkId, "code" to code.name))
    override fun findError(code: NearbyCode) = emit("onFindError", mapOf("code" to code.name))
  }

  private val registry = LinkRegistry({ roots() }, { linkTune }, events)

  private fun emit(name: String, body: Map<String, Any?>) {
    main.post { sendEvent(name, body) }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun kit(): RadioKit {
    synchronized(this) {
      (kitHeld as? RadioKit)?.let { return it }
      return RadioKit(context, registry, { linkTune }, events).also { kitHeld = it }
    }
  }

  /** Runs on a background thread and settles the promise with the answer or the error's code. */
  private fun run(promise: Promise, body: () -> Any?) {
    io.execute {
      try {
        promise.resolve(body())
      } catch (e: NearbyException) {
        promise.reject(e.code.name, e.message, null)
      } catch (e: Exception) {
        promise.reject(NearbyCode.INTERNAL.name, "the nearby module failed", null)
      }
    }
  }

  /** The radios, or `NOT_AVAILABLE` below Android 10. */
  private fun radio(promise: Promise, body: (RadioKit) -> Any?) {
    run(promise) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) body(kit()) else throw NearbyException(NearbyCode.NOT_AVAILABLE, "nearby sync needs Android 10 or later")
    }
  }

  private fun fileOf(uri: String): File = try {
    if (uri.startsWith("file:")) File(URI(uri)) else File(uri)
  } catch (e: IllegalArgumentException) {
    throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a file URI")
  }

  private fun stopAll(backgrounded: Boolean = false) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val kit = kitHeld as? RadioKit
      // The hotspot's join dialog takes the app to the background; JavaScript ignores that one pause (5.8).
      if (backgrounded && kit != null && kit.joiningHotspot > 0) return
      kit?.stopAll()
    }
    registry.closeAll()
  }

  override fun definition() = ModuleDefinition {
    Name("NearbyLink")
    Events("onFound", "onFormSalt", "onSalt", "onPipe", "onRefused", "onLinkDown", "onFindError")

    // So a JavaScript thread that hung, or an app that went, cannot leave the radios on.
    OnDestroy {
      stopAll()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) (kitHeld as? RadioKit)?.quit()
      kitHeld = null
      io.shutdownNow()
    }
    OnActivityEntersBackground { io.execute { stopAll(backgrounded = true) } }

    AsyncFunction("capabilities") { promise: Promise -> run(promise) { Radios.capabilities(context) } }

    AsyncFunction("configureLinks") { tunables: Map<String, Any?>, promise: Promise ->
      run(promise) { linkTune = FindTunables.links(tunables); null }
    }

    // `scanKeys` is every key's 32 bytes end to end, newest first.
    AsyncFunction("startFind") { kFind: ByteArray, scanKeys: ByteArray, payload: ByteArray, r: ByteArray, tunables: Map<String, Any?>, promise: Promise ->
      radio(promise) { kit ->
        if (scanKeys.isEmpty() || scanKeys.size % 32 != 0) throw NearbyException(NearbyCode.BAD_ARGUMENT, "scan keys are 32 bytes each")
        val keys = (0 until scanKeys.size / 32).map { scanKeys.copyOfRange(it * 32, it * 32 + 32) }
        try {
          kit.startFind(kFind, keys, payload, r, FindTunables.of(tunables))
        } finally {
          keys.forEach { it.fill(0) }
          kFind.fill(0)
          scanKeys.fill(0)
        }
        null
      }
    }
    AsyncFunction("updateFind") { payload: ByteArray, r: ByteArray, promise: Promise -> radio(promise) { it.updateFind(payload, r); null } }
    AsyncFunction("stopFind") { promise: Promise -> radio(promise) { it.stopFind(); null } }
    AsyncFunction("holdScan") { held: Boolean, promise: Promise -> radio(promise) { it.holdScan(held); null } }
    AsyncFunction("holdSalt") { held: Boolean, promise: Promise -> radio(promise) { it.holdSalt(held); null } }

    AsyncFunction("openPipe") { peer: String, salt: String, scan: Int, promise: Promise -> radio(promise) { it.openPipe(peer, salt, scan).id } }

    AsyncFunction("host") { kind: String, options: Map<String, Any?>, deadlineMs: Double, promise: Promise ->
      radio(promise) { kit ->
        val hosted = kit.host(kind, options, deadlineMs.toLong())
        hosted.details + ("hostId" to hosted.id)
      }
    }
    AsyncFunction("hostLink") { hostId: String, promise: Promise -> radio(promise) { it.hostLink(hostId).id } }
    AsyncFunction("takeDown") { hostId: String, promise: Promise -> radio(promise) { it.takeDown(hostId); null } }
    AsyncFunction("join") { kind: String, details: Map<String, Any?>, deadlineMs: Double, promise: Promise ->
      radio(promise) { it.join(kind, details, deadlineMs.toLong()).id }
    }

    AsyncFunction("sendOpening") { linkId: String, bytes: ByteArray, promise: Promise -> run(promise) { registry.get(linkId).sendOpening(bytes); null } }
    AsyncFunction("receiveOpening") { linkId: String, size: Int, deadlineMs: Double, promise: Promise ->
      run(promise) { registry.get(linkId).receiveOpening(size, deadlineMs.toLong()) }
    }
    AsyncFunction("secure") { linkId: String, sendKey: ByteArray, receiveKey: ByteArray, promise: Promise ->
      run(promise) {
        try {
          registry.get(linkId).secure(sendKey, receiveKey)
        } finally {
          sendKey.fill(0)
          receiveKey.fill(0)
        }
        null
      }
    }
    AsyncFunction("send") { linkId: String, bytes: ByteArray, promise: Promise -> run(promise) { registry.get(linkId).send(bytes); null } }
    AsyncFunction("receive") { linkId: String, promise: Promise -> run(promise) { registry.get(linkId).receive() } }
    AsyncFunction("sendFile") { linkId: String, transferId: String, uri: String, size: Double, promise: Promise ->
      run(promise) { registry.get(linkId).sendFile(transferId, fileOf(uri), size.toLong()); null }
    }
    AsyncFunction("receiveFile") { linkId: String, transferId: String, stagingUri: String, maxBytes: Double, minFreeBytes: Double, promise: Promise ->
      run(promise) {
        val r = registry.get(linkId).receiveFile(transferId, fileOf(stagingUri), maxBytes.toLong(), minFreeBytes.toLong())
        mapOf("size" to r.size.toDouble(), "sha256" to r.sha256)
      }
    }
    AsyncFunction("cancelFile") { linkId: String, transferId: String, promise: Promise ->
      run(promise) {
        try { registry.get(linkId).cancelFile(transferId) } catch (_: NearbyException) {}
        null
      }
    }
    AsyncFunction("closeLink") { linkId: String, promise: Promise ->
      run(promise) {
        try { registry.get(linkId).close() } catch (_: NearbyException) {}
        null
      }
    }
    AsyncFunction("stopAll") { promise: Promise -> run(promise) { stopAll(); null } }
  }
}
