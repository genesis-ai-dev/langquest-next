import Foundation
import Network

/**
 * Apple's own direct Wi-Fi between two iPhones (docs/nearby-sync-plan.md section 7, phase 5), through
 * Network framework with peer-to-peer allowed, over TCP. The host's listener advertises a Bonjour
 * service under a one-time name JavaScript chose, of the type the app's `Info.plist` declares in
 * `NSBonjourServices`; it is on the air only while a link comes up. Anyone nearby could connect to
 * it, so the host hands up each connection in turn (`Hosted` with candidates), and only the one that
 * proves the attempt's keys becomes the link. The joiner connects to the service by its name.
 */
enum Awdl {
  /** The service type, fixed in `Info.plist`'s `NSBonjourServices`. */
  static let serviceType = "_nlink._tcp"

  /** A Bonjour name: 1 to 63 bytes of UTF-8. */
  static func check(_ name: String?) throws -> String {
    guard let name, !name.isEmpty, name.utf8.count <= 63 else { throw NearbyError(NearbyCode.BAD_ARGUMENT, "a service name is 1 to 63 bytes") }
    return name
  }

  /**
   * Listens under `name`, handing each connection to the `Hosted` it answers with, on a thread of its
   * own. The details are what JavaScript sends in `host`: the name, and the port the listener got.
   */
  static func host(
    id: String, name: String, deadlineMs: Int64, adopt: @escaping (Transport, Hosted) -> LinkSession, refused: @escaping (Hosted) -> Void
  ) throws -> (Hosted, [String: Any]) {
    let listener: NWListener
    do {
      listener = try NWListener(using: NetLinks.tcp(peerToPeer: true))
    } catch {
      throw NearbyError(NearbyCode.GROUP_FAILED, "could not listen")
    }
    listener.service = NWListener.Service(name: name, type: serviceType)
    let queue = DispatchQueue(label: "nearby-link.awdl")
    let up = Future<Void>()
    let lastError = Locked<NWError?>(nil)
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready: up.complete(())
      case let .waiting(error): lastError.set(error)
      case let .failed(error):
        lastError.set(error)
        up.fail(NearbyError(NetLinks.refused(error) ? NearbyCode.NO_PERMISSION : NearbyCode.GROUP_FAILED, "the service did not start"))
      case .cancelled: up.fail(NearbyError(NearbyCode.GROUP_FAILED, "the service was taken down"))
      default: break
      }
    }
    let hostedBox = Locked<Hosted?>(nil)
    listener.newConnectionHandler = { connection in
      // Each connection comes up on a thread of its own, so a slow one holds up no other.
      Thread {
        guard let hosted = hostedBox.get else { return connection.cancel() }
        let ready = Future<Void>()
        connection.stateUpdateHandler = { state in
          switch state {
          case .ready: ready.complete(())
          case .failed, .cancelled: ready.fail(NearbyError(NearbyCode.LINK_DROPPED, "the connection went"))
          default: break
          }
        }
        connection.start(queue: DispatchQueue(label: "nearby-link.connection"))
        do {
          try ready.get(ms: 10_000, timeout: NearbyCode.LINK_DROPPED)
          hosted.accept(NetTransport(connection))
        } catch {
          connection.stateUpdateHandler = nil
          connection.cancel()
        }
      }.start()
    }
    // Taking it down lets go of the listener's handler, which holds the network, so neither keeps the other.
    let hosted = Hosted(
      id: id, kind: "awdl", details: ["kind": "awdl", "ssid": name], stopAccepting: {
        listener.newConnectionHandler = nil
        listener.cancel()
        hostedBox.set(nil)
      }, teardown: {},
      adopt: adopt, refused: refused, candidates: true
    )
    hostedBox.set(hosted)
    listener.start(queue: queue)
    do {
      try up.get(ms: max(1, deadlineMs), timeout: NearbyCode.GROUP_FAILED)
    } catch {
      hosted.takeDown()
      if let e = error as? NearbyError, e.code == NearbyCode.GROUP_FAILED, NetLinks.refused(lastError.get) {
        throw NearbyError(NearbyCode.NO_PERMISSION, "Local Network access is off")
      }
      throw error as? NearbyError ?? NearbyError(NearbyCode.GROUP_FAILED, "the service did not start")
    }
    guard let port = listener.port?.rawValue else {
      hosted.takeDown()
      throw NearbyError(NearbyCode.GROUP_FAILED, "the service has no port")
    }
    return (hosted, ["kind": "awdl", "ssid": name, "port": Int(port)])
  }

  /** Connects to the service named `name`, trying again until the deadline. */
  static func join(name: String, deadlineMs: Int64, stopped: @escaping () -> Bool) throws -> NetTransport {
    let endpoint = NWEndpoint.service(name: name, type: serviceType, domain: "local.", interface: nil)
    return try NetLinks.connectBy(nowMs() + deadlineMs, { [endpoint] }, NetLinks.tcp(peerToPeer: true), stopped: stopped)
  }
}
