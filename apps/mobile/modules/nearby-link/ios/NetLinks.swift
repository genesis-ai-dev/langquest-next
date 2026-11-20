import Foundation
import Network

/**
 * A Network framework TCP connection as a `Transport` for a `LinkSession` (docs/nearby-sync-plan.md
 * 5.12), as `SocketTransport` is a socket on Android: reads that wait with a deadline, writes that
 * return once the stack has taken the bytes, and a close that ends every wait. The connection's
 * callbacks run on a queue of its own; the session's threads wait on `cond`.
 */
final class NetTransport: Transport {
  private let connection: NWConnection
  private let cond = NSCondition()
  private var chunks: [[UInt8]] = []
  private var head = 0
  private var held = 0
  private var receiving = false
  private var ended = false
  private var broken = false
  private var closed = false
  private var timeout = 0

  /** `connection` is ready, and its queue is the one it started on. */
  init(_ connection: NWConnection) {
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled: self?.broke()
      default: break
      }
    }
  }

  private func broke() {
    cond.lock()
    broken = true
    cond.broadcast()
    cond.unlock()
  }

  /** Under `cond`: asks the connection for more, once at a time. */
  private func askForMore() {
    if receiving || ended || broken || closed { return }
    receiving = true
    connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      self.cond.lock()
      self.receiving = false
      if let data, !data.isEmpty {
        self.chunks.append([UInt8](data))
        self.held += data.count
      }
      if isComplete { self.ended = true }
      if error != nil { self.broken = true }
      self.cond.broadcast()
      self.cond.unlock()
    }
  }

  func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int {
    if count == 0 { return 0 }
    cond.lock()
    defer { cond.unlock() }
    let deadline: Date? = timeout > 0 ? dateIn(Int64(timeout)) : nil
    while held == 0 && !ended && !broken && !closed {
      askForMore()
      if let d = deadline {
        if !cond.wait(until: d) && held == 0 && !ended && !broken && !closed { throw TransportError.timeout }
      } else {
        cond.wait()
      }
    }
    if held == 0 {
      if closed || broken { throw TransportError.broken("the connection went") }
      return 0
    }
    var n = 0
    while n < count && !chunks.isEmpty {
      let c = chunks[0]
      let take = min(count - n, c.count - head)
      for i in 0..<take { buffer[offset + n + i] = c[head + i] }
      n += take
      head += take
      if head == c.count {
        chunks.removeFirst()
        head = 0
      }
    }
    held -= n
    return n
  }

  func write(_ bytes: [UInt8]) throws {
    cond.lock()
    let gone = closed || broken
    cond.unlock()
    if gone { throw TransportError.broken("the connection went") }
    let sent = Future<Bool>()
    connection.send(content: Data(bytes), completion: .contentProcessed { error in sent.complete(error == nil) })
    // A close cancels the connection, which settles every send still waiting.
    if (try? sent.get()) != true { throw TransportError.broken("the connection went") }
  }

  func setReadTimeout(_ ms: Int) {
    cond.lock()
    timeout = ms
    cond.unlock()
  }

  func shutdownOutput() {
    let done = Future<Void>()
    connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in done.complete(()) })
    _ = try? done.get(ms: 1_000, timeout: NearbyCode.INTERNAL)
  }

  func close() {
    cond.lock()
    let already = closed
    closed = true
    cond.broadcast()
    cond.unlock()
    if !already { connection.cancel() }
  }
}

/** TCP over Network framework, the ways the links ask for it. */
enum NetLinks {
  /** No delay and keepalive, as `tune(socket)` sets them on Android. */
  static func tcp(peerToPeer: Bool = false, wifiOnly: Bool = false) -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true
    tcp.enableKeepalive = true
    let p = NWParameters(tls: nil, tcp: tcp)
    p.includePeerToPeer = peerToPeer
    if wifiOnly { p.requiredInterfaceType = .wifi }
    p.prohibitedInterfaceTypes = [.cellular]
    return p
  }

  /** Local Network access refused: Bonjour answers `kDNSServiceErr_PolicyDenied`. */
  static func refused(_ error: NWError?) -> Bool {
    if case let .dns(code)? = error { return code == -65570 }
    return false
  }

  /** Why one try at a connection did not come up. */
  struct Missed: Error {
    let error: NWError?
  }

  /** One try: the connection ready within `ms`, or `Missed` and the connection cancelled. */
  static func connectOnce(_ endpoint: NWEndpoint, _ params: NWParameters, ms: Int64) throws -> NWConnection {
    let connection = NWConnection(to: endpoint, using: params)
    let up = Future<Void>()
    connection.stateUpdateHandler = { state in
      switch state {
      case .ready: up.complete(())
      // Waiting is how a refused connection or a service not found yet shows: one more try, later.
      case let .waiting(error): up.fail(Missed(error: error))
      case let .failed(error): up.fail(Missed(error: error))
      case .cancelled: up.fail(Missed(error: nil))
      default: break
      }
    }
    connection.start(queue: DispatchQueue(label: "nearby-link.connection"))
    do {
      try up.get(ms: ms, timeout: NearbyCode.JOIN_TIMEOUT)
      return connection
    } catch {
      connection.stateUpdateHandler = nil
      connection.cancel()
      throw (error as? Missed) ?? Missed(error: nil)
    }
  }

  /**
   * Connects to `endpoint`, trying again until the deadline, as `connectBy` does on Android: a
   * network's host answers a moment after the network forms. `JOIN_TIMEOUT` at the deadline, or
   * `NO_PERMISSION` when Local Network access was refused.
   */
  static func connectBy(_ deadline: Int64, _ endpoints: () -> [NWEndpoint], _ params: NWParameters, stopped: () -> Bool = { false }) throws -> NetTransport {
    var last: NWError?
    while nowMs() < deadline && !stopped() {
      for endpoint in endpoints() {
        let left = min(max(deadline - nowMs(), 500), 5_000)
        do {
          return NetTransport(try connectOnce(endpoint, params, ms: left))
        } catch let missed as Missed {
          last = missed.error ?? last
        }
        if nowMs() >= deadline { break }
      }
      pause(300)
    }
    if refused(last) { throw NearbyError(NearbyCode.NO_PERMISSION, "Local Network access is off") }
    throw NearbyError(NearbyCode.JOIN_TIMEOUT, "could not reach the host")
  }
}
