import CoreBluetooth
import Foundation

/**
 * Find on an iPhone (docs/nearby-sync-plan.md 5.12, and section 7's phase 5): an advert holding one
 * service UUID worked out from `kFind` and a rotating salt, and nothing else, since Core Bluetooth
 * puts only a local name in a scan response and an iPhone's advert goes out alone; the same GATT
 * service as an Android serves, under UUIDs worked out from `kFind` and the salt; and a scan with no
 * filter, matched here against every key in `scanKeys`, so that only teammates and the salts of
 * adverts of this form go up. No name, no manufacturer or service data, and no fixed UUID anywhere.
 * Rotation stops the advert, swaps the GATT service and advertises under a new salt, on a jittered
 * period from JavaScript, and waits while a pipe that passed its opening holds the salt.
 *
 * Neither manager exists until `askPermission` or `startFind`, since making one shows the Bluetooth
 * prompt. Every call and callback runs on `queue`. `kFind` and the scan keys live here only while
 * Find runs and are never logged. Nothing runs in the background: the app declares no background
 * mode, and the module stops everything when the app leaves the screen.
 */
final class BleFind: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate {
  private let queue: DispatchQueue
  private weak var events: RadioEvents?
  let pipes: GattServerPipes
  private(set) var central: CBCentralManager?
  private(set) var peripheral: CBPeripheralManager?
  /** Woken whenever a manager's state changes, for whoever waits on the prompt or the radio. */
  private let stateChanged = NSCondition()

  private var kFind: [UInt8]?
  private var matcher: FindMatcher?
  private var tune: FindTunables?
  private var payload = [UInt8](repeating: 0, count: FindCodec.payloadBytes)
  private var r = [UInt8](repeating: 0, count: FindCodec.rBytes)
  private var salt: [UInt8]?
  /** Every `r` given under the current salt: a mask is never used twice. */
  private var usedR = Set<String>()
  private var advertising = false
  private var pendingSalt: [UInt8]?
  private var pendingDone: ((Bool) -> Void)?
  private var saltHeld = false
  private var rotationDue = false
  private var rotating = false
  private var scanHeld = false
  private var scanning = false
  private var lastScanStart = Int64.min / 2
  /** Bluetooth went off while Find ran: said once, and Find comes back when it is on again. */
  private var offSaid = false
  private var heardResponses: [String: String] = [:]
  private var formSaltsAt: [String: Int64] = [:]
  private var advertsAt: [String: Int64] = [:]
  /** Teammates heard, so a pipe can be opened to one by its identifier. */
  private var heardPhones: [UUID: CBPeripheral] = [:]
  private var clients: [UUID: GattClientPipe] = [:]
  private var rotation: DispatchWorkItem?
  private var restart: DispatchWorkItem?
  private var startLater: DispatchWorkItem?
  private var random = SystemRandomNumberGenerator()

  init(queue: DispatchQueue, events: RadioEvents, pipes: GattServerPipes) {
    self.queue = queue
    self.events = events
    self.pipes = pipes
    super.init()
  }

  // ---- the managers --------------------------------------------------------------

  /** On `queue`. The first one made shows the Bluetooth prompt, once. */
  func makeCentral() {
    if central == nil {
      central = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }
  }

  /** On `queue`. */
  func makePeripheral() {
    if peripheral == nil {
      peripheral = CBPeripheralManager(delegate: self, queue: queue, options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
    }
  }

  /** Off `queue`: waits up to `ms` for any manager's state to change. */
  func waitForState(_ ms: Int64) {
    stateChanged.lock()
    _ = stateChanged.wait(until: dateIn(ms))
    stateChanged.unlock()
  }

  /** Off `queue`: waits until both managers say where Bluetooth stands, and throws the code JavaScript shows a line for. */
  func requireOn(deadlineMs: Int64) throws {
    let deadline = nowMs() + deadlineMs
    while true {
      let (c, p) = queue.sync { (central?.state ?? .unknown, peripheral?.state ?? .unknown) }
      if c == .poweredOn && p == .poweredOn { return }
      if c == .unauthorized || p == .unauthorized { throw NearbyError(NearbyCode.NO_PERMISSION, "Bluetooth is not allowed") }
      if c == .unsupported || p == .unsupported { throw NearbyError(NearbyCode.NOT_AVAILABLE, "no Bluetooth LE") }
      if c == .poweredOff || p == .poweredOff { throw NearbyError(NearbyCode.BLUETOOTH_OFF, "Bluetooth is off") }
      // Unknown or resetting: the radio is settling, or the prompt is still up.
      if nowMs() >= deadline {
        if CBManager.authorization != .allowedAlways { throw NearbyError(NearbyCode.NO_PERMISSION, "Bluetooth is not allowed") }
        throw NearbyError(NearbyCode.BLUETOOTH_OFF, "Bluetooth did not come on")
      }
      waitForState(250)
    }
  }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    stateChanged.lock()
    stateChanged.broadcast()
    stateChanged.unlock()
    if c.state != .poweredOn { scanning = false }
    radioChanged()
  }

  func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
    stateChanged.lock()
    stateChanged.broadcast()
    stateChanged.unlock()
    if p.state != .poweredOn {
      advertising = false
      rotating = false
      pipes.lost()
    }
    radioChanged()
  }

  /** Bluetooth went off or came back while Find ran. */
  private func radioChanged() {
    guard kFind != nil, let c = central, let p = peripheral else { return }
    if c.state == .poweredOn && p.state == .poweredOn {
      guard offSaid else { return }
      offSaid = false
      // The service and the advert went with the radio: they come back under a new salt.
      startScan()
      if !advertising && !rotating { startSet(newSalt()) { [weak self] ok in self?.advertFailed(ok) } }
    } else if !offSaid && (c.state == .poweredOff || p.state == .poweredOff || c.state == .unauthorized || p.state == .unauthorized) {
      offSaid = true
      events?.findError(c.state == .unauthorized || p.state == .unauthorized ? NearbyCode.NO_PERMISSION : NearbyCode.BLUETOOTH_OFF)
    }
  }

  // ---- Find ----------------------------------------------------------------------

  var isRunning: Bool { kFind != nil }

  /** On `queue`. Advertises under `kFind` and scans for every key in `scanKeys`, newest first. */
  func start(kFind: [UInt8], scanKeys: [[UInt8]], payload: [UInt8], r: [UInt8], tune: FindTunables, done: @escaping (NearbyError?) -> Void) {
    stop()
    if payload.count != FindCodec.payloadBytes || r.count != FindCodec.rBytes || kFind.count != 32 || scanKeys.isEmpty || scanKeys.contains(where: { $0.count != 32 }) {
      return done(NearbyError(NearbyCode.BAD_ARGUMENT, "Find's keys or payload"))
    }
    self.kFind = kFind
    matcher = FindMatcher(scanKeys)
    self.tune = tune
    self.payload = payload
    self.r = r
    startScan()
    restart?.cancel()
    if tune.scanRestartMs > 0 { restart = after(tune.scanRestartMs) { [weak self] in self?.restartScanNow() } }
    guard peripheral?.state == .poweredOn else {
      // A phone that cannot advertise still scans and connects (5.12, "The echo").
      return done(nil)
    }
    startSet(newSalt()) { ok in done(ok ? nil : NearbyError(NearbyCode.ADVERTISE_FAILED, "advertising did not start")) }
  }

  /**
   * On `queue`. Keeps a new payload and `r`, never a new salt. An iPhone sends no scan response
   * (phase 5), so nothing changes on the air; an `r` already given under this salt is skipped, as
   * the Kotlin skips it.
   */
  func update(payload: [UInt8], r: [UInt8]) throws {
    if kFind == nil { throw NearbyError(NearbyCode.FIND_NOT_RUNNING, "Find is not running") }
    if payload.count != FindCodec.payloadBytes || r.count != FindCodec.rBytes { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a payload is 14 bytes and r 2") }
    self.payload = payload
    if salt != nil && !usedR.insert(Bytes.hex(r)).inserted { return }
    self.r = r
  }

  /** On `queue`. While held, rotation waits; once released, a rotation that came due runs at once. */
  func holdSalt(_ held: Bool) {
    saltHeld = held
    if !held && rotationDue { rotateNow() }
  }

  /** On `queue`. While held, the scan stops and advertising carries on (5.12: a session notices nobody new). */
  func holdScan(_ held: Bool) {
    scanHeld = held
    if held { stopScan() } else { startScan() }
  }

  /** On `queue`. The key goes first, so whatever this stop cuts short sees Find stopped and says nothing. */
  func stop() {
    var key = kFind
    kFind = nil
    if key != nil { Bytes.wipe(&key!) }
    rotation?.cancel()
    restart?.cancel()
    startLater?.cancel()
    rotation = nil
    restart = nil
    startLater = nil
    stopScan()
    stopAdvert()
    pipes.unserve()
    matcher?.clear()
    matcher = nil
    salt = nil
    pendingSalt = nil
    let pending = pendingDone
    pendingDone = nil
    usedR.removeAll()
    heardResponses.removeAll()
    formSaltsAt.removeAll()
    advertsAt.removeAll()
    heardPhones.removeAll()
    saltHeld = false
    rotationDue = false
    rotating = false
    scanHeld = false
    offSaid = false
    pending?(false)
  }

  /** On `queue`. The key a pipe to a phone heard under `scanKeys[scan]` is opened with. */
  func keyAt(_ scan: Int) -> [UInt8]? { matcher?.keyAt(scan) }

  // ---- advertising ---------------------------------------------------------------

  private func newSalt() -> [UInt8] { (0..<FindCodec.saltBytes).map { _ in UInt8.random(in: UInt8.min...UInt8.max, using: &random) } }

  private func after(_ ms: Int64, _ body: @escaping () -> Void) -> DispatchWorkItem {
    let item = DispatchWorkItem(block: body)
    queue.asyncAfter(deadline: .now() + .milliseconds(Int(min(ms, Int64(Int32.max)))), execute: item)
    return item
  }

  private func startSet(_ newSalt: [UInt8], _ done: @escaping (Bool) -> Void) {
    guard let key = kFind, let p = peripheral, p.state == .poweredOn else { return done(false) }
    rotating = true
    pipes.serve(p, key, newSalt) { [weak self] served in
      guard let self else { return }
      if self.kFind == nil {
        // Stopped while this salt's service was being added: `stop` unserved before it was up.
        self.pipes.unserve()
        return done(false)
      }
      if !served {
        self.rotating = false
        return done(false)
      }
      self.salt = newSalt
      self.usedR = [Bytes.hex(self.r)]
      self.pendingSalt = newSalt
      self.pendingDone = done
      p.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [CBUUID(nsuuid: FindCodec.uuidOf(FindCodec.advertId(key, newSalt)))]])
    }
  }

  func peripheralManagerDidStartAdvertising(_ p: CBPeripheralManager, error: Error?) {
    rotating = false
    let done = pendingDone
    let started = pendingSalt
    pendingDone = nil
    pendingSalt = nil
    guard error == nil, kFind != nil, let s = started else {
      advertising = false
      if kFind == nil {
        p.stopAdvertising()
      } else {
        events?.findError(NearbyCode.ADVERTISE_FAILED)
      }
      done?(false)
      return
    }
    advertising = true
    events?.salt(Bytes.b64url(s))
    scheduleRotation()
    done?(true)
  }

  private func stopAdvert() {
    advertising = false
    if peripheral?.state == .poweredOn { peripheral?.stopAdvertising() }
  }

  private func scheduleRotation() {
    guard let t = tune else { return }
    rotation?.cancel()
    rotation = after(t.rotationMs(Double.random(in: 0..<1, using: &random))) { [weak self] in self?.rotateNow() }
  }

  /** A new salt: the advert stops, the GATT service is swapped, and the advert starts again under the new salt. */
  private func rotateNow() {
    if kFind == nil || rotating { return }
    if saltHeld {
      rotationDue = true
      return
    }
    rotationDue = false
    if !advertising { return }
    stopAdvert()
    startSet(newSalt()) { [weak self] ok in self?.advertFailed(ok) }
  }

  /** A new salt's advert did not start while Find still runs: JavaScript hears it. */
  private func advertFailed(_ ok: Bool) {
    if !ok && kFind != nil { events?.findError(NearbyCode.ADVERTISE_FAILED) }
  }

  // ---- scanning ------------------------------------------------------------------

  private func startScan() {
    guard let t = tune, !scanning, !scanHeld, kFind != nil else { return }
    // Android's limit on scan starts, kept so the two phones answer to the same tunables.
    let wait = lastScanStart + t.scanStartGapMs - nowMs()
    if wait > 0 {
      startLater?.cancel()
      startLater = after(wait) { [weak self] in self?.startScan() }
      return
    }
    guard let c = central, c.state == .poweredOn else { return }
    c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    scanning = true
    lastScanStart = nowMs()
  }

  private func stopScan() {
    startLater?.cancel()
    startLater = nil
    if !scanning { return }
    scanning = false
    if central?.state == .poweredOn { central?.stopScan() }
  }

  private func restartScanNow() {
    guard let t = tune else { return }
    if scanning {
      stopScan()
      startScan()
    }
    restart = after(t.scanRestartMs) { [weak self] in self?.restartScanNow() }
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData ad: [String: Any], rssi: NSNumber) {
    guard let m = matcher else { return }
    guard let services = ad[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID], !services.isEmpty else { return }
    let uuids = services.map { [UInt8]($0.data) }
    let other = ad[CBAdvertisementDataLocalNameKey] != nil
      || ad[CBAdvertisementDataManufacturerDataKey] != nil
      || !((ad[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data])?.isEmpty ?? true)
      || !((ad[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID])?.isEmpty ?? true)
      || !((ad[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID])?.isEmpty ?? true)
    let connectable = (ad[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue ?? false
    let peer = p.identifier.uuidString
    switch m.hear(uuids, otherData: other) {
    case let .match(scan, salt, response):
      keep(p)
      let saltText = Bytes.b64url(salt)
      let rText = Bytes.b64url(response.r)
      // The same response heard again tells JavaScript nothing; a new one comes at each tick.
      if heardResponses[peer] == "\(saltText):\(rText)" { return }
      if heardResponses.count > 512 { heardResponses.removeAll() }
      heardResponses[peer] = "\(saltText):\(rText)"
      events?.found([
        "peer": peer,
        "salt": saltText,
        "r": rText,
        "tag": Bytes.hex(response.tag),
        "summary": Bytes.hex(response.summary),
        "echo": Bytes.b64url(response.echo),
        "connectable": connectable,
        "rssi": rssi.intValue,
        "scan": scan,
      ])
    case let .advert(scan, salt):
      keep(p)
      // The same advert, heard again and again with no response, tells JavaScript nothing new.
      let saltText = Bytes.b64url(salt)
      let now = nowMs()
      if let at = advertsAt[saltText], now - at < (tune?.formSaltRepeatMs ?? 5_000) { return }
      if advertsAt.count > 512 { advertsAt.removeAll() }
      advertsAt[saltText] = now
      events?.advert(["peer": peer, "salt": saltText, "connectable": connectable, "rssi": rssi.intValue, "scan": scan])
    case let .formSalt(salt):
      let saltText = Bytes.b64url(salt)
      let now = nowMs()
      if let at = formSaltsAt[saltText], now - at < (tune?.formSaltRepeatMs ?? 5_000) { return }
      if formSaltsAt.count > 512 { formSaltsAt.removeAll() }
      formSaltsAt[saltText] = now
      events?.formSalt(saltText, rssi.intValue)
    case nil:
      break
    }
  }

  private func keep(_ p: CBPeripheral) {
    if heardPhones[p.identifier] == nil && heardPhones.count >= 256 { heardPhones.removeAll() }
    heardPhones[p.identifier] = p
  }

  // ---- pipes to phones heard -----------------------------------------------------

  /** On `queue`. The phone heard as `peer`, which Core Bluetooth names by an identifier of its own. */
  func phone(_ peer: String) throws -> (CBCentralManager, CBPeripheral) {
    guard let c = central else { throw NearbyError(NearbyCode.FIND_NOT_RUNNING, "Find is not running") }
    if c.state != .poweredOn { throw NearbyError(NearbyCode.BLUETOOTH_OFF, "Bluetooth is off") }
    guard let id = UUID(uuidString: peer) else { throw NearbyError(NearbyCode.BAD_ARGUMENT, "not a phone heard") }
    if let p = heardPhones[id] { return (c, p) }
    guard let p = c.retrievePeripherals(withIdentifiers: [id]).first else { throw NearbyError(NearbyCode.PEER_GONE, "that phone is not here") }
    return (c, p)
  }

  /** On `queue`. */
  func register(_ client: GattClientPipe, _ id: UUID) { clients[id] = client }

  /** On `queue`. Only this client, if it is still the one for that phone. */
  func unregister(_ client: GattClientPipe, _ id: UUID) {
    if clients[id] === client { clients.removeValue(forKey: id) }
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { clients[p.identifier]?.didConnect() }

  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { clients[p.identifier]?.didFail(NearbyCode.PIPE_FAILED) }

  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) { clients[p.identifier]?.didDisconnect() }

  // ---- the GATT server's callbacks -----------------------------------------------

  func peripheralManager(_ p: CBPeripheralManager, didAdd service: CBService, error: Error?) { pipes.added(service, ok: error == nil) }

  func peripheralManager(_ p: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    pipes.subscribed(central, characteristic)
  }

  func peripheralManager(_ p: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    pipes.unsubscribed(central, characteristic)
  }

  func peripheralManager(_ p: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) { pipes.writes(p, requests) }

  func peripheralManager(_ p: CBPeripheralManager, didReceiveRead request: CBATTRequest) { p.respond(to: request, withResult: .readNotPermitted) }

  func peripheralManagerIsReady(toUpdateSubscribers p: CBPeripheralManager) { pipes.ready() }

  /** On `queue`: the managers let go, as the module goes. */
  func release() {
    stop()
    central?.delegate = nil
    peripheral?.delegate = nil
    central = nil
    peripheral = nil
  }

  /** On `queue`: every client pipe goes, for `stopAll`. */
  func dropClients() {
    let all = Array(clients.values)
    clients.removeAll()
    for client in all { client.didFail(NearbyCode.LINK_CLOSED) }
  }
}
