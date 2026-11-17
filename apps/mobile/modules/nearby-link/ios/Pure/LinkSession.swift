import Foundation

/**
 * One link over any byte stream (docs/nearby-sync-plan.md 5.12), the same class on a Wi-Fi socket,
 * an awdl connection, a Bluetooth pipe and an XCTest loopback, as `LinkSession.kt` is on Android.
 * Before `secure` it carries only the opening's raw bytes, which JavaScript makes and checks; from
 * `secure` on, only sealed frames (`Frames.swift`): messages, files and a goodbye. A frame that
 * fails its tag, a length past 1 MiB or a stream that ends without a goodbye closes it, and every
 * wait on it then fails. Files move natively: sent from a file, received into a `PartWriter`,
 * hashed on the way, so bulk bytes never cross into JavaScript. Pure Swift on Foundation, with
 * blocking calls: the module runs each on a background thread.
 */
final class LinkSession {
  let id: String
  let kind: String
  private let transport: Transport
  private let tune: LinkTunables
  private let roots: [URL]
  private let freeBytes: (URL) -> Int64
  private let onEnded: (LinkSession, NearbyCode) -> Void

  private let writeLock = NSLock()
  /** Guards `messages`, `incoming`, `outgoing` and `skipped`, and is what every wait here waits on. */
  private let state = NSCondition()

  private let sealer = Locked<Sealer?>(nil)
  private let opener = Locked<Opener?>(nil)
  private let closedHere = Locked(false)
  private let ended = Locked<NearbyCode?>(nil)
  /** True once a frame from the other side opened: it holds this link's keys. */
  private let proven = Locked(false)
  /**
   * Asked once, as the first frame opens: false when another link under the same keys proved them
   * first, and this one then ends unproven, with no goodbye. Awdl and a hotspot hand up every
   * connection under one attempt's keys, and a replayed `ready` could prove a second, whose goodbye
   * would then repeat the link's nonce under the same key (security review, 2026-11-10). Set by
   * `Hosted` before the link is handed on, so before `secure` starts the reader.
   */
  let firstProof = Locked<(() -> Bool)?>(nil)
  /** True when the other side said goodbye: `receive` then gives nil once the queue is empty. */
  private let clean = Locked(false)
  private var messages: [[UInt8]] = []
  private var incoming: [String: Incoming] = [:]
  private var outgoing: [String: Outgoing] = [:]
  /** Transfers this side refused or cancelled: their frames are skipped. */
  private var skipped = Set<String>()
  private let reader = Locked<Thread?>(nil)
  private let readerDone = Future<Void>()

  private final class Incoming {
    let writer: PartWriter
    let done = Future<PartWriter.Result>()
    /** Read and written by the reader thread only. */
    var started = false

    init(_ writer: PartWriter) { self.writer = writer }
  }

  private final class Outgoing {
    /** -1 while it runs; a `Frame` reason once the other side cancelled; `local` once this side did. */
    let stop = Locked(-1)
  }

  private static let local = 1000

  init(
    id: String, kind: String, transport: Transport, tune: LinkTunables, roots: [URL],
    freeBytes: @escaping (URL) -> Int64 = Paths.freeBytes, onEnded: @escaping (LinkSession, NearbyCode) -> Void = { _, _ in }
  ) {
    self.id = id
    self.kind = kind
    self.transport = transport
    self.tune = tune
    self.roots = roots
    self.freeBytes = freeBytes
    self.onEnded = onEnded
  }

  var isSecured: Bool { sealer.get != nil }
  var isEnded: Bool { ended.get != nil }
  /** The other side has proven it holds the keys given to `secure`: a frame of its opened. */
  var isProven: Bool { proven.get }
  /** Whole messages read and not yet taken, for tests. */
  var queuedMessages: Int {
    state.lock()
    defer { state.unlock() }
    return messages.count
  }

  // ---- the opening ---------------------------------------------------------------

  func sendOpening(_ bytes: [UInt8]) throws {
    try usable()
    if isSecured { throw NearbyError(NearbyCode.OPENING_AFTER_SECURE, "the opening comes before secure") }
    try write(bytes)
  }

  /** Exactly `size` raw bytes, or nil at the deadline or once the other side has gone. */
  func receiveOpening(_ size: Int, deadlineMs: Int64) throws -> [UInt8]? {
    try usable()
    if isSecured { throw NearbyError(NearbyCode.OPENING_AFTER_SECURE, "the opening comes before secure") }
    if size < 0 || size > Frame.max { throw NearbyError(NearbyCode.BAD_ARGUMENT, "an opening's size") }
    var out = [UInt8](repeating: 0, count: size)
    let deadline = nowMs() + deadlineMs
    var at = 0
    defer { transport.setReadTimeout(0) }
    do {
      while at < size {
        let left = deadline - nowMs()
        if left <= 0 { return nil }
        transport.setReadTimeout(Int(min(left, Int64(Int32.max))))
        let n = try transport.read(&out, at, size - at)
        if n <= 0 { return nil }
        at += n
      }
      return out
    } catch {
      return nil
    }
  }

  /** Everything sealed from here on, both ways. Once per link. */
  func secure(_ sendKey: [UInt8], _ receiveKey: [UInt8]) throws {
    try usable()
    state.lock()
    if sealer.get != nil {
      state.unlock()
      throw NearbyError(NearbyCode.ALREADY_SECURED, "secure is once per link")
    }
    do {
      let s = try Sealer(sendKey)
      let o = try Opener(receiveKey)
      sealer.set(s)
      opener.set(o)
    } catch {
      state.unlock()
      throw error
    }
    state.unlock()
    let t = Thread { [self] in
      readLoop()
      readerDone.complete(())
    }
    t.name = "nearby-link-reader"
    reader.set(t)
    t.start()
  }

  // ---- messages ------------------------------------------------------------------

  /** Returns once written, so a slow link slows the sender. */
  func send(_ message: [UInt8]) throws {
    if message.count > Frame.max { throw NearbyError(NearbyCode.MESSAGE_TOO_LARGE, "over the frame ceiling") }
    try frame(Frame.message, message)
  }

  /**
   * The next whole message, in order; nil once the other side closed cleanly. Messages that came
   * before a goodbye are still given after the link ended, however soon the reader saw it.
   */
  func receive() throws -> [UInt8]? {
    if closedHere.get { throw NearbyError(NearbyCode.LINK_CLOSED, "closed here") }
    if !isSecured { throw NearbyError(NearbyCode.NOT_SECURED, "no frame is ever plain: secure first") }
    state.lock()
    defer { state.unlock() }
    while messages.isEmpty && ended.get == nil { state.wait() }
    if !messages.isEmpty {
      let m = messages.removeFirst()
      state.broadcast()
      return m
    }
    if clean.get && !closedHere.get { return nil }
    throw endedError()
  }

  // ---- files ---------------------------------------------------------------------

  func sendFile(_ transferId: String, _ file: URL, _ size: Int64) throws {
    try sealedOnly()
    if !Paths.inside(file, roots) { throw NearbyError(NearbyCode.FILE_UNREADABLE, "a file outside the app's folders") }
    let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
    let isFile = attrs?[.type] as? FileAttributeType == FileAttributeType.typeRegular
    let length = (attrs?[.size] as? NSNumber)?.int64Value ?? (attrs?[.size] as? Int64) ?? (attrs?[.size] as? UInt64).map { Int64(clamping: $0) } ?? -1
    if !isFile || length != size { throw NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "not the size given") }
    let out = Outgoing()
    state.lock()
    if outgoing[transferId] != nil {
      state.unlock()
      throw NearbyError(NearbyCode.TRANSFER_BUSY, "that transfer is running")
    }
    outgoing[transferId] = out
    state.unlock()
    defer {
      state.lock()
      outgoing.removeValue(forKey: transferId)
      state.unlock()
    }
    try frame(Frame.fileStart, try Frame.fileStartBody(transferId, UInt64(size)))
    let chunk = min(max(tune.fileChunk, 1024), Frame.max - 128)
    guard let input = try? FileHandle(forReadingFrom: file) else {
      cancelOut(transferId, Frame.unreadable)
      throw NearbyError(NearbyCode.FILE_UNREADABLE, "could not open the file")
    }
    defer { try? input.close() }
    var sent: Int64 = 0
    while true {
      try stopped(out)
      let data: Data
      do {
        data = try input.read(upToCount: chunk) ?? Data()
      } catch {
        cancelOut(transferId, Frame.unreadable)
        throw NearbyError(NearbyCode.FILE_UNREADABLE, "could not read the file")
      }
      if data.isEmpty { break }
      if sent + Int64(data.count) > size {
        cancelOut(transferId, Frame.unreadable)
        throw NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "the file grew")
      }
      try frame(Frame.fileData, try Frame.fileDataBody(transferId, data))
      sent += Int64(data.count)
    }
    if sent != size {
      cancelOut(transferId, Frame.unreadable)
      throw NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "the file shrank")
    }
    try stopped(out)
    try frame(Frame.fileEnd, try Frame.fileEndBody(transferId))
  }

  /** Into `staging` (a `.part` name in the app's folders); the size and SHA-256 once it is whole. */
  func receiveFile(_ transferId: String, _ staging: URL, maxBytes: Int64, minFreeBytes: Int64) throws -> PartWriter.Result {
    try sealedOnly()
    let writer = try PartWriter(staging, roots: roots, maxBytes: maxBytes, minFreeBytes: minFreeBytes, freeBytes: freeBytes)
    let held = Incoming(writer)
    state.lock()
    if ended.get != nil {
      state.unlock()
      throw endedError()
    }
    if incoming[transferId] != nil {
      state.unlock()
      throw NearbyError(NearbyCode.TRANSFER_BUSY, "that transfer is running")
    }
    skipped.remove(transferId)
    incoming[transferId] = held
    state.broadcast()
    state.unlock()
    do {
      return try held.done.get()
    } catch let e as NearbyError {
      throw e
    } catch {
      throw NearbyError(NearbyCode.INTERNAL, "the transfer failed")
    }
  }

  /** Stops a transfer either way, and tells the other side. */
  func cancelFile(_ transferId: String) {
    var tell = false
    state.lock()
    _ = outgoing[transferId]?.stop.compareAndSet(-1, LinkSession.local)
    let held = incoming.removeValue(forKey: transferId)
    skipped.insert(transferId)
    if let held {
      held.writer.discard()
      held.done.fail(NearbyError(NearbyCode.FILE_CANCELLED, "cancelled here"))
      tell = true
    }
    state.unlock()
    if tell, let body = try? Frame.fileCancelBody(transferId, Frame.cancelled) { try? frame(Frame.fileCancel, body) }
  }

  // ---- closing -------------------------------------------------------------------

  /**
   * A goodbye if there is time, then the stream goes. Every wait here ends. After the goodbye this
   * side stops writing and the reader drops what still comes until the other side closes too (or
   * `byeDrainMs` passes), so nothing is left unread to turn the close into a reset. No goodbye on a
   * link the other side has not proven: awdl and a hotspot hand up every connection under one
   * attempt's keys, so one sealed on a stranger's would repeat the real link's nonce under the same key.
   */
  func close() {
    if !closedHere.compareAndSet(false, true) { return }
    state.lock()
    state.broadcast()
    state.unlock()
    var said = false
    if let s = sealer.get, proven.get, ended.get == nil, writeLock.lock(before: dateIn(tune.byeWaitMs)) {
      do {
        try transport.write(try s.seal(Frame.bye, []))
        transport.shutdownOutput()
        said = true
      } catch {}
      writeLock.unlock()
    }
    if said, let r = reader.get, r !== Thread.current {
      _ = try? readerDone.get(ms: max(1, tune.byeDrainMs), timeout: NearbyCode.INTERNAL)
    }
    end(NearbyCode.LINK_CLOSED)
  }

  // ---- the reader ----------------------------------------------------------------

  private func readLoop() {
    guard let open = opener.get else { return }
    do {
      while true {
        if closedHere.get { return drain() }
        guard let head = try readFully(Frame.sealedHeader) else { return stop(NearbyCode.LINK_DROPPED) }
        let h = try open.header(head)
        guard let sealedBody = try readFully(h.len + Frame.tag) else { return stop(NearbyCode.LINK_DROPPED) }
        let body = try open.body(sealedBody)
        if !proven.get, let claim = firstProof.get, !claim() { return stop(NearbyCode.LINK_DROPPED) }
        proven.set(true)
        switch h.type {
        case Frame.message: queue(body)
        case Frame.fileStart: try fileStart(body)
        case Frame.fileData: try fileData(body)
        case Frame.fileEnd: try fileEnd(body)
        case Frame.fileCancel: try fileCancelled(body)
        case Frame.bye:
          clean.set(true)
          return stop(NearbyCode.LINK_DROPPED)
        // A frame type from a later build: sealed and checked, so skipped.
        default: break
        }
      }
    } catch let e as NearbyError {
      stop(e.code)
    } catch is TransportError {
      stop(NearbyCode.LINK_DROPPED)
    } catch {
      stop(NearbyCode.INTERNAL)
    }
  }

  /** The reader's end; once this side is closing, `close` ends the link itself. */
  private func stop(_ code: NearbyCode) {
    if !closedHere.get { end(code) }
  }

  /** After this side's goodbye: drops what still comes, until the other side's end or `close` closes the stream. */
  private func drain() {
    var sink = [UInt8](repeating: 0, count: 16 * 1024)
    while let n = try? transport.read(&sink, 0, sink.count), n > 0 {}
  }

  private func readFully(_ size: Int) throws -> [UInt8]? {
    var out = [UInt8](repeating: 0, count: size)
    var at = 0
    while at < size {
      let n = try transport.read(&out, at, size - at)
      if n <= 0 { return nil }
      at += n
    }
    return out
  }

  private func queue(_ message: [UInt8]) {
    state.lock()
    defer { state.unlock() }
    while messages.count >= max(1, tune.queueMessages) && ended.get == nil && !closedHere.get { state.wait() }
    if ended.get == nil && !closedHere.get {
      messages.append(message)
      state.broadcast()
    }
  }

  private func fileStart(_ body: [UInt8]) throws {
    let f = try Frame.readFileBody(body)
    if f.rest.count - f.restFrom != 8 { throw NearbyError(NearbyCode.LINK_DROPPED, "a broken file start") }
    // As the Kotlin reads it: a size past what a signed 64-bit number holds reads negative, and is refused as too big.
    let size = Int64(bitPattern: Bytes.readU64(f.rest, f.restFrom))
    let id = f.transferId
    state.lock()
    // JavaScript registers before it asks, so this wait is short; past it, the file is refused.
    let deadline = nowMs() + tune.fileWaitMs
    while incoming[id] == nil && !skipped.contains(id) && ended.get == nil && !closedHere.get {
      let left = deadline - nowMs()
      if left <= 0 { break }
      _ = state.wait(until: dateIn(left))
    }
    let held = incoming[id].flatMap { $0.started ? nil : $0 }
    state.unlock()
    guard let held else {
      state.lock()
      skipped.insert(id)
      state.unlock()
      return cancelOut(id, Frame.unwanted)
    }
    do {
      try held.writer.begin(size)
      held.started = true
    } catch let e as NearbyError {
      failIncoming(id, held, e, tell: true)
    }
  }

  private func fileData(_ body: [UInt8]) throws {
    let f = try Frame.readFileBody(body)
    state.lock()
    let held = skipped.contains(f.transferId) ? nil : incoming[f.transferId]
    state.unlock()
    guard let held else { return }
    if !held.started {
      return failIncoming(f.transferId, held, NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "data before its start"), tell: true)
    }
    do {
      try held.writer.write(f.rest, from: f.restFrom, count: f.rest.count - f.restFrom)
    } catch let e as NearbyError {
      failIncoming(f.transferId, held, e, tell: true)
    }
  }

  private func fileEnd(_ body: [UInt8]) throws {
    let f = try Frame.readFileBody(body)
    state.lock()
    let held = skipped.contains(f.transferId) ? nil : incoming.removeValue(forKey: f.transferId)
    state.unlock()
    guard let held else { return }
    do {
      if !held.started { throw NearbyError(NearbyCode.FILE_SIZE_MISMATCH, "an end before its start") }
      held.done.complete(try held.writer.finish())
    } catch {
      held.writer.discard()
      held.done.fail(error as? NearbyError ?? NearbyError(NearbyCode.INTERNAL, "the transfer failed"))
    }
  }

  private func fileCancelled(_ body: [UInt8]) throws {
    let f = try Frame.readFileBody(body)
    let reason = f.rest.count > f.restFrom ? Int(f.rest[f.restFrom]) : Int(Frame.cancelled)
    state.lock()
    _ = outgoing[f.transferId]?.stop.compareAndSet(-1, reason)
    let held = incoming.removeValue(forKey: f.transferId)
    state.unlock()
    if let held {
      held.writer.discard()
      held.done.fail(NearbyError(NearbyCode.FILE_CANCELLED, "the other side stopped sending"))
    }
  }

  private func failIncoming(_ id: String, _ held: Incoming, _ e: NearbyError, tell: Bool) {
    state.lock()
    incoming.removeValue(forKey: id)
    skipped.insert(id)
    state.unlock()
    held.writer.discard()
    held.done.fail(e)
    if tell { cancelOut(id, reasonOf(e.code)) }
  }

  private func reasonOf(_ code: NearbyCode) -> UInt8 {
    switch code {
    case NearbyCode.FILE_TOO_BIG: return Frame.tooBig
    case NearbyCode.FILE_NO_SPACE: return Frame.noSpace
    default: return Frame.cancelled
    }
  }

  private func cancelOut(_ id: String, _ reason: UInt8) {
    guard let body = try? Frame.fileCancelBody(id, reason) else { return }
    try? frame(Frame.fileCancel, body)
  }

  private func stopped(_ out: Outgoing) throws {
    if ended.get != nil { throw endedError() }
    let why = out.stop.get
    switch why {
    case -1: return
    case LinkSession.local: throw NearbyError(NearbyCode.FILE_CANCELLED, "cancelled here")
    case Int(Frame.tooBig): throw NearbyError(NearbyCode.FILE_REFUSED, "the other side refused it: too big")
    case Int(Frame.noSpace): throw NearbyError(NearbyCode.FILE_REFUSED, "the other side refused it: no room")
    default: throw NearbyError(NearbyCode.FILE_REFUSED, "the other side refused it (\(why))")
    }
  }

  // ---- the plumbing --------------------------------------------------------------

  private func frame(_ type: UInt8, _ body: [UInt8]) throws {
    try sealedOnly()
    writeLock.lock()
    defer { writeLock.unlock() }
    if ended.get != nil { throw endedError() }
    guard let s = sealer.get else { throw NearbyError(NearbyCode.NOT_SECURED, "no frame is ever plain: secure first") }
    // Sealed under the lock, so the order of nonces is the order on the wire. A link that ended
    // since the check above has forgotten its keys, and the sealer refuses: the link's own end.
    let bytes: [UInt8]
    do {
      bytes = try s.seal(type, body)
    } catch {
      if ended.get != nil { throw endedError() }
      throw error
    }
    do {
      try transport.write(bytes)
    } catch {
      end(closedHere.get ? NearbyCode.LINK_CLOSED : NearbyCode.LINK_DROPPED)
      throw endedError()
    }
  }

  private func write(_ bytes: [UInt8]) throws {
    writeLock.lock()
    defer { writeLock.unlock() }
    do {
      try transport.write(bytes)
    } catch {
      end(NearbyCode.LINK_DROPPED)
      throw endedError()
    }
  }

  private func usable() throws {
    if closedHere.get { throw NearbyError(NearbyCode.LINK_CLOSED, "closed here") }
    if ended.get != nil { throw endedError() }
  }

  private func sealedOnly() throws {
    try usable()
    if !isSecured { throw NearbyError(NearbyCode.NOT_SECURED, "no frame is ever plain: secure first") }
  }

  /** Always a drop code, so JavaScript reads a call on a link that went as a drop; `onEnded` says how it went. */
  private func endedError() -> NearbyError {
    if closedHere.get { return NearbyError(NearbyCode.LINK_CLOSED, "closed here") }
    let code = ended.get.flatMap { DROP_CODES.contains($0) ? $0 : nil } ?? NearbyCode.LINK_DROPPED
    return NearbyError(code, clean.get ? "the other side closed the link" : "the link went")
  }

  /** Once: every wait ends, keys are forgotten, the stream closes. */
  private func end(_ code: NearbyCode) {
    state.lock()
    if ended.get != nil {
      state.unlock()
      return
    }
    ended.set(code)
    let pending = Array(incoming.values)
    incoming.removeAll()
    for o in outgoing.values { _ = o.stop.compareAndSet(-1, LinkSession.local) }
    state.broadcast()
    state.unlock()
    for held in pending {
      held.writer.discard()
      held.done.fail(NearbyError(closedHere.get ? NearbyCode.LINK_CLOSED : NearbyCode.LINK_DROPPED, "the link went during the file"))
    }
    // Not under `writeLock`: a writer blocked in a full stream holds it until `transport.close`
    // below fails its write. Each key's own lock makes the forget wait for a seal or open in
    // progress, and both refuse from then on.
    sealer.get?.forget()
    opener.get?.forget()
    firstProof.set(nil)
    transport.close()
    onEnded(self, code)
  }
}
