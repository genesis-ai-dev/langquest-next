import Foundation

/** What the radios tell JavaScript, through the module's events. Tags and summaries are hex, other bytes base64url. */
protocol RadioEvents: AnyObject {
  func found(_ seen: [String: Any])
  func advert(_ heard: [String: Any])
  func formSalt(_ salt: String, _ rssi: Int)
  func salt(_ salt: String)
  func pipe(_ linkId: String, _ salt: String)
  func refused(_ hostId: String)
  func linkDown(_ linkId: String, _ code: NearbyCode)
  func findError(_ code: NearbyCode)
}

/**
 * Every link this module holds, by id (docs/nearby-sync-plan.md 5.12), as `LinkRegistry` in
 * `RadioKit.kt`. JavaScript names a link by the id it was given and nothing else; a link that ends
 * is forgotten and reported once.
 */
final class LinkRegistry {
  private let roots: () -> [URL]
  private let tune: () -> LinkTunables
  private weak var events: RadioEvents?
  private let freeBytes: (URL) -> Int64
  private let lock = NSLock()
  private var links: [String: LinkSession] = [:]
  private var ids = 0

  init(roots: @escaping () -> [URL], tune: @escaping () -> LinkTunables, events: RadioEvents, freeBytes: @escaping (URL) -> Int64 = Paths.freeBytes) {
    self.roots = roots
    self.tune = tune
    self.events = events
    self.freeBytes = freeBytes
  }

  func adopt(_ transport: Transport, kind: String, onGone: @escaping (LinkSession) -> Void = { _ in }) -> LinkSession {
    lock.lock()
    ids += 1
    let id = "link-\(ids)"
    lock.unlock()
    let session = LinkSession(id: id, kind: kind, transport: transport, tune: tune(), roots: roots(), freeBytes: freeBytes) { [weak self] s, code in
      if let self {
        self.lock.lock()
        self.links.removeValue(forKey: s.id)
        self.lock.unlock()
      }
      onGone(s)
      self?.events?.linkDown(s.id, code)
    }
    lock.lock()
    links[id] = session
    lock.unlock()
    return session
  }

  func get(_ id: String) throws -> LinkSession {
    lock.lock()
    defer { lock.unlock() }
    guard let link = links[id] else { throw NearbyError(NearbyCode.LINK_UNKNOWN, "no such link") }
    return link
  }

  func closeAll() {
    lock.lock()
    let all = Array(links.values)
    lock.unlock()
    for link in all { link.close() }
  }
}
