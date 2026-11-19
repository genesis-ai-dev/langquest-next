import ExpoModulesCore
import Foundation

/**
 * Nearby sync's link on an iPhone (docs/nearby-sync-plan.md 4, 5.9, 5.12, and section 7's phase 5),
 * the Swift half of `NearbyLinkModule.kt`: Bluetooth LE to find teammates, a GATT pipe for the short
 * exchange, an Android's network joined as a plain client or Apple's own direct Wi-Fi (awdl) to
 * move work, and TCP with native framing and AES-GCM. Mechanism only: every tunable is an argument
 * from JavaScript, and JavaScript decides who to trust. It does nothing at construction and holds no
 * radio until asked; no Bluetooth manager exists before `askPermission` or `startFind`, so reading
 * the capabilities never shows a prompt. Every call that can wait runs on a background thread.
 * Native never sees a key but `kFind` and a link's two frame keys, and never logs them; rejections
 * carry a `NearbyCode` and no key, salt or address.
 *
 * `src/NearbyLinkModule.ts` is its JavaScript face, read through `requireOptionalNativeModule`, so a
 * build without it has none and never crashes. apps/mobile/test/nearbyNative.test.ts holds the
 * functions, the events and the codes here equal to the Kotlin's and the TypeScript's.
 */
public final class NearbyLinkModule: Module, RadioEvents {
  private let io = DispatchQueue(label: "nearby-link.io", qos: .userInitiated, attributes: .concurrent)
  private let linkTune = Locked(LinkTunables())
  private let held = NSLock()
  private var linksHeld: LinkRegistry?
  private var kitHeld: RadioKit?

  /** The app's own folders: the only places a file is sent from or received into. */
  private static func roots() -> [URL] {
    let fm = FileManager.default
    var out: [URL] = []
    for place in [FileManager.SearchPathDirectory.documentDirectory, .libraryDirectory, .cachesDirectory] {
      if let url = fm.urls(for: place, in: .userDomainMask).first { out.append(url) }
    }
    out.append(fm.temporaryDirectory)
    return out
  }

  /** Every link, made at the first call that needs one. */
  private func links() -> LinkRegistry {
    held.lock()
    defer { held.unlock() }
    if let l = linksHeld { return l }
    let l = LinkRegistry(roots: { NearbyLinkModule.roots() }, tune: { [weak self] in self?.linkTune.get ?? LinkTunables() }, events: self)
    linksHeld = l
    return l
  }

  /** The radios, made at the first call that needs them; no Bluetooth manager with them. */
  private func kit() -> RadioKit {
    let registry = links()
    held.lock()
    defer { held.unlock() }
    if let k = kitHeld { return k }
    let k = RadioKit(registry: registry, tune: { [weak self] in self?.linkTune.get ?? LinkTunables() }, events: self)
    kitHeld = k
    return k
  }

  private func made() -> (LinkRegistry?, RadioKit?) {
    held.lock()
    defer { held.unlock() }
    return (linksHeld, kitHeld)
  }

  // ---- events --------------------------------------------------------------------

  private func emit(_ name: String, _ body: [String: Any]) {
    let values = body.mapValues { $0 as Any? }
    DispatchQueue.main.async { [weak self] in self?.sendEvent(name, values) }
  }

  func found(_ seen: [String: Any]) { emit("onFound", seen) }
  func advert(_ heard: [String: Any]) { emit("onAdvert", heard) }
  func formSalt(_ salt: String, _ rssi: Int) { emit("onFormSalt", ["salt": salt, "rssi": rssi]) }
  func salt(_ salt: String) { emit("onSalt", ["salt": salt]) }
  func pipe(_ linkId: String, _ salt: String) { emit("onPipe", ["linkId": linkId, "salt": salt]) }
  func refused(_ hostId: String) { emit("onRefused", ["hostId": hostId]) }
  func linkDown(_ linkId: String, _ code: NearbyCode) { emit("onLinkDown", ["linkId": linkId, "code": code.rawValue]) }
  func findError(_ code: NearbyCode) { emit("onFindError", ["code": code.rawValue]) }

  // ---- calls ---------------------------------------------------------------------

  /** Runs on a background thread and settles the promise with the answer or the error's code. */
  private func run(_ promise: Promise, _ body: @escaping () throws -> Any?) {
    io.async {
      do {
        promise.resolve(try body())
      } catch let e as NearbyError {
        promise.reject(e.code.rawValue, e.message)
      } catch {
        promise.reject(NearbyCode.INTERNAL.rawValue, "the nearby module failed")
      }
    }
  }

  private func fileOf(_ uri: String) throws -> URL {
    if uri.hasPrefix("file:") {
      guard let url = URL(string: uri), url.isFileURL else { throw NearbyError(NearbyCode.BAD_ARGUMENT, "not a file URI") }
      return url
    }
    if uri.isEmpty || !uri.hasPrefix("/") { throw NearbyError(NearbyCode.BAD_ARGUMENT, "not a file URI") }
    return URL(fileURLWithPath: uri)
  }

  private func milliseconds(_ ms: Double) -> Int64 { FindTunables.int64(ms).map { max(0, $0) } ?? 0 }

  /** Give the app hands an Android install file to an Android phone (docs/nearby-sync-plan.md 14.5): an iPhone has none to give. */
  private func androidOnly(_ promise: Promise) {
    run(promise) {
      throw NearbyError(NearbyCode.NOT_AVAILABLE, "Give the app is Android only")
    }
  }

  private func stopAll(backgrounded: Bool = false) {
    let (registry, kit) = made()
    // The Wi-Fi join's system prompt takes the app off the screen; JavaScript ignores that one pause (5.8).
    if backgrounded, let kit, kit.joining.get > 0 { return }
    kit?.stopAll()
    registry?.closeAll()
  }

  public func definition() -> ModuleDefinition {
    Name("NearbyLink")
    Events("onFound", "onAdvert", "onFormSalt", "onSalt", "onPipe", "onRefused", "onLinkDown", "onFindError")

    // So a JavaScript thread that hung, or an app that went, cannot leave the radios on.
    OnDestroy {
      self.stopAll()
      self.made().1?.quit()
    }
    OnAppEntersBackground { self.io.async { self.stopAll(backgrounded: true) } }

    AsyncFunction("capabilities") { (promise: Promise) in
      self.run(promise) { Radios.capabilities(self.made().1?.centralState()) }
    }

    // An iPhone shows its Bluetooth prompt here, once (phase 5), and answers once the person has.
    AsyncFunction("askPermission") { (promise: Promise) in
      self.run(promise) { self.kit().askPermission() }
    }

    AsyncFunction("configureLinks") { (tunables: [String: Any], promise: Promise) in
      self.run(promise) {
        self.linkTune.set(FindTunables.links(tunables))
        return nil
      }
    }

    // `scanKeys` is every key's 32 bytes end to end, newest first.
    AsyncFunction("startFind") { (kFind: Data, scanKeys: Data, payload: Data, r: Data, tunables: [String: Any], promise: Promise) in
      self.run(promise) {
        var key = [UInt8](kFind)
        var all = [UInt8](scanKeys)
        var keys: [[UInt8]] = []
        defer {
          Bytes.wipe(&key)
          Bytes.wipe(&all)
          for i in 0..<keys.count { Bytes.wipe(&keys[i]) }
          Bytes.wipe(kFind)
          Bytes.wipe(scanKeys)
        }
        if all.isEmpty || all.count % 32 != 0 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "scan keys are 32 bytes each") }
        keys = stride(from: 0, to: all.count, by: 32).map { Array(all[$0..<($0 + 32)]) }
        try self.kit().startFind(kFind: key, scanKeys: keys, payload: [UInt8](payload), r: [UInt8](r), tunables: try FindTunables.of(tunables))
        return nil
      }
    }
    AsyncFunction("updateFind") { (payload: Data, r: Data, promise: Promise) in
      self.run(promise) {
        try self.kit().updateFind(payload: [UInt8](payload), r: [UInt8](r))
        return nil
      }
    }
    AsyncFunction("stopFind") { (promise: Promise) in
      self.run(promise) {
        try self.kit().stopFind()
        return nil
      }
    }
    AsyncFunction("holdScan") { (held: Bool, promise: Promise) in
      self.run(promise) {
        try self.kit().holdScan(held)
        return nil
      }
    }
    AsyncFunction("holdSalt") { (held: Bool, promise: Promise) in
      self.run(promise) {
        try self.kit().holdSalt(held)
        return nil
      }
    }

    AsyncFunction("openPipe") { (peer: String, salt: String, scan: Int, promise: Promise) in
      self.run(promise) { try self.kit().openPipe(peer: peer, salt: salt, scan: scan).id }
    }

    AsyncFunction("host") { (kind: String, options: [String: Any], deadlineMs: Double, promise: Promise) in
      self.run(promise) { try self.kit().host(kind: kind, options: options, deadlineMs: self.milliseconds(deadlineMs)) }
    }
    AsyncFunction("hostLink") { (hostId: String, promise: Promise) in
      self.run(promise) { try self.kit().hostLink(hostId).id }
    }
    AsyncFunction("takeDown") { (hostId: String, promise: Promise) in
      self.run(promise) {
        self.kit().takeDown(hostId)
        return nil
      }
    }
    AsyncFunction("join") { (kind: String, details: [String: Any], deadlineMs: Double, promise: Promise) in
      self.run(promise) { try self.kit().join(kind: kind, details: details, deadlineMs: self.milliseconds(deadlineMs)).id }
    }

    AsyncFunction("sendOpening") { (linkId: String, bytes: Data, promise: Promise) in
      self.run(promise) {
        try self.links().get(linkId).sendOpening([UInt8](bytes))
        return nil
      }
    }
    AsyncFunction("receiveOpening") { (linkId: String, size: Int, deadlineMs: Double, promise: Promise) in
      self.run(promise) {
        let opening = try self.links().get(linkId).receiveOpening(size, deadlineMs: self.milliseconds(deadlineMs))
        return opening.map { Data($0) }
      }
    }
    AsyncFunction("secure") { (linkId: String, sendKey: Data, receiveKey: Data, promise: Promise) in
      self.run(promise) {
        var send = [UInt8](sendKey)
        var receive = [UInt8](receiveKey)
        defer {
          Bytes.wipe(&send)
          Bytes.wipe(&receive)
          Bytes.wipe(sendKey)
          Bytes.wipe(receiveKey)
        }
        try self.links().get(linkId).secure(send, receive)
        return nil
      }
    }
    AsyncFunction("send") { (linkId: String, bytes: Data, promise: Promise) in
      self.run(promise) {
        try self.links().get(linkId).send([UInt8](bytes))
        return nil
      }
    }
    AsyncFunction("receive") { (linkId: String, promise: Promise) in
      self.run(promise) { try self.links().get(linkId).receive().map { Data($0) } }
    }
    AsyncFunction("sendFile") { (linkId: String, transferId: String, uri: String, size: Double, promise: Promise) in
      self.run(promise) {
        try self.links().get(linkId).sendFile(transferId, try self.fileOf(uri), FindTunables.int64(size) ?? -1)
        return nil
      }
    }
    AsyncFunction("receiveFile") { (linkId: String, transferId: String, stagingUri: String, maxBytes: Double, minFreeBytes: Double, promise: Promise) in
      self.run(promise) {
        let r = try self.links().get(linkId).receiveFile(
          transferId, try self.fileOf(stagingUri), maxBytes: FindTunables.int64(maxBytes) ?? -1, minFreeBytes: FindTunables.int64(minFreeBytes) ?? -1
        )
        return ["size": Double(r.size), "sha256": r.sha256]
      }
    }
    AsyncFunction("cancelFile") { (linkId: String, transferId: String, promise: Promise) in
      self.run(promise) {
        (try? self.links().get(linkId))?.cancelFile(transferId)
        return nil
      }
    }
    AsyncFunction("closeLink") { (linkId: String, promise: Promise) in
      self.run(promise) {
        (try? self.links().get(linkId))?.close()
        return nil
      }
    }
    AsyncFunction("stopAll") { (promise: Promise) in
      self.run(promise) {
        self.stopAll()
        return nil
      }
    }

    // Give the app (docs/nearby-sync-plan.md 14.5): Android's alone, so each call says not available.
    AsyncFunction("keepInstallFile") { (uri: String, name: String, minFreeBytes: Double, promise: Promise) in
      self.androidOnly(promise)
    }
    AsyncFunction("keptInstallFile") { (promise: Promise) in
      self.androidOnly(promise)
    }
    AsyncFunction("dropInstallFile") { (promise: Promise) in
      self.androidOnly(promise)
    }
    AsyncFunction("startGiveApp") { (page: String, deadlineMs: Double, promise: Promise) in
      self.androidOnly(promise)
    }
    AsyncFunction("giveAppStatus") { (promise: Promise) in
      self.androidOnly(promise)
    }
    AsyncFunction("stopGiveApp") { (promise: Promise) in
      self.androidOnly(promise)
    }
  }
}
