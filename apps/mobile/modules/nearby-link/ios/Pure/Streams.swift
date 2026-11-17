import Foundation

/**
 * Streams under a `LinkSession` (docs/nearby-sync-plan.md 5.12), as `Streams.kt` has them: a
 * socket gives its own, and a Bluetooth pipe gives these. A pipe is one byte stream cut into GATT
 * values of `min(mtu - 3, 512)` bytes, in order, with nothing added, so a value carries only the
 * opening's raw bytes or sealed frames. Pure: the package's XCTest runs them.
 */
enum GattChunks {
  /** A GATT attribute holds at most 512 bytes, whatever the MTU. */
  static let valueMax = 512

  static func sizeFor(_ mtu: Int) throws -> Int {
    let size = min(mtu - 3, valueMax)
    if size < 1 { throw NearbyError(NearbyCode.BAD_ARGUMENT, "an MTU leaves no room") }
    return size
  }

  static func split(_ bytes: [UInt8], _ mtu: Int) throws -> [[UInt8]] {
    let size = try sizeFor(mtu)
    var out: [[UInt8]] = []
    out.reserveCapacity((bytes.count + size - 1) / size)
    var at = 0
    while at < bytes.count {
      let end = min(bytes.count, at + size)
      out.append(Array(bytes[at..<end]))
      at = end
    }
    return out
  }
}

/** How a stream under a link fails: a read past its timeout, or a stream that broke. */
enum TransportError: Error {
  case timeout
  case broken(String)
}

/** A stream a link can read with a deadline: a socket's, or a `ByteQueue`'s. */
protocol Transport: AnyObject {
  /** At least one byte and at most `count` into `buffer` from `offset`; 0 once the other side has ended. Throws `TransportError`. */
  func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int
  /** Every byte, handed on before it returns. Throws `TransportError.broken` once the stream went. */
  func write(_ bytes: [UInt8]) throws
  /** 0 waits for ever. */
  func setReadTimeout(_ ms: Int)
  /** No more bytes from this side; the other side reads to its end. A pipe has nothing to do here. */
  func shutdownOutput()
  func close()
}

/**
 * A GATT server's pipes, by device. Not locked: its owner holds its own lock. A pipe that ends
 * removes itself only (`remove(_:end:)`), because the device may have reconnected since and hold a
 * newer pipe under the same name.
 */
final class PipeEnds<E: AnyObject> {
  private var byAddress: [String: E] = [:]

  subscript(address: String) -> E? { byAddress[address] }
  func has(_ address: String) -> Bool { byAddress[address] != nil }
  func put(_ address: String, _ end: E) { byAddress[address] = end }

  /** Whatever pipe the device holds now: for what the system says about the device itself. */
  @discardableResult
  func remove(_ address: String) -> E? { byAddress.removeValue(forKey: address) }

  /** This pipe only, if it is still the one at its address. */
  func remove(_ address: String, end: E) -> Bool {
    guard let held = byAddress[address], held === end else { return false }
    byAddress.removeValue(forKey: address)
    return true
  }

  func takeAll() -> [E] {
    let all = Array(byAddress.values)
    byAddress.removeAll()
    return all
  }
}

/**
 * Bytes that arrive by GATT, read in order as a stream. Holds at most `capacity` bytes; past that
 * the pipe is broken, since only a hostile or broken peer floods it (a pipe carries events only).
 * `onDrained` lets a GATT server answer a held write once a reader made room.
 */
final class ByteQueue {
  private let capacity: Int
  private let onDrained: () -> Void
  private let cond = NSCondition()
  private var chunks: [[UInt8]] = []
  /** The first chunk not yet read whole, and how far into it. */
  private var first = 0
  private var head = 0
  private var held = 0
  private var ended = false
  private var broken: String?
  private var timeout = 0

  init(_ capacity: Int, onDrained: @escaping () -> Void = {}) {
    self.capacity = capacity
    self.onDrained = onDrained
  }

  var timeoutMs: Int {
    get { cond.lock(); defer { cond.unlock() }; return timeout }
    set { cond.lock(); timeout = newValue; cond.unlock() }
  }

  var size: Int {
    cond.lock()
    defer { cond.unlock() }
    return held
  }

  /** False when it would pass `capacity`: the pipe is then broken. */
  func offer(_ bytes: [UInt8]) -> Bool {
    cond.lock()
    defer { cond.unlock() }
    if ended || broken != nil { return false }
    if held + bytes.count > capacity {
      broken = "the pipe overflowed"
      cond.broadcast()
      return false
    }
    if !bytes.isEmpty { chunks.append(bytes) }
    held += bytes.count
    cond.broadcast()
    return true
  }

  /** No more bytes: a reader gets what is left, then the end. */
  func end() {
    cond.lock()
    ended = true
    cond.broadcast()
    cond.unlock()
  }

  /** At least one byte, at most `len`; 0 at the end; throws on a break or past the timeout. */
  func read(_ out: inout [UInt8], _ off: Int, _ len: Int) throws -> Int {
    if len == 0 { return 0 }
    var n = 0
    cond.lock()
    let deadline: Date? = timeout > 0 ? dateIn(Int64(timeout)) : nil
    while held == 0 && !ended && broken == nil {
      if let d = deadline {
        if !cond.wait(until: d) && held == 0 && !ended && broken == nil {
          cond.unlock()
          throw TransportError.timeout
        }
      } else {
        cond.wait()
      }
    }
    if held == 0 {
      let why = broken
      cond.unlock()
      if let why { throw TransportError.broken(why) }
      return 0
    }
    while n < len && first < chunks.count {
      let c = chunks[first]
      let take = min(len - n, c.count - head)
      out.withUnsafeMutableBufferPointer { dst in
        c.withUnsafeBufferPointer { src in
          (dst.baseAddress! + off + n).update(from: src.baseAddress! + head, count: take)
        }
      }
      n += take
      head += take
      if head == c.count {
        chunks[first] = []
        first += 1
        head = 0
      }
    }
    if first > 64 && first * 2 > chunks.count {
      chunks.removeFirst(first)
      first = 0
    }
    held -= n
    cond.unlock()
    onDrained()
    return n
  }
}

/**
 * Writes a pipe's stream as GATT values, one outstanding at a time: `send` returns once the value
 * was taken (a write's response, or a notification the stack accepted), which is the pipe's flow
 * control. `mtu` is read at each write, since it settles after the pipe opens.
 */
final class ChunkedWriter {
  private let mtu: () -> Int
  private let send: ([UInt8]) throws -> Void

  init(mtu: @escaping () -> Int, send: @escaping ([UInt8]) throws -> Void) {
    self.mtu = mtu
    self.send = send
  }

  func write(_ b: [UInt8]) throws {
    var at = 0
    while at < b.count {
      let size = min(try GattChunks.sizeFor(mtu()), b.count - at)
      try send(Array(b[at..<(at + size)]))
      at += size
    }
  }
}

/** A pipe's stream for a `LinkSession`: bytes in from a `ByteQueue`, out as acknowledged GATT values. */
final class PipeTransport: Transport {
  private let queue: ByteQueue
  private let writer: ChunkedWriter
  private let onClose: () -> Void

  init(queue: ByteQueue, mtu: @escaping () -> Int, send: @escaping ([UInt8]) throws -> Void, onClose: @escaping () -> Void) {
    self.queue = queue
    writer = ChunkedWriter(mtu: mtu, send: send)
    self.onClose = onClose
  }

  func read(_ buffer: inout [UInt8], _ offset: Int, _ count: Int) throws -> Int { try queue.read(&buffer, offset, count) }

  func write(_ bytes: [UInt8]) throws {
    do {
      try writer.write(bytes)
    } catch let e as TransportError {
      throw e
    } catch {
      throw TransportError.broken("the pipe went")
    }
  }

  func setReadTimeout(_ ms: Int) { queue.timeoutMs = ms }

  func shutdownOutput() {}

  func close() {
    queue.end()
    onClose()
  }
}
