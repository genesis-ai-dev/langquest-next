import Foundation

/**
 * A network this phone hosts, and the links that connect to it (docs/nearby-sync-plan.md 5.12, The
 * link and the radio), as `Hosted.kt` is on Android. On an iPhone that is awdl: a Network framework
 * listener, advertised as a Bonjour service under a one-time name, which anyone nearby can reach.
 * Pure Swift, so XCTest runs it over in-memory streams; whatever listens hands each connection to
 * `accept`.
 *
 * Without `candidates` the first connection takes the link, and a later one is closed and reported.
 * With them every connection is handed up in turn, and JavaScript tries each: the link is the one
 * that proves the attempt's keys (`LinkSession.isProven`). Until one has, a candidate that ends
 * takes nothing down; once one has, any later connection is refused.
 */
final class Hosted {
  let id: String
  let kind: String
  let details: [String: Any]
  private let stopAccepting: () -> Void
  private let teardown: () -> Void
  private let adopt: (Transport, Hosted) -> LinkSession
  private let refused: (Hosted) -> Void
  let candidates: Bool
  /** Candidates held at once, unproven and not ended; past this a connection is closed. */
  private let maxCandidates: Int
  private let cond = NSCondition()
  private var down = false
  /** Adopted and not yet handed to JavaScript. */
  private var waiting: [LinkSession] = []
  /** Every link adopted, handed or not. */
  private var adopted: [LinkSession] = []
  /** The one candidate that proves the attempt's keys first; any other ends at its first frame (`LinkSession.firstProof`). */
  private var prover: LinkSession?

  private enum Verdict { case take, refuse, drop }

  init(
    id: String, kind: String, details: [String: Any], stopAccepting: @escaping () -> Void, teardown: @escaping () -> Void,
    adopt: @escaping (Transport, Hosted) -> LinkSession, refused: @escaping (Hosted) -> Void, candidates: Bool = false, maxCandidates: Int = 4
  ) {
    self.id = id
    self.kind = kind
    self.details = details
    self.stopAccepting = stopAccepting
    self.teardown = teardown
    self.adopt = adopt
    self.refused = refused
    self.candidates = candidates
    self.maxCandidates = maxCandidates
  }

  private func proven() -> Bool { adopted.contains { $0.isProven } }

  private func claimProof(_ s: LinkSession) -> Bool {
    cond.lock()
    defer { cond.unlock() }
    if prover == nil { prover = s }
    return prover === s
  }

  /** One connection that reached this network, on the listener's own thread. */
  func accept(_ transport: Transport) {
    cond.lock()
    // A candidate that ended unproven is forgotten, so strangers coming and going hold nothing.
    if candidates { adopted.removeAll { $0.isEnded && !$0.isProven } }
    let verdict: Verdict
    if down {
      verdict = .drop
    } else if !candidates && !adopted.isEmpty {
      verdict = .refuse
    } else if candidates && proven() {
      verdict = .refuse
    } else if candidates && adopted.count >= maxCandidates {
      verdict = .drop
    } else {
      verdict = .take
    }
    cond.unlock()
    if verdict != .take {
      transport.close()
      // A second phone once the link is settled is reported, so the inviter can be told.
      if verdict == .refuse { refused(self) }
      return
    }
    let session = adopt(transport, self)
    // The session holds this only until it ends (`LinkSession.end`), so neither keeps the other.
    if candidates {
      session.firstProof.set { [weak session] in
        guard let session else { return false }
        return self.claimProof(session)
      }
    }
    cond.lock()
    let kept = !down
    if kept {
      adopted.append(session)
      waiting.append(session)
      cond.broadcast()
    }
    cond.unlock()
    // Taken down between the verdict and here: nobody will ever be handed this link.
    if !kept { session.close() }
  }

  /**
   * The next link to try. Without `candidates` only the first; with them, each in turn until one
   * has proven the keys. Throws `HOST_TAKEN_DOWN` once there will be no more.
   */
  func nextLink() throws -> LinkSession {
    cond.lock()
    defer { cond.unlock() }
    while waiting.isEmpty {
      if down || (!candidates && !adopted.isEmpty) || (candidates && proven()) {
        throw NearbyError(NearbyCode.HOST_TAKEN_DOWN, "no more links for this group")
      }
      // A candidate proves itself on its own reader, so the wait looks again now and then.
      _ = cond.wait(until: dateIn(250))
    }
    return waiting.removeFirst()
  }

  /** Whether a link that ended takes the network down: the link, but not a candidate that never proved the keys. */
  func endTakesDown(_ session: LinkSession) -> Bool { !candidates || session.isProven }

  /** Takes the network down: an abandoned attempt, a link that ended, or `stopAll`. A link already handed keeps running. */
  func takeDown() {
    cond.lock()
    if down {
      cond.unlock()
      return
    }
    down = true
    let unhanded = waiting
    waiting.removeAll()
    cond.broadcast()
    cond.unlock()
    stopAccepting()
    for s in unhanded { s.close() }
    teardown()
  }
}
