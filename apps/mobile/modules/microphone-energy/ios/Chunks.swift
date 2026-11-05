import Foundation

/**
 * What of a recording session is kept on storage, and where each part is in
 * it (LAN-82): a line-for-line port of src/chunks.ts, which the web module
 * and the tests run. Keep the two in step. A chunk file opens when a part
 * starts, with up to padMs of the room before the part's head, and closes
 * padMs after the last part in it ended, so a part's edges can be moved out
 * into the room around it until the session is left, while a long silence
 * is never written. While the silence switch is on (`keepRoom`, decision
 * 192) a chunk stays open through every pause until the detector stops. The
 * module does the writing, in this order for each frame: the ring, the open
 * chunk's file, the splitter, then these actions.
 */
final class Chunks {
    enum Action: Equatable {
        /// Open a chunk file with the ring's last `frames` frames, the frame just heard included.
        case open(frames: Int)
        /// A part is kept: samples [from, to) of the open chunk.
        case mark(from: Int, to: Int)
        /// The chunk ends: finish its file, or delete it when no part in it was kept.
        case close(keep: Bool)
    }

    /// The room kept on each side of what was said (ms).
    static let padMs = 2000.0

    /// Frames the module's ring holds: a part's longest head and the room before it.
    static func ringFrames(_ frameMs: Double) -> Int {
        Int(((Splitter.maxHeadMs + Splitter.headMarginMs + padMs) / frameMs).rounded(.up)) + 2
    }

    private let frameMs: Double
    private let sampleRate: Int
    /// How many samples each frame in the module's ring holds, oldest first.
    private var ring: [Int] = []
    let ringSize: Int
    private let padFrames: Int
    private var open = false
    /// Samples in the open chunk so far, the frame just heard included.
    private var written = 0
    /// Where the part being said starts in the open chunk; nil between parts.
    private var partFrom: Int?
    private var kept = 0
    /// When the last part ended (ms, the splitter's clock): the chunk keeps padMs after it.
    private var endedAt = -Double.infinity
    /// The silence switch (decision 194): an open chunk does not close after a part; the module sets it whenever it changes.
    var keepRoom = false

    init(frameMs: Double, sampleRate: Int) {
        self.frameMs = frameMs
        self.sampleRate = sampleRate
        ringSize = Chunks.ringFrames(frameMs)
        padFrames = Int((Chunks.padMs / frameMs).rounded())
    }

    /// One frame of `samples` samples, heard at `now` (ms), and what the splitter said of it.
    func step(samples: Int, action: Splitter.Action?, now: Double) -> [Action] {
        var out: [Action] = []
        ring.append(samples)
        if ring.count > ringSize { ring.removeFirst() }
        if open { written += samples }
        switch action {
        case .start(let headFrames):
            if !open {
                let frames = min(ring.count, headFrames + padFrames)
                open = true
                kept = 0
                written = last(frames)
                out.append(.open(frames: frames))
            }
            partFrom = max(0, written - last(headFrames))
        case .stop(let discard, let trimMs):
            if let from = partFrom {
                if !discard {
                    let trim = Int((Double(trimMs) * Double(sampleRate) / 1000).rounded())
                    out.append(.mark(from: from, to: max(from + 1, written - trim)))
                    kept += 1
                }
                partFrom = nil
                endedAt = now - Double(trimMs)
            }
        case .none:
            break
        }
        if open && partFrom == nil && !keepRoom && now - endedAt >= Chunks.padMs { out.append(close()) }
        return out
    }

    /// The detector stops (recording stopped, or the source is about to play):
    /// a part still being said is kept to the end of what was heard, and the
    /// chunk closes. The module's ring starts empty when it listens again.
    func stop() -> [Action] {
        var out: [Action] = []
        if open {
            if let from = partFrom {
                out.append(.mark(from: from, to: max(from + 1, written)))
                kept += 1
                partFrom = nil
            }
            out.append(close())
        }
        ring.removeAll()
        partFrom = nil
        endedAt = -Double.infinity
        return out
    }

    private func close() -> Action {
        let keep = kept > 0
        open = false
        written = 0
        kept = 0
        return .close(keep: keep)
    }

    /// Samples in the ring's last `frames` frames.
    private func last(_ frames: Int) -> Int {
        var n = 0
        for i in max(0, ring.count - frames)..<ring.count { n += ring[i] }
        return n
    }
}
