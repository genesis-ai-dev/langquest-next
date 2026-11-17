import Foundation
import Network
import NetworkExtension

/**
 * An iPhone joining an Android's network as a plain client (docs/nearby-sync-plan.md section 7,
 * phase 5): a Wi-Fi Direct group by its name and passphrase, or a local-only hotspot by what its
 * host sent. An iPhone has no Wi-Fi Direct API and cannot host a network, but it can join one by
 * name and passphrase with `NEHotspotConfiguration`, after a system prompt each time, for this run
 * of the app only (`joinOnce`). It then connects over Wi-Fi alone to the network's gateway, which is
 * the Android, at the port its `host` message named. On close or `stopAll` the configuration is
 * removed, so the phone leaves that network. Blocking calls, run on a background thread.
 */
enum WifiJoin {
  /** Joins `ssid` and connects to its gateway on `port`; the link's end calls the second value to leave. */
  static func join(ssid: String, passphrase: String?, security: String?, port: Int, deadlineMs: Int64, stopped: @escaping () -> Bool) throws -> (NetTransport, () -> Void) {
    let deadline = nowMs() + deadlineMs
    let config: NEHotspotConfiguration
    if let passphrase, security != "open" {
      config = NEHotspotConfiguration(ssid: ssid, passphrase: passphrase, isWEP: false)
    } else {
      config = NEHotspotConfiguration(ssid: ssid)
    }
    config.joinOnce = true
    let leave = { NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid) }
    do {
      let applied = Future<Void>()
      NEHotspotConfigurationManager.shared.apply(config) { error in
        guard let error else {
          applied.complete(())
          return
        }
        let code = (error as NSError).domain == NEHotspotConfigurationErrorDomain ? NEHotspotConfigurationError(rawValue: (error as NSError).code) : nil
        switch code {
        case .alreadyAssociated?: applied.complete(())
        case .invalidSSID?, .invalidWPAPassphrase?, .invalidWEPPassphrase?, .invalid?:
          applied.fail(NearbyError(NearbyCode.BAD_ARGUMENT, "a network name or passphrase the iPhone will not take"))
        default: applied.fail(NearbyError(NearbyCode.JOIN_FAILED, "the network was not joined"))
        }
      }
      try applied.get(ms: max(1, deadline - nowMs()), timeout: NearbyCode.JOIN_TIMEOUT)
      let transport = try NetLinks.connectBy(deadline, { gateways(of: ssid, until: deadline, port: port) }, NetLinks.tcp(wifiOnly: true), stopped: stopped)
      return (transport, leave)
    } catch {
      leave()
      throw error as? NearbyError ?? NearbyError(NearbyCode.JOIN_FAILED, "could not join the network")
    }
  }

  /**
   * The gateway of the Wi-Fi network the phone is on, once that network is `ssid`: the Android that
   * hosts it. Empty until then, so the caller tries again. An app may read the name of a network it
   * configured itself; where it cannot, the gateway is tried anyway, since the opening checks
   * whoever answers.
   */
  static func gateways(of ssid: String, until deadline: Int64, port: Int) -> [Network.NWEndpoint] {
    let current = Future<String?>()
    NEHotspotNetwork.fetchCurrent { network in current.complete(network?.ssid) }
    if let name = try? current.get(ms: 2_000, timeout: NearbyCode.JOIN_TIMEOUT), name != ssid { return [] }
    guard let nwPort = Network.NWEndpoint.Port(rawValue: UInt16(port)) else { return [] }
    let found = Future<[Network.NWEndpoint]>()
    let monitor = NWPathMonitor(requiredInterfaceType: .wifi)
    monitor.pathUpdateHandler = { path in
      let hosts: [Network.NWEndpoint] = path.gateways.compactMap { gateway in
        guard case let .hostPort(host, _) = gateway else { return nil }
        if case .ipv4 = host { return Network.NWEndpoint.hostPort(host: host, port: nwPort) }
        return nil
      }
      if !hosts.isEmpty { found.complete(hosts) }
    }
    monitor.start(queue: DispatchQueue(label: "nearby-link.path"))
    defer { monitor.cancel() }
    return (try? found.get(ms: min(2_000, max(1, deadline - nowMs())), timeout: NearbyCode.JOIN_TIMEOUT)) ?? []
  }
}
