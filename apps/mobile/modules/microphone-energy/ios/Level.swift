import Foundation

/**
 * Even loudness on an iPhone (decision 182): a recording read and brought
 * to 48 kHz (Sound.decode), measured (Meter), and, when a copy is asked
 * for, the copy turned to the loudness asked for with its peaks held under
 * the ceiling (Limiter), written as a 16-bit WAV to play. Meter follows
 * loudnessModel.ts and Limiter levelModel.ts line for line, as Level.kt
 * does; every number comes from levelModel.ts LEVEL. Recordings are taken
 * one at a time, on a queue of their own, and their 48 kHz floats stay in
 * the caches only while one is worked on. Sendable by hand: `made` and
 * `swept` are read and written only on `queue`.
 */
final class Level: @unchecked Sendable {
    private static let block = 65536
    private let queue = DispatchQueue(label: "MicrophoneEnergy.level", qos: .userInitiated)
    /// Work files made, and whether those an app stopped mid-way left behind are gone.
    private var made = 0
    private var swept = false

    /// levelModel.ts LEVEL.
    struct Options {
        let targetLufs: Double, maxBoostDb: Double, minChangeDb: Double, ceilingDb: Double, lookaheadS: Double, releaseS: Double
        let passes: Int

        init(_ o: [String: Double]) throws {
            func num(_ key: String) throws -> Double {
                guard let v = o[key] else { throw Sound.fail(20, "no \(key)") }
                return v
            }
            targetLufs = try num("targetLufs"); maxBoostDb = try num("maxBoostDb"); minChangeDb = try num("minChangeDb")
            ceilingDb = try num("ceilingDb"); lookaheadS = try num("lookaheadS"); releaseS = try num("releaseS")
            passes = Int(try num("passes"))
        }
    }

    /// The recording at `uri` measured and, with `out`, its copy written there: what was heard, the gain, and whether a copy was written.
    func level(uri: String, out: String?, options: Options) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { done in
            queue.async {
                do { done.resume(returning: try self.run(uri, out, options)) } catch { done.resume(throwing: error) }
            }
        }
    }

    private func run(_ uri: String, _ out: String?, _ o: Options) throws -> [String: Any] {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("LevelWork", isDirectory: true)
        if !swept { swept = true; try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        made += 1
        let x = dir.appendingPathComponent("x-\(made).f32")
        defer { try? FileManager.default.removeItem(at: x) }
        let length = try Sound.decode(uri, into: x) { _ in }
        let meter = Meter(rate: DeepFilter.rate, frames: length)
        try blocks(x, length) { a in meter.add(a) }
        let m = meter.measured()
        var gain = Level.playGain(m.lufs, o)
        var answer: [String: Any] = ["peakDb": m.peakDb, "amps": m.amps, "gainDb": gain, "written": false]
        if let lufs = m.lufs { answer["lufs"] = lufs }
        if let noise = m.noiseDb { answer["noiseDb"] = noise }
        guard let out, abs(gain) >= o.minChangeDb else { return answer }
        let target = Level.fileOf(out)
        let part = target.deletingLastPathComponent().appendingPathComponent(target.lastPathComponent + ".part")
        defer { try? FileManager.default.removeItem(at: part) }
        var next: Double? = gain
        var pass = 1
        while let g = next {
            gain = g
            let heard = Meter(rate: DeepFilter.rate, frames: length)
            FileManager.default.createFile(atPath: part.path, contents: nil)
            let w = try FileHandle(forWritingTo: part)
            do {
                try w.write(contentsOf: Sound.wavHeader(samples: length))
                let limiter = Limiter(rate: DeepFilter.rate, gainDb: g, ceilingDb: o.ceilingDb, lookaheadS: o.lookaheadS, releaseS: o.releaseS)
                let put = { (y: [Float]) in
                    heard.add(y[...])
                    let pcm = DeepFilter.pcm16(y)
                    try w.write(contentsOf: pcm.withUnsafeBufferPointer { Data(buffer: $0) })
                }
                try blocks(x, length) { a in try put(limiter.push(a)) }
                try put(limiter.end())
                try w.close()
            } catch {
                try? w.close()
                throw error
            }
            next = Level.nextGain(g, heard.measured().lufs, pass, o)
            pass += 1
        }
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: part, to: target)
        answer["gainDb"] = gain
        answer["written"] = true
        return answer
    }

    private static func fileOf(_ uri: String) -> URL {
        if let url = URL(string: uri), url.isFileURL { return url }
        return URL(fileURLWithPath: uri)
    }

    /// The floats a block at a time.
    private func blocks(_ x: URL, _ length: Int, _ body: (ArraySlice<Float>) throws -> Void) throws {
        let a = try FileHandle(forReadingFrom: x)
        defer { try? a.close() }
        var at = 0
        while at < length {
            let n = min(Level.block, length - at)
            let xs = Sound.floats(try a.read(upToCount: n * 4) ?? Data())
            if xs.isEmpty { break }
            try body(xs[...])
            at += xs.count
        }
    }

    /// loudnessModel.ts playGainDb.
    static func playGain(_ lufs: Double?, _ o: Options) -> Double {
        guard let lufs else { return 0 }
        return min(o.maxBoostDb, o.targetLufs - lufs)
    }

    /// levelModel.ts nextGain.
    static func nextGain(_ gainDb: Double, _ outLufs: Double?, _ pass: Int, _ o: Options) -> Double? {
        guard let outLufs, pass < o.passes else { return nil }
        let next = min(o.maxBoostDb, gainDb + (o.targetLufs - outLufs))
        return o.targetLufs - outLufs >= o.minChangeDb && next > gainDb ? next : nil
    }
}

/// loudnessModel.ts loudnessMeter, line for line: a part's loudness (BS.1770), its loudest sample, the room between its words, and its bars' spread.
final class Meter {
    struct Measured { let lufs: Double?; let peakDb: Double; let noiseDb: Double?; let amps: [Double] }

    private static let sliceS = 0.025, roomAt = 0.05, minSlices = 20, stepS = 0.1, stepsPerBlock = 4
    private static let absoluteGate = -70.0, relativeGate = -10.0, silentDb = -120.0

    private let sb0: Double, sb1: Double, sb2: Double, sa1: Double, sa2: Double, ca1: Double, ca2: Double
    private var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0, z1 = 0.0, z2 = 0.0
    private let step: Int
    private var steps: [Double] = []
    private var stepSum = 0.0, stepN = 0
    private let slice: Int
    private var rooms: [Double] = []
    private var sliceSum = 0.0, sliceSq = 0.0, sliceN = 0
    private var peak = 0.0
    private let count: Int
    private let per: Double
    private var barSum: [Double], barSq: [Double], barN: [Double]
    private var bar = 0, barEnd: Double, at = 0
    private var bSum = 0.0, bSq = 0.0, bN = 0.0

    init(rate: Int, frames: Int, count: Int = CleanUp.barCount) {
        // The K-weighting's two filters for `rate` (BS.1770, as libebur128 derives them for any rate).
        var f0 = 1681.974450955533, q = 0.7071752369554196
        let g = 3.999843853973347
        var k = tan((Double.pi * f0) / Double(rate))
        let vh = pow(10, g / 20), vb = pow(vh, 0.4996667741545416)
        var a0 = 1 + k / q + k * k
        sb0 = (vh + (vb * k) / q + k * k) / a0; sb1 = (2 * (k * k - vh)) / a0; sb2 = (vh - (vb * k) / q + k * k) / a0
        sa1 = (2 * (k * k - 1)) / a0; sa2 = (1 - k / q + k * k) / a0
        f0 = 38.13547087602444; q = 0.5003270373238773
        k = tan((Double.pi * f0) / Double(rate))
        a0 = 1 + k / q + k * k
        ca1 = (2 * (k * k - 1)) / a0; ca2 = (1 - k / q + k * k) / a0
        step = max(1, Meter.round(Double(rate) * Meter.stepS))
        slice = max(1, Meter.round(Double(rate) * Meter.sliceS))
        self.count = count
        per = max(1, Double(frames) / Double(count))
        barSum = [Double](repeating: 0, count: count); barSq = barSum; barN = barSum
        barEnd = ceil(per)
    }

    /// JavaScript's Math.round.
    private static func round(_ v: Double) -> Int { Int(floor(v + 0.5)) }

    private func closeBar() {
        barSum[bar] += bSum; barSq[bar] += bSq; barN[bar] += bN
        bSum = 0; bSq = 0; bN = 0
    }

    func add(_ chunk: ArraySlice<Float>) {
        for v in chunk {
            let x = Double(v)
            // K-weighted, for the loudness: the shelf, then the cut (whose b is 1, −2, 1).
            let y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2
            let z = y - 2 * y1 + y2 - ca1 * z1 - ca2 * z2
            x2 = x1; x1 = x; y2 = y1; y1 = y; z2 = z1; z1 = z
            stepSum += z * z
            stepN += 1
            if stepN == step { steps.append(stepSum / Double(step)); stepSum = 0; stepN = 0 }
            // As recorded, for the room and the bars: each slice's spread about its own middle.
            let xx = x * x
            sliceSum += x; sliceSq += xx
            sliceN += 1
            if sliceN == slice {
                let mean = sliceSum / Double(slice)
                rooms.append(max(0, sliceSq / Double(slice) - mean * mean))
                sliceSum = 0; sliceSq = 0; sliceN = 0
            }
            if Double(at) == barEnd && bar < count - 1 { closeBar(); bar += 1; barEnd = ceil(Double(bar + 1) * per) }
            bSum += x; bSq += xx; bN += 1
            at += 1
            let m = x < 0 ? -x : x
            if m > peak { peak = m }
        }
    }

    func measured() -> Measured {
        closeBar()
        var blocks: [Double] = []
        var j = 0
        while j + Meter.stepsPerBlock <= steps.count {
            var sum = 0.0
            for i in j..<(j + Meter.stepsPerBlock) { sum += steps[i] }
            blocks.append(sum / Double(Meter.stepsPerBlock))
            j += 1
        }
        // A part shorter than a block is one block.
        if blocks.isEmpty && at > 0 { blocks.append((steps.reduce(0.0) { $0 + $1 * Double(step) } + stepSum) / Double(at)) }
        let amps = (0..<count).map { k -> Double in
            guard barN[k] > 0 else { return 0 }
            let mean = barSum[k] / barN[k]
            return sqrt(max(0, barSq[k] / barN[k] - mean * mean))
        }
        return Measured(lufs: Meter.gatedLoudness(blocks), peakDb: peak > 0 ? max(Meter.silentDb, 20 * log10(peak)) : Meter.silentDb,
                        noiseDb: Meter.roomDb(rooms), amps: amps)
    }

    private static func dB(_ meanSquare: Double) -> Double { meanSquare > 0 ? max(silentDb, 10 * log10(meanSquare)) : silentDb }

    private static func loud(_ ms: Double) -> Double { -0.691 + 10 * log10(ms) }

    static func gatedLoudness(_ blocks: [Double]) -> Double? {
        let above = blocks.filter { $0 > 0 && loud($0) > absoluteGate }
        if above.isEmpty { return nil }
        let line = loud(above.reduce(0, +) / Double(above.count)) + relativeGate
        let kept = above.filter { loud($0) > line }
        return loud(kept.reduce(0, +) / Double(kept.count))
    }

    static func roomDb(_ slices: [Double]) -> Double? {
        if slices.count < minSlices { return nil }
        let sorted = slices.sorted()
        return dB(sorted[Int(floor(roomAt * Double(sorted.count - 1)))])
    }
}

/// levelModel.ts limiter, line for line: one channel turned by `gainDb`, every sample held at or under `ceilingDb`.
final class Limiter {
    private let gain: Double, ceiling: Double
    private let look: Int
    private let ease: Double
    private var held: [Double]
    private var places: [Double], asks: [Double]
    private var front = 0, count = 0
    private var eased: [Double]
    private var sum = 0.0
    private var last: Double
    private var taken = 0
    private var out: [Float] = []

    init(rate: Int, gainDb: Double, ceilingDb: Double, lookaheadS: Double, releaseS: Double) {
        gain = pow(10, gainDb / 20); ceiling = pow(10, ceilingDb / 20)
        look = max(1, Int(floor(Double(rate) * lookaheadS + 0.5)))
        ease = 1 - exp(-1 / max(1, Double(rate) * releaseS))
        held = [Double](repeating: 0, count: look)
        places = held; asks = held; eased = held
        last = gain
        for _ in 0..<(look - 1) { take(0) }
    }

    private func take(_ x: Double) {
        let i = taken
        taken += 1
        held[i % look] = x
        let m = x < 0 ? -x : x
        let ask = m * gain > ceiling ? ceiling / m : gain
        if count > 0 && places[front] <= Double(i - look) { front = (front + 1) % look; count -= 1 }
        while count > 0 && asks[(front + count - 1) % look] >= ask { count -= 1 }
        places[(front + count) % look] = Double(i)
        asks[(front + count) % look] = ask
        count += 1
        let j = i - look + 1
        if j < 0 { return }
        let r = min(asks[front], last + (gain - last) * ease)
        last = r
        sum += r - eased[j % look]
        eased[j % look] = r
        // The first `look - 1` are the silence before the part.
        if j < look - 1 { return }
        let y = held[j % look] * (sum / Double(look))
        out.append(Float(y > ceiling ? ceiling : y < -ceiling ? -ceiling : y))
    }

    private func flush() -> [Float] {
        let done = out
        out.removeAll(keepingCapacity: true)
        return done
    }

    func push(_ chunk: ArraySlice<Float>) -> [Float] {
        for v in chunk { take(Double(v)) }
        return flush()
    }

    func end() -> [Float] {
        for _ in 0..<(look - 1) { take(0) }
        return flush()
    }
}
