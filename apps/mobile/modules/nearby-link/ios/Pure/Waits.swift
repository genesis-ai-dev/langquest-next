import Foundation

/** Milliseconds on a clock that never goes back, for deadlines. */
func nowMs() -> Int64 { Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000) }

/** A `Date` `ms` from now, for the waits Foundation's locks take. */
func dateIn(_ ms: Int64) -> Date { Date(timeIntervalSinceNow: Double(max(0, ms)) / 1000) }

/**
 * One answer, given once, that any thread may wait for: what `CompletableFuture` is to the Kotlin.
 * A wait with a deadline throws the code it is given when the deadline passes first.
 */
final class Future<T> {
  private let cond = NSCondition()
  private var result: Result<T, Error>?

  /** False when it already had an answer. */
  @discardableResult
  func complete(_ value: T) -> Bool { settle(.success(value)) }

  @discardableResult
  func fail(_ error: Error) -> Bool { settle(.failure(error)) }

  private func settle(_ r: Result<T, Error>) -> Bool {
    cond.lock()
    defer { cond.unlock() }
    if result != nil { return false }
    result = r
    cond.broadcast()
    return true
  }

  var isDone: Bool {
    cond.lock()
    defer { cond.unlock() }
    return result != nil
  }

  /** Waits for ever. */
  func get() throws -> T {
    cond.lock()
    while result == nil { cond.wait() }
    let r = result!
    cond.unlock()
    return try r.get()
  }

  /** Waits until `ms` from now, then throws `timeout`. */
  func get(ms: Int64, timeout: NearbyCode) throws -> T {
    let deadline = dateIn(ms)
    cond.lock()
    while result == nil {
      if !cond.wait(until: deadline) && result == nil {
        cond.unlock()
        throw NearbyError(timeout, "no answer by the deadline")
      }
    }
    let r = result!
    cond.unlock()
    return try r.get()
  }
}

/** A value read and written under its own lock, which never calls out: what `@Volatile` and the atomics are to the Kotlin. */
final class Locked<T> {
  private let lock = NSLock()
  private var value: T

  init(_ value: T) { self.value = value }

  var get: T {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func set(_ v: T) {
    lock.lock()
    value = v
    lock.unlock()
  }

  /** Runs `change` under the lock and returns what it returns. */
  @discardableResult
  func with<R>(_ change: (inout T) -> R) -> R {
    lock.lock()
    defer { lock.unlock() }
    return change(&value)
  }
}

extension Locked where T: Equatable {
  /** True when it was `expect` and is now `to`. */
  func compareAndSet(_ expect: T, _ to: T) -> Bool {
    with { v in
      if v != expect { return false }
      v = to
      return true
    }
  }
}

/** Sleeps the calling thread; only background threads that are waiting anyway call it. */
func pause(_ ms: Int64) { Thread.sleep(forTimeInterval: Double(ms) / 1000) }
