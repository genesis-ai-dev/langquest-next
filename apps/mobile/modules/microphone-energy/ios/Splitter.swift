import Foundation

/**
 * Where one part ends and the next begins (LAN-82): a line-for-line port of
 * src/splitter.ts, which the web module and the tests run. Keep the two in
 * step. Nothing said is dropped; the rules only choose where parts split,
 * from two levels learned while listening: the room (the quietest stretch of
 * the last 8 s) and the voice (how loud this person usually is here).
 */
final class Splitter {
    struct Heard { let room: Double; let voice: Double; let pause: Double }
    struct Levels { let room: Double; let quiet: Double; let start: Double; let voice: Double; let pause: Double }
    enum Action {
        /// A part starts `headFrames` frames back, counting the frame just given.
        case start(headFrames: Int)
        /// A part ends; `trimMs` after its last sound goes. `discard`: only a tap or a bump.
        case stop(discard: Bool, trimMs: Int)
    }

    static let roomWindowMs = 8000.0
    static let roomGuess = -50.0
    static let voiceGuessOverRoom = 24.0
    static let startShare = 0.5
    static let startMin = 10.0
    static let quietShare = 0.25
    static let quietMin = 6.0
    static let softStartMs = 300.0
    static let headGapMs = 300.0
    static let headMarginMs = 140.0
    static let maxHeadMs = 3000.0
    static let tailMs = 300.0
    static let minSoundMs = 120.0
    static let pauseMs = 1000.0
    static let maxPauseMs = 2500.0
    static let minGapMs = 150.0
    static let learnAfterGaps = 8
    /// Exact silence this long is the room (a quiet line, a noise gate); shorter, it is a microphone starting.
    static let zeroRoomMs = 500.0

    /// A frame's peak (0..1) in dB, -60..0.
    static func levelDb(_ energy: Double) -> Double { max(-60, min(0, 20 * log10(max(energy, 1e-6)))) }

    private struct Frame { let t: Double; let db: Double }
    let frameMs: Double
    private var history: [Frame] = []
    private var calm: [Frame] = []
    private var roomDb: Double
    private var voiceDb: Double?
    private var pause: Double
    private var gaps: [Double] = []
    private(set) var open = false
    private var lastSound = 0.0
    private var soundMs = 0.0
    private var partDbs: [Double] = []
    private var quietSince: Double?
    private var lastEnd = -Double.infinity
    /// How long the 3-frame median has been exact silence (-60 dB).
    private var zeroMs = 0.0

    init(frameMs: Double, remembered: Heard?) {
        self.frameMs = frameMs
        roomDb = remembered?.room ?? Splitter.roomGuess
        voiceDb = remembered?.voice
        pause = remembered?.pause ?? Splitter.pauseMs
    }

    func levels() -> Levels {
        let room = roomDb
        let voice = max(voiceDb ?? room + Splitter.voiceGuessOverRoom, room + Splitter.startMin)
        let span = voice - room
        return Levels(room: room, quiet: room + max(Splitter.quietMin, Splitter.quietShare * span),
                      start: room + max(Splitter.startMin, Splitter.startShare * span), voice: voice, pause: pause)
    }

    func remember() -> Heard {
        let l = levels()
        return Heard(room: (l.room * 10).rounded() / 10, voice: (l.voice * 10).rounded() / 10, pause: l.pause.rounded())
    }

    /// The detector stopped (the source plays, or the session ended): nothing heard meanwhile heads a part.
    func pauseListening() { open = false; history.removeAll(); quietSince = nil; zeroMs = 0 }

    /// One frame's energy (0..1 peak) at `now` (ms, the frame's end).
    func step(energy: Double, now: Double) -> Action? {
        let db = Splitter.levelDb(energy)
        history.append(Frame(t: now, db: db))
        let keepFrom = now - Splitter.maxHeadMs - Splitter.headMarginMs - frameMs
        while let first = history.first, first.t < keepFrom { history.removeFirst() }
        trackRoom(now)
        let l = levels()
        if !open { return (db > l.start || softRun(l.quiet) >= Splitter.softStartMs) ? begin(now, quiet: l.quiet) : nil }
        if db > l.quiet {
            if let since = quietSince { let gap = now - frameMs - since; if gap >= Splitter.minGapMs { learnGap(gap) } }
            quietSince = nil
            lastSound = now; soundMs += frameMs; partDbs.append(db)
            return nil
        }
        if quietSince == nil { quietSince = now - frameMs }
        if now - lastSound < pause { return nil }
        return end(now)
    }

    /// The session ends with a part open: what to keep of it.
    func finish(now: Double) -> Action? { open ? end(now) : nil }

    private func begin(_ now: Double, quiet: Double) -> Action {
        let h = history
        var firstOut = h.count - 1
        var dip = 0.0
        var i = h.count - 2
        while i >= 0 {
            let f = h[i]
            if f.t <= lastEnd || now - f.t > Splitter.maxHeadMs { break }
            if f.db > quiet { firstOut = i; dip = 0 } else { dip += frameMs; if dip > Splitter.headGapMs { break } }
            i -= 1
        }
        var head = firstOut
        let margin = Int((Splitter.headMarginMs / frameMs).rounded())
        var m = 0
        while m < margin && head > 0 && h[head - 1].t > lastEnd { head -= 1; m += 1 }
        open = true; lastSound = now; quietSince = nil; partDbs = []; soundMs = 0
        for k in head..<h.count where h[k].db > quiet { soundMs += frameMs; partDbs.append(h[k].db) }
        return .start(headFrames: h.count - head)
    }

    private func end(_ now: Double) -> Action {
        open = false
        let keepUntil = min(now, lastSound + Splitter.tailMs)
        lastEnd = keepUntil; quietSince = nil
        let discard = soundMs < Splitter.minSoundMs
        if !discard { learnVoice() }
        return .stop(discard: discard, trimMs: max(0, Int((now - keepUntil).rounded())))
    }

    private func softRun(_ quiet: Double) -> Double {
        var run = 0.0, dip = 0.0
        for f in history.reversed() {
            if f.t <= lastEnd { break }
            if f.db > quiet { run += frameMs; dip = 0 } else { dip += frameMs; if dip > Splitter.headGapMs / 2 { break } }
        }
        return run
    }

    /// The room: the quietest 3-frame median of the last few seconds. Exact silence is the room only once it has lasted zeroRoomMs.
    private func trackRoom(_ now: Double) {
        if history.count >= 3 {
            let median = history.suffix(3).map { $0.db }.sorted()[1]
            zeroMs = median <= -59.5 ? zeroMs + frameMs : 0
            if median > -59.5 || zeroMs >= Splitter.zeroRoomMs { calm.append(Frame(t: now, db: median)) }
        }
        while let first = calm.first, now - first.t > Splitter.roomWindowMs { calm.removeFirst() }
        guard let first = calm.first, let lowest = calm.map({ $0.db }).min() else { return }
        roomDb = now - first.t < Splitter.roomWindowMs / 2 ? min(lowest, roomDb + 3) : lowest
    }

    private func learnVoice() {
        if Double(partDbs.count) * frameMs < 400 { return }
        let sorted = partDbs.sorted()
        let loud = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.75))]
        voiceDb = voiceDb.map { 0.7 * $0 + 0.3 * loud } ?? loud
    }

    private func learnGap(_ gap: Double) {
        gaps.append(gap)
        if gaps.count > 30 { gaps.removeFirst() }
        if gaps.count < Splitter.learnAfterGaps { return }
        let sorted = gaps.sorted()
        let usual = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.9))]
        pause = max(Splitter.pauseMs, min(Splitter.maxPauseMs, (usual * 1.5).rounded()))
    }
}
