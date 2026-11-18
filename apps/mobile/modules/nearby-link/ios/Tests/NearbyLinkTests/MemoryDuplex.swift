import Foundation
@testable import NearbyLink

/**
 * One direction of an in-memory stream with a socket's manners: a writer waits while the buffer is
 * full, a reader waits while it is empty, the end comes once the writer closed and the buffer is
 * read, and a writer to a closed reader fails. The tests run `LinkSession` and `Hosted` over these
 * pairs as the Kotlin's run over loopback sockets.
 */
final class OneWay {
  private let cond = NSCondition()
  private var buffer: [UInt8] = []
  private var head = 0
  private let capacity: Int
  private var writerClosed = false
  private var readerClosed = false

  init(capacity: Int) { self.capacity = capacity }

  func write(_ bytes: [UInt8]) throws {
    cond.lock()
    defer { cond.unlock() }
    var at = 0
    while at < bytes.count {
      if readerClosed || writerClosed { throw TransportError.broken("closed") }
      let room = capacity - (buffer.count - head)
      if room <= 0 {
        cond.wait()
        continue
      }
      let n = min(room, bytes.count - at)
      buffer.append(contentsOf: bytes[at..<(at + n)])
      at += n
      cond.broadcast()
    }
  }

  func read(_ out: inout [UInt8], _ off: Int, _ len: Int, timeoutMs: Int) throws -> Int {
    if len == 0 { return 0 }
    cond.lock()
    defer { cond.unlock() }
    let deadline: Date? = timeoutMs > 0 ? dateIn(Int64(timeoutMs)) : nil
    while buffer.count == head && !writerClosed && !readerClosed {
      if let d = deadline {
        if !cond.wait(until: d) && buffer.count == head && !writerClosed && !readerClosed { throw TransportError.timeout }
      } else {
        cond.wait()
      }
    }
    if readerClosed { throw TransportError.broken("closed here") }
    let n = min(len, buffer.count - head)
    if n == 0 { return 0 }
    for i in 0..<n { out[off + i] = buffer[head + i] }
    head += n
    if head > 64 * 1024 && head * 2 > buffer.count {
      buffer.removeFirst(head)
      head = 0
    }
    cond.broadcast()
    return n
  }

  func closeWriter() {
    cond.lock()
    writerClosed = true
    cond.broadcast()
    cond.unlock()
  }

  func closeReader() {
    cond.lock()
    readerClosed = true
    cond.broadcast()
    cond.unlock()
  }
}

/** One end of an in-memory duplex stream. */
final class MemoryEnd: Transport {
  let inbound: OneWay
  let outbound: OneWay
  private let timeout = Locked(0)

  init(inbound: OneWay, outbound: OneWay) {
    self.inbound = inbound
    self.outbound = outbound
  }

  static func pair(capacity: Int = 256 * 1024) -> (MemoryEnd, MemoryEnd) {
    let ab = OneWay(capacity: capacity)
    let ba = OneWay(capacity: capacity)
    return (MemoryEnd(inbound: ba, outbound: ab), MemoryEnd(inbound: ab, outbound: ba))
  }

  func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int {
    try inbound.read(&buffer, offset, count, timeoutMs: timeout.get)
  }

  func write(_ bytes: [UInt8]) throws { try outbound.write(bytes) }
  func setReadTimeout(_ ms: Int) { timeout.set(ms) }
  func shutdownOutput() { outbound.closeWriter() }

  func close() {
    inbound.closeReader()
    outbound.closeWriter()
  }
}
