package expo.modules.nearbylink

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** The standard Client Characteristic Configuration descriptor, which every notifying characteristic carries. */
private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

/** How long one GATT value may wait for its acknowledgement before the pipe counts as gone. */
private const val ACK_MS = 10_000L

/** A pipe's stream for a `LinkSession`: bytes in from a `ByteQueue`, out as acknowledged GATT values. */
class PipeTransport(
  private val queue: ByteQueue,
  mtu: () -> Int,
  send: (ByteArray) -> Unit,
  private val onClose: () -> Unit,
) : Transport {
  override val input: InputStream = queue.inputStream()
  override val output: OutputStream = ChunkedOutputStream(mtu, send)
  override fun setReadTimeout(ms: Int) { queue.timeoutMs = ms }
  override fun close() {
    queue.end()
    onClose()
  }
}

/**
 * The advertiser's side of a pipe (docs/nearby-sync-plan.md 5.12): one GATT service whose UUIDs
 * are worked out from `kFind` and the current salt, swapped at each rotation, so a stranger who
 * lists services sees only UUIDs that look random. A client that turns on notifications opens a
 * pipe, which is handed up untrusted: nothing readable goes out until JavaScript has checked its
 * opening. Writes are answered once there is room, which is the pipe's flow control; a
 * notification waits for `onNotificationSent`.
 */
// Older Androids keep a value on the characteristic; the deprecated forms run only below Android 13.
@Suppress("DEPRECATION")
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission")
class GattServerPipes(
  private val context: Context,
  private val tune: () -> LinkTunables,
  /** A client opened a pipe under `salt`. */
  private val opened: (Transport, ByteArray) -> Unit,
) {
  private class End(val device: BluetoothDevice, val queue: ByteQueue, val salt: ByteArray) {
    @Volatile var mtu = 23
    @Volatile var gone = false
    /** A write held back until the reader made room. */
    var heldRequest: Int? = null
  }

  private val lock = ReentrantLock()
  private var server: BluetoothGattServer? = null
  private var service: BluetoothGattService? = null
  private var salt: ByteArray? = null
  private var writeUuid: UUID? = null
  private var notifyUuid: UUID? = null
  private val ends = PipeEnds<End>()
  private var serviceAdded: ((Boolean) -> Unit)? = null
  /** One notification at a time across every client: an older Android keeps the value on the characteristic. */
  private val notifyLock = ReentrantLock()
  private val sent = notifyLock.newCondition()
  private var notifyWaiting: String? = null
  private var notifyStatus: Int? = null

  private val callback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      val done = lock.withLock { serviceAdded.also { serviceAdded = null } }
      done?.invoke(status == BluetoothGatt.GATT_SUCCESS)
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) dropAt(device.address)
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      lock.withLock { ends[device.address]?.mtu = mtu }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean,
      responseNeeded: Boolean, offset: Int, value: ByteArray?,
    ) {
      val ours = descriptor.uuid == CCCD && descriptor.characteristic?.uuid == notifyUuid
      val on = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      if (responseNeeded) server?.sendResponse(device, requestId, if (ours) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE, 0, null)
      if (!ours) return
      if (!on) return dropAt(device.address)
      val end = lock.withLock {
        val current = salt ?: return
        if (ends.has(device.address)) return
        val queue = ByteQueue(tune().pipeBytes) { drained(device.address) }
        End(device, queue, current.copyOf()).also { ends.put(device.address, it) }
      }
      opened(PipeTransport(end.queue, { end.mtu }, { notify(end, it) }, { disconnect(end) }), end.salt)
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean,
      responseNeeded: Boolean, offset: Int, value: ByteArray?,
    ) {
      val end = lock.withLock { ends[device.address] }
      if (characteristic.uuid != writeUuid || end == null || preparedWrite || offset != 0 || value == null) {
        if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null)
        return
      }
      if (!end.queue.offer(value)) {
        if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null)
        return drop(end)
      }
      if (!responseNeeded) return
      // Past half the pipe's room, the answer waits for the reader, so the client waits too.
      val hold = lock.withLock {
        if (end.queue.size > tune().pipeBytes / 2) {
          end.heldRequest = requestId
          true
        } else false
      }
      if (!hold) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      server?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) {
      server?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      notifyLock.withLock {
        if (notifyWaiting == device.address) {
          notifyStatus = status
          sent.signalAll()
        }
      }
    }
  }

  /** Serves the pipe under a new salt, taking down the last one. `done` says whether it is up. */
  fun serve(kFind: ByteArray, newSalt: ByteArray, done: (Boolean) -> Unit) {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val s = server ?: manager?.openGattServer(context, callback)?.also { server = it }
    if (s == null) return done(false)
    service?.let { s.removeService(it) }
    val svc = BluetoothGattService(FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 0)), BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val write = BluetoothGattCharacteristic(
      FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 1)),
      BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE,
    )
    val notify = BluetoothGattCharacteristic(
      FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 2)),
      BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0,
    )
    notify.addDescriptor(BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    svc.addCharacteristic(write)
    svc.addCharacteristic(notify)
    lock.withLock {
      service = svc
      salt = newSalt.copyOf()
      writeUuid = write.uuid
      notifyUuid = notify.uuid
      serviceAdded = done
    }
    if (!s.addService(svc)) {
      lock.withLock { serviceAdded = null }
      done(false)
    }
  }

  /** Pipes that are open stay; the service and its salt go. */
  fun unserve() {
    lock.withLock {
      service?.let { server?.removeService(it) }
      service = null
      salt = null
      writeUuid = null
      notifyUuid = null
    }
  }

  fun close() {
    val all = lock.withLock { ends.takeAll() }
    for (end in all) {
      end.gone = true
      end.queue.end()
      try { server?.cancelConnection(end.device) } catch (_: Exception) {}
    }
    unserve()
    try { server?.close() } catch (_: Exception) {}
    server = null
  }

  private fun drained(address: String) {
    val held = lock.withLock {
      val end = ends[address] ?: return
      if (end.queue.size > tune().pipeBytes / 2) return
      val id = end.heldRequest ?: return
      end.heldRequest = null
      end to id
    }
    server?.sendResponse(held.first.device, held.second, BluetoothGatt.GATT_SUCCESS, 0, null)
  }

  /** What the system says about a device: whatever pipe it holds now goes. */
  private fun dropAt(address: String) {
    lock.withLock { ends.remove(address) }?.let { finish(it) }
  }

  /** One pipe goes, and leaves a newer pipe of the same device where it is. */
  private fun drop(end: End) {
    lock.withLock { ends.remove(end.device.address, end) }
    finish(end)
  }

  private fun finish(end: End) {
    end.gone = true
    end.queue.end()
    notifyLock.withLock { sent.signalAll() }
  }

  private fun disconnect(end: End) {
    drop(end)
    try { server?.cancelConnection(end.device) } catch (_: Exception) {}
  }

  private fun notify(end: End, value: ByteArray) {
    val s = server ?: throw IOException("no GATT server")
    val characteristic = lock.withLock { service?.getCharacteristic(notifyUuid) } ?: throw IOException("the pipe's service went")
    notifyLock.withLock {
      if (end.gone) throw IOException("the pipe went")
      notifyWaiting = end.device.address
      notifyStatus = null
      val queued = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        s.notifyCharacteristicChanged(end.device, characteristic, false, value) == android.bluetooth.BluetoothStatusCodes.SUCCESS
      } else {
        characteristic.value = value
        s.notifyCharacteristicChanged(end.device, characteristic, false)
      }
      if (!queued) throw IOException("a notification was refused")
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ACK_MS)
      while (notifyStatus == null && !end.gone) {
        val left = deadline - System.nanoTime()
        if (left <= 0) throw IOException("a notification was not acknowledged")
        sent.awaitNanos(left)
      }
      notifyWaiting = null
      if (end.gone || notifyStatus != BluetoothGatt.GATT_SUCCESS) throw IOException("the pipe went")
    }
  }
}

/**
 * The connecting side of a pipe: connect to the phone heard, find the service worked out from the
 * key it matched and its salt, turn on notifications, then write the stream one acknowledged value
 * at a time. A failed attempt (status 133 among them) is tried again `retries` times.
 */
@Suppress("DEPRECATION")
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("MissingPermission")
class GattClientPipe(
  private val context: Context,
  private val address: String,
  private val kFind: ByteArray,
  private val salt: ByteArray,
  private val pipeBytes: Int,
) {
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private var gatt: BluetoothGatt? = null
  private var connected = false
  private var ready = false
  private var failed: NearbyCode? = null
  @Volatile private var mtu = 23
  private var writeChar: BluetoothGattCharacteristic? = null
  private var writeStatus: Int? = null
  private val writeLock = ReentrantLock()
  /** A new one for each attempt, since a failed attempt ends its own. */
  @Volatile private var queue = ByteQueue(pipeBytes)
  private val serviceUuid = FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 0))
  private val writeUuid = FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 1))
  private val notifyUuid = FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 2))

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        lock.withLock { connected = true }
        // Android 14 settles 517 at the first request and ignores later ones.
        if (!g.requestMtu(517)) g.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        fail(if (ready) NearbyCode.LINK_DROPPED else NearbyCode.PIPE_FAILED)
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu
      if (!g.discoverServices()) fail(NearbyCode.PIPE_FAILED)
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val svc = g.getService(serviceUuid)
      val write = svc?.getCharacteristic(writeUuid)
      val notify = svc?.getCharacteristic(notifyUuid)
      val cccd = notify?.getDescriptor(CCCD)
      if (status != BluetoothGatt.GATT_SUCCESS || write == null || notify == null || cccd == null) return fail(NearbyCode.PEER_GONE)
      lock.withLock { writeChar = write }
      if (!g.setCharacteristicNotification(notify, true)) return fail(NearbyCode.PIPE_FAILED)
      val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == android.bluetooth.BluetoothStatusCodes.SUCCESS
      } else {
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        g.writeDescriptor(cccd)
      }
      if (!ok) fail(NearbyCode.PIPE_FAILED)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return fail(NearbyCode.PIPE_FAILED)
      lock.withLock {
        ready = true
        changed.signalAll()
      }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      lock.withLock {
        writeStatus = status
        changed.signalAll()
      }
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      heard(characteristic, value)
    }

    @Deprecated("Android 12L and earlier call this one")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      heard(characteristic, characteristic.value ?: return)
    }
  }

  private fun heard(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
    if (characteristic.uuid != notifyUuid) return
    if (!queue.offer(value)) fail(NearbyCode.LINK_DROPPED)
  }

  private fun fail(code: NearbyCode) {
    lock.withLock {
      if (failed == null) failed = code
      changed.signalAll()
    }
    queue.end()
  }

  /** Connects, tries again after a failure, and gives the pipe's stream once notifications are on. */
  fun open(retries: Int, timeoutMs: Long): Transport {
    val adapter = Radios.adapter(context) ?: throw NearbyException(NearbyCode.BLUETOOTH_OFF, "no Bluetooth")
    val device = try { adapter.getRemoteDevice(address) } catch (e: IllegalArgumentException) {
      throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a Bluetooth address")
    }
    var last: NearbyCode = NearbyCode.PIPE_FAILED
    for (attempt in 0..retries) {
      lock.withLock {
        failed = null
        connected = false
        ready = false
      }
      queue = ByteQueue(pipeBytes)
      val g = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        ?: throw NearbyException(NearbyCode.PIPE_FAILED, "could not start a connection")
      gatt = g
      val outcome = lock.withLock {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (!ready && failed == null) {
          val left = deadline - System.nanoTime()
          if (left <= 0) break
          changed.awaitNanos(left)
        }
        if (ready) null else (failed ?: NearbyCode.PIPE_TIMEOUT)
      }
      if (outcome == null) return PipeTransport(queue, { mtu }, { write(it) }, { close() })
      last = outcome
      try { g.disconnect() } catch (_: Exception) {}
      g.close()
      gatt = null
      // No such service under that salt: the phone rotated or is not a teammate, so trying again cannot help.
      if (outcome == NearbyCode.PEER_GONE) break
    }
    throw NearbyException(last, "the pipe did not open")
  }

  private fun write(value: ByteArray) = writeLock.withLock {
    val g = gatt ?: throw IOException("the pipe went")
    val c = lock.withLock { writeChar } ?: throw IOException("the pipe went")
    lock.withLock { writeStatus = null }
    val queued = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeCharacteristic(c, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == android.bluetooth.BluetoothStatusCodes.SUCCESS
    } else {
      c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      c.value = value
      g.writeCharacteristic(c)
    }
    if (!queued) throw IOException("a write was refused")
    lock.withLock {
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ACK_MS)
      while (writeStatus == null && failed == null) {
        val left = deadline - System.nanoTime()
        if (left <= 0) throw IOException("a write was not acknowledged")
        changed.awaitNanos(left)
      }
      if (writeStatus != BluetoothGatt.GATT_SUCCESS) throw IOException("the pipe went")
    }
  }

  fun close() {
    fail(NearbyCode.LINK_CLOSED)
    val g = gatt ?: return
    gatt = null
    try { g.disconnect() } catch (_: Exception) {}
    try { g.close() } catch (_: Exception) {}
  }
}
