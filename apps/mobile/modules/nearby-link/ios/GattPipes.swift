import CoreBluetooth
import Foundation

/** How long one GATT value may wait to be taken before the pipe counts as gone. */
private let ackMs: Int64 = 10_000

/**
 * The advertiser's side of a pipe (docs/nearby-sync-plan.md 5.12), as `GattServerPipes` in
 * `GattPipes.kt`: one GATT service whose UUIDs are worked out from `kFind` and the current salt,
 * swapped at each rotation, so a stranger who lists services sees only UUIDs that look random. Core
 * Bluetooth adds the notification descriptor itself, so no fixed UUID is named here. A central that
 * turns on notifications opens a pipe, which is handed up untrusted: nothing readable goes out until
 * JavaScript has checked its opening. A write is answered once there is room, which is the pipe's
 * flow control; a notification the stack's queue cannot take waits for it to be ready again.
 * Core Bluetooth calls in on `radio`; the writers call out from their own threads.
 */
final class GattServerPipes {
  private final class End {
    let central: CBCentral
    let characteristic: CBMutableCharacteristic
    let queue: ByteQueue
    let salt: [UInt8]
    let mtu: Locked<Int>
    let gone = Locked(false)
    /** A write held back until the reader made room; under the pipes' lock. */
    var heldRequest: CBATTRequest?

    init(_ central: CBCentral, _ characteristic: CBMutableCharacteristic, _ queue: ByteQueue, _ salt: [UInt8]) {
      self.central = central
      self.characteristic = characteristic
      self.queue = queue
      self.salt = salt
      mtu = Locked(central.maximumUpdateValueLength + 3)
    }
  }

  private let radio: DispatchQueue
  private let tune: () -> LinkTunables
  /** A central opened a pipe under `salt`. */
  private let opened: (Transport, [UInt8]) -> Void
  private let lock = NSLock()
  private weak var manager: CBPeripheralManager?
  private var service: CBMutableService?
  private var notifyCharacteristic: CBMutableCharacteristic?
  private var salt: [UInt8]?
  private var writeUuid: CBUUID?
  private var notifyUuid: CBUUID?
  private let ends = PipeEnds<End>()
  private var serviceAdded: ((Bool) -> Void)?
  /** One notification at a time across every central. */
  private let notifyLock = NSLock()
  /** Counts `peripheralManagerIsReady`, so a notifier waits for the next one after its own refusal. */
  private let readyChanged = NSCondition()
  private var readyCount = 0

  init(radio: DispatchQueue, tune: @escaping () -> LinkTunables, opened: @escaping (Transport, [UInt8]) -> Void) {
    self.radio = radio
    self.tune = tune
    self.opened = opened
  }

  /** On `radio`. Serves the pipe under a new salt, taking down the last one. `done` says whether it is up. */
  func serve(_ m: CBPeripheralManager, _ kFind: [UInt8], _ newSalt: [UInt8], _ done: @escaping (Bool) -> Void) {
    let svc = CBMutableService(type: CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 0))), primary: true)
    let write = CBMutableCharacteristic(
      type: CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 1))), properties: [.write], value: nil, permissions: [.writeable]
    )
    let notify = CBMutableCharacteristic(
      type: CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, newSalt, 2))), properties: [.notify], value: nil, permissions: [.readable]
    )
    svc.characteristics = [write, notify]
    lock.lock()
    let old = service
    manager = m
    service = svc
    notifyCharacteristic = notify
    salt = newSalt
    writeUuid = write.uuid
    notifyUuid = notify.uuid
    serviceAdded = done
    lock.unlock()
    if let old { m.remove(old) }
    m.add(svc)
  }

  /** On `radio`: the service asked for is up, or not. */
  func added(_ s: CBService, ok: Bool) {
    lock.lock()
    let mine = s === service
    let done = mine ? serviceAdded : nil
    if mine { serviceAdded = nil }
    lock.unlock()
    done?(ok)
  }

  /** On `radio`. Pipes that are open stay; the service and its salt go. */
  func unserve() {
    lock.lock()
    let old = service
    let m = manager
    service = nil
    notifyCharacteristic = nil
    salt = nil
    writeUuid = nil
    notifyUuid = nil
    let done = serviceAdded
    serviceAdded = nil
    lock.unlock()
    if let old, m?.state == .poweredOn { m?.remove(old) }
    done?(false)
  }

  /** On `radio`: Bluetooth went off, and every service and subscription with it. */
  func lost() {
    unserve()
    for end in takeAll() { finish(end) }
  }

  /** On `radio`, for `stopAll`. */
  func close() {
    for end in takeAll() { finish(end) }
    unserve()
    lock.lock()
    let m = manager
    manager = nil
    lock.unlock()
    if m?.state == .poweredOn { m?.removeAllServices() }
  }

  private func takeAll() -> [End] {
    lock.lock()
    defer { lock.unlock() }
    return ends.takeAll()
  }

  /** On `radio`: a central turned on notifications, which opens a pipe. */
  func subscribed(_ central: CBCentral, _ characteristic: CBCharacteristic) {
    lock.lock()
    guard characteristic.uuid == notifyUuid, let current = salt, let notify = notifyCharacteristic else {
      lock.unlock()
      return
    }
    let address = central.identifier.uuidString
    if ends.has(address) {
      lock.unlock()
      return
    }
    let queue = ByteQueue(tune().pipeBytes) { [weak self] in self?.drained(address) }
    let end = End(central, notify, queue, current)
    ends.put(address, end)
    lock.unlock()
    let transport = PipeTransport(
      queue: queue, mtu: { end.mtu.get }, send: { [weak self] value in
        guard let self else { throw TransportError.broken("the pipe went") }
        try self.notify(end, value)
      }, onClose: { [weak self] in self?.disconnect(end) }
    )
    opened(transport, end.salt)
  }

  /** On `radio`: a central turned notifications off or went, which Core Bluetooth says the same way. */
  func unsubscribed(_ central: CBCentral, _ characteristic: CBCharacteristic) {
    lock.lock()
    let end = ends.remove(central.identifier.uuidString)
    lock.unlock()
    if let end { finish(end) }
  }

  /** On `radio`. Core Bluetooth asks for one answer, to the first request, for all of them. */
  func writes(_ m: CBPeripheralManager, _ requests: [CBATTRequest]) {
    guard let first = requests.first else { return }
    var touched: End?
    for request in requests {
      lock.lock()
      let end = ends[request.central.identifier.uuidString]
      let ours = request.characteristic.uuid == writeUuid
      lock.unlock()
      guard ours, let end, request.offset == 0, let value = request.value else {
        return m.respond(to: first, withResult: .writeNotPermitted)
      }
      if !end.queue.offer([UInt8](value)) {
        m.respond(to: first, withResult: .unlikelyError)
        return drop(end)
      }
      touched = end
    }
    guard let end = touched else { return m.respond(to: first, withResult: .success) }
    // Past half the pipe's room, the answer waits for the reader, so the central waits too.
    lock.lock()
    let hold = end.queue.size > tune().pipeBytes / 2
    if hold { end.heldRequest = first }
    lock.unlock()
    if !hold { m.respond(to: first, withResult: .success) }
  }

  /** On `radio`: the stack's queue for notifications has room again. */
  func ready() {
    readyChanged.lock()
    readyCount += 1
    readyChanged.broadcast()
    readyChanged.unlock()
  }

  /** A reader made room: a held write is answered. Off `radio`. */
  private func drained(_ address: String) {
    radio.async { [weak self] in
      guard let self else { return }
      self.lock.lock()
      guard let end = self.ends[address], let held = end.heldRequest, end.queue.size <= self.tune().pipeBytes / 2 else {
        self.lock.unlock()
        return
      }
      end.heldRequest = nil
      let m = self.manager
      self.lock.unlock()
      m?.respond(to: held, withResult: .success)
    }
  }

  /** One pipe goes, and leaves a newer pipe of the same central where it is. */
  private func drop(_ end: End) {
    lock.lock()
    _ = ends.remove(end.central.identifier.uuidString, end: end)
    lock.unlock()
    finish(end)
  }

  private func finish(_ end: End) {
    end.gone.set(true)
    end.queue.end()
    readyChanged.lock()
    readyChanged.broadcast()
    readyChanged.unlock()
    // A write held for room is answered, so the central is not left waiting for its timeout.
    radio.async { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let held = end.heldRequest
      end.heldRequest = nil
      let m = self.manager
      self.lock.unlock()
      if let held, m?.state == .poweredOn { m?.respond(to: held, withResult: .unlikelyError) }
    }
  }

  /**
   * A peripheral cannot end a central's connection on an iPhone: the pipe goes here, its writes are
   * refused from now on, and the central's own timeout ends the connection.
   */
  private func disconnect(_ end: End) { drop(end) }

  /** Off `radio`, on the link's writer: one value, once the stack has taken it. */
  private func notify(_ end: End, _ value: [UInt8]) throws {
    notifyLock.lock()
    defer { notifyLock.unlock() }
    let deadline = nowMs() + ackMs
    let data = Data(value)
    while true {
      if end.gone.get { throw TransportError.broken("the pipe went") }
      let (sent, seen, missing): (Bool, Int, Bool) = radio.sync {
        lock.lock()
        let m = manager
        lock.unlock()
        guard let m, m.state == .poweredOn else { return (false, 0, true) }
        readyChanged.lock()
        let seen = readyCount
        readyChanged.unlock()
        end.mtu.set(end.central.maximumUpdateValueLength + 3)
        return (m.updateValue(data, for: end.characteristic, onSubscribedCentrals: [end.central]), seen, false)
      }
      if missing { throw TransportError.broken("no GATT server") }
      if sent { return }
      readyChanged.lock()
      while readyCount == seen && !end.gone.get {
        let left = deadline - nowMs()
        if left <= 0 || (!readyChanged.wait(until: dateIn(left)) && readyCount == seen) {
          readyChanged.unlock()
          throw TransportError.broken("a notification was not taken")
        }
      }
      readyChanged.unlock()
    }
  }
}

/**
 * The connecting side of a pipe, as `GattClientPipe` in `GattPipes.kt`: connect to the phone heard,
 * find the service worked out from the key it matched and its salt, turn on notifications, then
 * write the stream one acknowledged value at a time. Values are cut to what one write request holds
 * (`maximumWriteValueLength(for: .withoutResponse)`), because a longer one would go as a prepared
 * write, which an Android's server refuses. A failed attempt is tried again `retries` times.
 */
final class GattClientPipe: NSObject, CBPeripheralDelegate {
  private let radio: DispatchQueue
  private weak var find: BleFind?
  private let central: CBCentralManager
  private let peripheral: CBPeripheral
  private let pipeBytes: Int
  private let serviceUuid: CBUUID
  private let writeUuid: CBUUID
  private let notifyUuid: CBUUID
  private let cond = NSCondition()
  private var connected = false
  private var ready = false
  private var failed: NearbyCode?
  private var writeCharacteristic: CBCharacteristic?
  private var writeResult: Bool?
  private let writeLock = NSLock()
  private let mtu = Locked(23)
  /** A new one for each attempt, since a failed attempt ends its own. */
  private let queue = Locked(ByteQueue(1))

  init(radio: DispatchQueue, find: BleFind, central: CBCentralManager, peripheral: CBPeripheral, kFind: [UInt8], salt: [UInt8], pipeBytes: Int) {
    self.radio = radio
    self.find = find
    self.central = central
    self.peripheral = peripheral
    self.pipeBytes = pipeBytes
    serviceUuid = CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 0)))
    writeUuid = CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 1)))
    notifyUuid = CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.gattUuid(kFind, salt, 2)))
    super.init()
  }

  /** Off `radio`. Connects, tries again after a failure, and gives the pipe's stream once notifications are on. */
  func open(retries: Int, timeoutMs: Int64) throws -> Transport {
    var last = NearbyCode.PIPE_FAILED
    for _ in 0...max(0, retries) {
      cond.lock()
      failed = nil
      connected = false
      ready = false
      writeCharacteristic = nil
      cond.unlock()
      let q = ByteQueue(pipeBytes)
      queue.set(q)
      radio.sync {
        find?.register(self, peripheral.identifier)
        peripheral.delegate = self
        central.connect(peripheral, options: nil)
      }
      let deadline = dateIn(timeoutMs)
      cond.lock()
      while !ready && failed == nil {
        if !cond.wait(until: deadline) { break }
      }
      let outcome: NearbyCode? = ready ? nil : (failed ?? NearbyCode.PIPE_TIMEOUT)
      cond.unlock()
      guard let code = outcome else {
        return PipeTransport(queue: q, mtu: { [weak self] in self?.mtu.get ?? 23 }, send: { [weak self] value in
          guard let self else { throw TransportError.broken("the pipe went") }
          try self.write(value)
        }, onClose: { [weak self] in self?.close() })
      }
      last = code
      radio.sync {
        central.cancelPeripheralConnection(peripheral)
        find?.unregister(self, peripheral.identifier)
      }
      // No such service under that salt: the phone rotated or is not a teammate, so trying again cannot help.
      if code == NearbyCode.PEER_GONE { break }
    }
    throw NearbyError(last, "the pipe did not open")
  }

  // ---- from BleFind, on `radio` --------------------------------------------------

  func didConnect() {
    cond.lock()
    connected = true
    cond.unlock()
    peripheral.discoverServices([serviceUuid])
  }

  func didFail(_ code: NearbyCode) { fail(code) }

  /** A disconnect from an earlier attempt, before this one connected, is not this one's. */
  func didDisconnect() {
    cond.lock()
    let mine = connected
    let wasReady = ready
    cond.unlock()
    if mine { fail(wasReady ? NearbyCode.LINK_DROPPED : NearbyCode.PIPE_FAILED) }
  }

  // ---- CBPeripheralDelegate, on `radio` ------------------------------------------

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let svc = p.services?.first(where: { $0.uuid == serviceUuid }) else { return fail(NearbyCode.PEER_GONE) }
    p.discoverCharacteristics([writeUuid, notifyUuid], for: svc)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let write = service.characteristics?.first { $0.uuid == writeUuid }
    let notify = service.characteristics?.first { $0.uuid == notifyUuid }
    guard error == nil, let write, let notify else { return fail(NearbyCode.PEER_GONE) }
    cond.lock()
    writeCharacteristic = write
    cond.unlock()
    mtu.set(p.maximumWriteValueLength(for: .withoutResponse) + 3)
    p.setNotifyValue(true, for: notify)
  }

  func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == notifyUuid else { return }
    if error != nil || !characteristic.isNotifying { return fail(NearbyCode.PIPE_FAILED) }
    cond.lock()
    ready = true
    cond.broadcast()
    cond.unlock()
  }

  func peripheral(_ p: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    cond.lock()
    writeResult = error == nil
    cond.broadcast()
    cond.unlock()
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == notifyUuid, error == nil, let value = characteristic.value else { return }
    if !queue.get.offer([UInt8](value)) { fail(NearbyCode.LINK_DROPPED) }
  }

  /** The other phone took its service down (a rotation): this pipe is gone. */
  func peripheral(_ p: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    if invalidatedServices.contains(where: { $0.uuid == serviceUuid }) { fail(NearbyCode.LINK_DROPPED) }
  }

  private func fail(_ code: NearbyCode) {
    cond.lock()
    if failed == nil { failed = code }
    cond.broadcast()
    cond.unlock()
    queue.get.end()
  }

  /** Off `radio`, on the link's writer: one value, once the other phone acknowledged it. */
  private func write(_ value: [UInt8]) throws {
    writeLock.lock()
    defer { writeLock.unlock() }
    cond.lock()
    let characteristic = writeCharacteristic
    let gone = failed != nil
    writeResult = nil
    cond.unlock()
    guard let characteristic, !gone else { throw TransportError.broken("the pipe went") }
    let data = Data(value)
    radio.sync {
      mtu.set(peripheral.maximumWriteValueLength(for: .withoutResponse) + 3)
      peripheral.writeValue(data, for: characteristic, type: .withResponse)
    }
    let deadline = dateIn(ackMs)
    cond.lock()
    defer { cond.unlock() }
    while writeResult == nil && failed == nil {
      if !cond.wait(until: deadline) && writeResult == nil { throw TransportError.broken("a write was not acknowledged") }
    }
    if writeResult != true { throw TransportError.broken("the pipe went") }
  }

  /** Off `radio`. */
  func close() {
    fail(NearbyCode.LINK_CLOSED)
    radio.async { [self] in
      central.cancelPeripheralConnection(peripheral)
      find?.unregister(self, peripheral.identifier)
    }
  }
}
