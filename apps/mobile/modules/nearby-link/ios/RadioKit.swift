import CoreBluetooth
import Foundation
import NetworkExtension

/**
 * The radios, made only when JavaScript first asks, as `RadioKit.kt` on Android: the module does
 * nothing at construction, and no Bluetooth manager exists until `askPermission` or `startFind`.
 * Find and the GATT pipes run on one serial queue; connecting, hosting and joining block a
 * background thread. Mechanism only: every tunable is an argument from JavaScript.
 */
final class RadioKit {
  private let radio = DispatchQueue(label: "nearby-link.radio")
  private let registry: LinkRegistry
  private let tune: () -> LinkTunables
  private weak var events: RadioEvents?
  private let find: BleFind
  private let hostsLock = NSLock()
  private var hosts: [String: Hosted] = [:]
  private var hostIds = 0
  private let findTune = Locked<FindTunables?>(nil)
  /** Joins with a system prompt under way: the prompt takes the app off the screen, which must not stop it. */
  let joining = Locked(0)
  /** Networks joined by name, left at `stopAll` whatever became of their links. */
  private let joined = Locked<Set<String>>([])
  /** Counts `stopAll`s, so a join under way sees that it was stopped. */
  private let stops = Locked(0)

  init(registry: LinkRegistry, tune: @escaping () -> LinkTunables, events: RadioEvents) {
    self.registry = registry
    self.tune = tune
    self.events = events
    let pipes = GattServerPipes(radio: radio, tune: tune) { [weak registry, weak events] transport, salt in
      guard let registry else { return transport.close() }
      let link = registry.adopt(transport, kind: "bluetooth")
      events?.pipe(link.id, Bytes.b64url(salt))
    }
    find = BleFind(queue: radio, events: events, pipes: pipes)
  }

  /** Runs on the radio queue and waits for it. */
  private func onRadio<T>(_ block: @escaping (Future<T>) throws -> Void) throws -> T {
    let f = Future<T>()
    radio.async {
      do { try block(f) } catch { f.fail(error) }
    }
    return try f.get(ms: 30_000, timeout: NearbyCode.INTERNAL)
  }

  /** The central's state, or nil before one was made. */
  func centralState() -> CBManagerState? { radio.sync { find.central?.state } }

  /** Makes the central, which shows the Bluetooth prompt once, and answers once the person has. */
  func askPermission() -> Bool {
    radio.sync { find.makeCentral() }
    let deadline = nowMs() + 300_000
    while CBManager.authorization == .notDetermined && nowMs() < deadline { find.waitForState(500) }
    return Radios.granted
  }

  func startFind(kFind: [UInt8], scanKeys: [[UInt8]], payload: [UInt8], r: [UInt8], tunables: FindTunables) throws {
    radio.sync {
      find.makeCentral()
      find.makePeripheral()
    }
    try find.requireOn(deadlineMs: 20_000)
    findTune.set(tunables)
    try onRadio { (f: Future<Void>) in
      self.find.start(kFind: kFind, scanKeys: scanKeys, payload: payload, r: r, tune: tunables) { e in
        if let e { f.fail(e) } else { f.complete(()) }
      }
    }
  }

  func updateFind(payload: [UInt8], r: [UInt8]) throws {
    try onRadio { (f: Future<Void>) in
      try self.find.update(payload: payload, r: r)
      f.complete(())
    }
  }

  func stopFind() throws {
    try onRadio { (f: Future<Void>) in
      self.find.stop()
      f.complete(())
    }
  }

  func holdScan(_ held: Bool) throws {
    try onRadio { (f: Future<Void>) in
      self.find.holdScan(held)
      f.complete(())
    }
  }

  func holdSalt(_ held: Bool) throws {
    try onRadio { (f: Future<Void>) in
      self.find.holdSalt(held)
      f.complete(())
    }
  }

  /** A pipe to a phone heard under `scanKeys[scan]`, to the GATT service its salt names. */
  func openPipe(peer: String, salt: String, scan: Int) throws -> LinkSession {
    if !Radios.granted { throw NearbyError(NearbyCode.NO_PERMISSION, "Bluetooth is not allowed") }
    guard let t = findTune.get else { throw NearbyError(NearbyCode.FIND_NOT_RUNNING, "Find is not running") }
    guard let saltBytes = Bytes.unb64url(salt), saltBytes.count == FindCodec.saltBytes else {
      throw NearbyError(NearbyCode.BAD_ARGUMENT, "a salt is 6 bytes")
    }
    let (heldKey, central, phone) = try onRadio { (f: Future<([UInt8], CBCentralManager, CBPeripheral)>) in
      guard let key = self.find.keyAt(scan) else { throw NearbyError(NearbyCode.FIND_NOT_RUNNING, "no such key") }
      let (c, p) = try self.find.phone(peer)
      f.complete((key, c, p))
    }
    var key = heldKey
    defer { Bytes.wipe(&key) }
    let client = GattClientPipe(radio: radio, find: find, central: central, peripheral: phone, kFind: key, salt: saltBytes, pipeBytes: tune().pipeBytes)
    let transport = try client.open(retries: t.connectRetries, timeoutMs: t.connectTimeoutMs)
    return registry.adopt(transport, kind: "bluetooth")
  }

  /** Only awdl: an iPhone can host neither a Wi-Fi Direct group nor a hotspot. */
  func host(kind: String, options: [String: Any], deadlineMs: Int64) throws -> [String: Any] {
    switch kind {
    case "awdl":
      let name = try Awdl.check(options["ssid"] as? String)
      hostsLock.lock()
      hostIds += 1
      let id = "host-\(hostIds)"
      hostsLock.unlock()
      // The link's end takes its network down; a candidate that never proved the keys does not.
      let adopt = { [registry] (t: Transport, h: Hosted) -> LinkSession in
        registry.adopt(t, kind: "awdl") { [weak self, weak h] s in
          if let h, h.endTakesDown(s) { self?.takeDown(h.id) }
        }
      }
      let refused = { [weak self] (h: Hosted) -> Void in self?.events?.refused(h.id) }
      let (hosted, details) = try Awdl.host(id: id, name: name, deadlineMs: deadlineMs, adopt: adopt, refused: refused)
      hostsLock.lock()
      hosts[id] = hosted
      hostsLock.unlock()
      var out = details
      out["hostId"] = id
      return out
    case "wifi-direct": throw NearbyError(NearbyCode.P2P_UNSUPPORTED, "an iPhone cannot host a Wi-Fi Direct group")
    case "hotspot": throw NearbyError(NearbyCode.HOTSPOT_INCOMPATIBLE, "an iPhone cannot host a hotspot")
    default: throw NearbyError(NearbyCode.BAD_ARGUMENT, "awdl, wifi-direct or hotspot")
    }
  }

  /** The network's next link: each candidate in turn, as `Hosted` gives them. */
  func hostLink(_ hostId: String) throws -> LinkSession {
    hostsLock.lock()
    let hosted = hosts[hostId]
    hostsLock.unlock()
    guard let hosted else { throw NearbyError(NearbyCode.HOST_TAKEN_DOWN, "no such group") }
    return try hosted.nextLink()
  }

  /** Takes down a network hosted for an attempt that was abandoned; a link it already gave keeps running. */
  func takeDown(_ hostId: String) {
    hostsLock.lock()
    let hosted = hosts.removeValue(forKey: hostId)
    hostsLock.unlock()
    hosted?.takeDown()
  }

  func join(kind: String, details: [String: Any], deadlineMs: Int64) throws -> LinkSession {
    guard let ssid = details["ssid"] as? String, !ssid.isEmpty else { throw NearbyError(NearbyCode.BAD_ARGUMENT, "no network name") }
    let started = stops.get
    let stopped = { [weak self] in (self?.stops.get ?? started + 1) != started }
    switch kind {
    case "awdl":
      let transport = try Awdl.join(name: try Awdl.check(ssid), deadlineMs: deadlineMs, stopped: stopped)
      return registry.adopt(transport, kind: "awdl")
    case "wifi-direct", "hotspot":
      guard let n = FindTunables.number(details["port"]), let port = FindTunables.int64(n), (1...65535).contains(port) else {
        throw NearbyError(NearbyCode.BAD_ARGUMENT, "no port")
      }
      let passphrase = details["passphrase"] as? String
      if kind == "wifi-direct" && passphrase == nil { throw NearbyError(NearbyCode.BAD_ARGUMENT, "no passphrase") }
      joining.with { $0 += 1 }
      defer { joining.with { $0 -= 1 } }
      joined.with { _ = $0.insert(ssid) }
      do {
        let (transport, leave) = try WifiJoin.join(
          ssid: ssid, passphrase: passphrase, security: details["security"] as? String, port: Int(port), deadlineMs: deadlineMs, stopped: stopped
        )
        return registry.adopt(transport, kind: kind) { [weak self] _ in
          leave()
          self?.joined.with { _ = $0.remove(ssid) }
        }
      } catch {
        joined.with { _ = $0.remove(ssid) }
        throw error
      }
    default:
      throw NearbyError(NearbyCode.BAD_ARGUMENT, "awdl, wifi-direct or hotspot")
    }
  }

  func stopAll() {
    stops.with { $0 += 1 }
    hostsLock.lock()
    let ids = Array(hosts.keys)
    hostsLock.unlock()
    for id in ids { takeDown(id) }
    let stopped = Future<Void>()
    radio.async {
      self.find.stop()
      self.find.pipes.close()
      self.find.dropClients()
      stopped.complete(())
    }
    _ = try? stopped.get(ms: 5_000, timeout: NearbyCode.INTERNAL)
    findTune.set(nil)
    let left = joined.with { s -> Set<String> in
      let all = s
      s.removeAll()
      return all
    }
    for ssid in left { NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid) }
  }

  /** Everything stopped, and the Bluetooth managers let go: the module is going. */
  func quit() {
    stopAll()
    radio.sync { find.release() }
  }
}
