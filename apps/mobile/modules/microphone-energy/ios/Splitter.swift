import Foundation

/**
 * Where one part ends and the next begins (LAN-82): a line-for-line port of
 * src/splitter.ts, which the web module and the tests run. Keep the two in
 * step. Nothing said is dropped; the rules only choose where parts split,
 * from two levels learned while listening: the room and the voice. Where the
 * speech model scores each frame (Speech.swift, decision 135), a part is only
 * sound that is both out of the room and speech.
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
    static let roomPercentile = 0.2
    static let roomUnderPartDb = 10.0
    static let trustNowMs = 600.0
    static let endMedianFrames = 5
    static let speechOn = 0.5
    static let speechOff = 0.35
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
    /// While a part is open the room rises at most this fast (dB a second), so speech never becomes the room.
    static let roomRisePerSec = 1.5

    /// A frame's peak (0..1) in dB, -60..0.
    static func levelDb(_ energy: Double) -> Double { max(-60, min(0, 20 * log10(max(energy, 1e-6)))) }

    /// The p-th quantile (0..1) of values, as splitter.ts takes it.
    private static func quantile(_ values: [Double], _ p: Double) -> Double {
        let sorted = values.sorted()
        return sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]
    }

    /// A frame heard: when (ms), its level (dB), and the speech model's score (nil: no model).
    private struct Frame { let t: Double; let db: Double; let s: Double? }
    private struct Calm { let t: Double; let db: Double }
    let frameMs: Double
    private var history: [Frame] = []
    private var calm: [Calm] = []
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
    /// How long this has listened since it last started (for trusting the room heard now).
    private var listenedMs = 0.0

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
    func pauseListening() { open = false; history.removeAll(); quietSince = nil; zeroMs = 0; listenedMs = 0 }

    /// One frame's energy (0..1 peak) at `now` (ms, the frame's end), and the speech model's score for it, or nil.
    func step(energy: Double, now: Double, speech: Double? = nil) -> Action? {
        let db = Splitter.levelDb(energy)
        history.append(Frame(t: now, db: db, s: speech))
        let keepFrom = now - Splitter.maxHeadMs - Splitter.headMarginMs - frameMs
        while let first = history.first, first.t < keepFrom { history.removeFirst() }
        trackRoom(now)
        listenedMs += frameMs
        let l = levels()
        if !open { return ((db > l.start || softRun(l.quiet) >= Splitter.softStartMs) && speaking()) ? begin(now, quiet: l.quiet) : nil }
        // With a model: back in the room on the median of the last few frames, or no longer speech.
        var out = db > l.quiet
        if let s = speech {
            let recent = history.suffix(Splitter.endMedianFrames).map { $0.db }.sorted()
            out = recent[(recent.count - 1) / 2] > l.quiet && s >= Splitter.speechOff
        }
        if out {
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

    /// Where a model scores frames, two of the last three are speech; with none, any sound may start a part.
    private func speaking() -> Bool {
        let last = history.suffix(3)
        guard let newest = last.last, newest.s != nil else { return true }
        return last.filter { ($0.s ?? 0) >= Splitter.speechOn }.count >= 2
    }

    /// Out of the room, and speech where a model says.
    private func heard(_ f: Frame, _ quiet: Double) -> Bool { f.db > quiet && (f.s == nil || f.s! >= Splitter.speechOff) }

    private func begin(_ now: Double, quiet: Double) -> Action {
        let h = history
        var firstOut = h.count - 1
        var dip = 0.0
        var i = h.count - 2
        while i >= 0 {
            let f = h[i]
            if f.t <= lastEnd || now - f.t > Splitter.maxHeadMs { break }
            if heard(f, quiet) { firstOut = i; dip = 0 } else { dip += frameMs; if dip > Splitter.headGapMs { break } }
            i -= 1
        }
        var head = firstOut
        let margin = Int((Splitter.headMarginMs / frameMs).rounded())
        var m = 0
        while m < margin && head > 0 && h[head - 1].t > lastEnd { head -= 1; m += 1 }
        open = true; lastSound = now; quietSince = nil; partDbs = []; soundMs = 0
        for k in head..<h.count where heard(h[k], quiet) { soundMs += frameMs; partDbs.append(h[k].db) }
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
            if heard(f, quiet) { run += frameMs; dip = 0 } else { dip += frameMs; if dip > Splitter.headGapMs / 2 { break } }
        }
        return run
    }

    /// The room, from the 3-frame medians of the last few seconds: the quietest, or with a speech model the level only a fifth fall under.
    private func trackRoom(_ now: Double) {
        if history.count >= 3 {
            let median = history.suffix(3).map { $0.db }.sorted()[1]
            zeroMs = median <= -59.5 ? zeroMs + frameMs : 0
            if median > -59.5 || zeroMs >= Splitter.zeroRoomMs { calm.append(Calm(t: now, db: median)) }
        }
        while let first = calm.first, now - first.t > Splitter.roomWindowMs { calm.removeFirst() }
        if calm.isEmpty { return }
        guard let s = history.last?.s else {
            // No model: the quietest stretch heard. Between parts the room follows it; inside one it only creeps up.
            let lowest = calm.map { $0.db }.min()!
            let rise = open ? Splitter.roomRisePerSec * frameMs / 1000 : 3
            roomDb = min(lowest, roomDb + rise)
            return
        }
        // With a model: how loud it usually is here.
        let usual = Splitter.quantile(calm.map { $0.db }, Splitter.roomPercentile)
        // A room remembered from a quieter place gives way at once to the one heard now, when that is not speech.
        if s < Splitter.speechOff && listenedMs < Splitter.trustNowMs && usual > roomDb { roomDb = usual; return }
        let rise = open ? Splitter.roomRisePerSec * frameMs / 1000 : 3
        roomDb = min(usual, roomDb + rise)
        // A reader who never pauses for long does not become the room.
        if open && partDbs.count >= 10 { roomDb = min(roomDb, Splitter.quantile(partDbs, 0.75) - Splitter.roomUnderPartDb) }
    }

    private func learnVoice() {
        if Double(partDbs.count) * frameMs < 400 { return }
        let loud = Splitter.quantile(partDbs, 0.75)
        voiceDb = voiceDb.map { 0.7 * $0 + 0.3 * loud } ?? loud
    }

    private func learnGap(_ gap: Double) {
        gaps.append(gap)
        if gaps.count > 30 { gaps.removeFirst() }
        if gaps.count < Splitter.learnAfterGaps { return }
        let usual = Splitter.quantile(gaps, 0.9)
        pause = max(Splitter.pauseMs, min(Splitter.maxPauseMs, (usual * 1.5).rounded()))
    }
}
