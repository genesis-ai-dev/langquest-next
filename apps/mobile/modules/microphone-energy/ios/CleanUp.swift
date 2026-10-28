import AVFoundation
import Foundation
import onnxruntime_objc

/**
 * Clean up on an iPhone (decision 178): a part's file read and brought to
 * 48 kHz, DeepFilterNet3 run over it (DeepFilter.swift), and the slider's
 * mix written as a file. Each part being cleaned has a folder in the caches
 * holding its sound as recorded and its cleaned sound as 48 kHz floats, so
 * a long part is never held in memory whole; the folder goes when the app
 * forgets the part. Parts are cleaned one at a time, on a queue of their own.
 * Sendable by hand: `live` and `turn` are read and written only under
 * `lock`, and `model`, `mixes` and `swept` only on `queue`.
 */
final class CleanUp: @unchecked Sendable {
    /// Bars a part is drawn with (barsModel.ts BAR_COUNT).
    static let barCount = 64
    private static let block = 65536

    private let queue = DispatchQueue(label: "MicrophoneEnergy.cleanUp", qos: .userInitiated)
    private let lock = NSLock()
    /// Parts the app still wants, each with the turn it was asked for; a part forgotten mid-way stops at its next run.
    private var live: [String: Int] = [:]
    private var turn = 0
    /// Loaded on the queue when a part first needs it, and let go when no part is left.
    private var model: CleanUpModel?
    private var mixes = 0
    /// Whether the folders an app stopped with the sheet open left behind are gone (`sweep`).
    private var swept = false

    /// Cleans the part at `uri` as `id`: its length and the sums its bars are drawn from (deepFilter.ts SliceSums).
    func clean(id: String, uri: String, progress: @escaping (Double) -> Void) async throws -> [String: Any] {
        let mine = begin(id)
        return try await withCheckedThrowingContinuation { done in
            queue.async {
                do {
                    done.resume(returning: try self.run(id, mine, uri, progress))
                } catch {
                    if !self.wanted(id, mine) { try? FileManager.default.removeItem(at: self.folder(id)) }
                    done.resume(throwing: error)
                }
            }
        }
    }

    /// The cleaned part with `limitDb` of its sound as recorded mixed back in (none without a limit): a WAV to hear, or AAC to keep.
    func mix(id: String, limitDb: Double?, keep: Bool) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { done in
            queue.async {
                do { done.resume(returning: try self.writeMix(id, limitDb, keep)) } catch { done.resume(throwing: error) }
            }
        }
    }

    /// The app is done with the part: its work stops and its folder goes.
    func forget(id: String) {
        lock.lock(); live[id] = nil; lock.unlock()
        queue.async {
            try? FileManager.default.removeItem(at: self.folder(id))
            self.lock.lock(); let none = self.live.isEmpty; self.lock.unlock()
            if none { self.model = nil }
        }
    }

    /// The part's turn, taken under the lock outside the async function (NSLock is not for async contexts).
    private func begin(_ id: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        turn += 1
        live[id] = turn
        return turn
    }

    private func wanted(_ id: String, _ mine: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return live[id] == mine
    }

    private func fail(_ code: Int, _ message: String) -> NSError {
        NSError(domain: "MicrophoneEnergy", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static var root: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("CleanUp", isDirectory: true)
    }

    private func folder(_ id: String) -> URL {
        let safe = String(id.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? Character($0) : "_" })
        return CleanUp.root.appendingPathComponent(safe, isDirectory: true)
    }

    /// The first part cleaned since the app started takes away every folder left by an app stopped
    /// with the sheet open: folders are made only on the queue, so none of this start's is there yet.
    private func sweep() {
        if swept { return }
        swept = true
        try? FileManager.default.removeItem(at: CleanUp.root)
    }

    private func run(_ id: String, _ mine: Int, _ uri: String, _ progress: (Double) -> Void) throws -> [String: Any] {
        let check = { if !self.wanted(id, mine) { throw self.fail(10, "Clean up stopped") } }
        try check()
        sweep()
        let dir = folder(id)
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let x = dir.appendingPathComponent("x.f32"), y = dir.appendingPathComponent("y.f32")

        let length = try decode(uri, into: x) { done in try check(); progress(0.1 * done) }
        if model == nil { model = try CleanUpModel.load() }
        guard let model else { throw fail(11, "Clean up's model did not load") }

        let reader = try FileHandle(forReadingFrom: x)
        defer { try? reader.close() }
        FileManager.default.createFile(atPath: y.path, contents: nil)
        let writer = try FileHandle(forWritingTo: y)
        defer { try? writer.close() }
        try DeepFilter.clean(
            length: length,
            read: { at, into in
                try reader.seek(toOffset: UInt64(at) * 4)
                let data = try reader.read(upToCount: into.count * 4) ?? Data()
                let got = into.withUnsafeMutableBufferPointer { data.copyBytes(to: $0) } / 4
                if got < into.count { for i in got..<into.count { into[i] = 0 } }
            },
            net: { erb, spec, frames in try check(); return try model.run(erb, spec, frames) },
            write: { part in try writer.write(contentsOf: part.withUnsafeBufferPointer { Data(buffer: $0) }) },
            progress: { done in progress(0.1 + 0.85 * done) }
        )
        try writer.synchronize()

        var sums = DeepFilter.SliceSums(count: CleanUp.barCount)
        try both(x, y, length) { a, b, at in sums.add(a, b, at: at, total: length) }
        progress(1)
        return ["durationMs": Double(length) * 1000 / Double(DeepFilter.rate), "sums": [sums.n, sums.xx, sums.xy, sums.yy]]
    }

    /// The part's file as 48 kHz mono floats in `target`; how many samples it holds.
    private func decode(_ uri: String, into target: URL, progress: (Double) throws -> Void) throws -> Int {
        guard let url = URL(string: uri), url.isFileURL else { throw fail(12, "Not a file: \(uri)") }
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_384) else { throw fail(8, "No buffer") }
        let resampler = DeepFilter.Resampler(from: Int(format.sampleRate.rounded()), to: DeepFilter.rate)
        FileManager.default.createFile(atPath: target.path, contents: nil)
        let out = try FileHandle(forWritingTo: target)
        defer { try? out.close() }
        var length = 0
        let put = { (part: [Float]) in
            if part.isEmpty { return }
            try out.write(contentsOf: part.withUnsafeBufferPointer { Data(buffer: $0) })
            length += part.count
        }
        let channels = Int(format.channelCount), total = max(1, file.length)
        while file.framePosition < file.length {
            try file.read(into: buffer)
            let n = Int(buffer.frameLength)
            if n == 0 { break }
            var mono = [Float](repeating: 0, count: n)
            if let data = buffer.floatChannelData {
                for c in 0..<channels { let ch = data[c]; for i in 0..<n { mono[i] += ch[i] } }
                if channels > 1 { let k = 1 / Float(channels); for i in 0..<n { mono[i] *= k } }
            }
            try put(resampler.push(mono))
            try progress(Double(file.framePosition) / Double(total))
        }
        try put(resampler.end())
        try out.synchronize()
        if length == 0 { throw fail(7, "Empty recording") }
        return length
    }

    /// Both sounds a block at a time: `body` gets a stretch of each and where it starts.
    private func both(_ x: URL, _ y: URL, _ length: Int, _ body: (ArraySlice<Float>, ArraySlice<Float>, Int) throws -> Void) throws {
        let a = try FileHandle(forReadingFrom: x), b = try FileHandle(forReadingFrom: y)
        defer { try? a.close(); try? b.close() }
        var at = 0
        while at < length {
            let n = min(CleanUp.block, length - at)
            let xs = floats(try a.read(upToCount: n * 4) ?? Data()), ys = floats(try b.read(upToCount: n * 4) ?? Data())
            let m = min(xs.count, ys.count)
            if m == 0 { break }
            try body(xs[0..<m], ys[0..<m], at)
            at += m
        }
    }

    private func writeMix(_ id: String, _ limitDb: Double?, _ keep: Bool) throws -> [String: Any] {
        let dir = folder(id)
        let x = dir.appendingPathComponent("x.f32"), y = dir.appendingPathComponent("y.f32")
        guard let size = (try? FileManager.default.attributesOfItem(atPath: y.path))?[.size] as? NSNumber, size.intValue > 0 else {
            throw fail(13, "Nothing cleaned for this part")
        }
        let length = size.intValue / 4
        // A new preview replaces the last; a player still holding the last keeps reading it until it lets go.
        for old in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent.hasPrefix("mix-") {
            try? FileManager.default.removeItem(at: old)
        }
        mixes += 1
        let wav = dir.appendingPathComponent(keep ? "kept.wav" : "mix-\(mixes).wav")
        FileManager.default.createFile(atPath: wav.path, contents: nil)
        let out = try FileHandle(forWritingTo: wav)
        do {
            try out.write(contentsOf: wavHeader(samples: length))
            let gain = DeepFilter.mixGain(limitDb)
            try both(x, y, length) { a, b, _ in
                let pcm = DeepFilter.pcm16(DeepFilter.mix(a, b, gain: gain))
                try out.write(contentsOf: pcm.withUnsafeBufferPointer { Data(buffer: $0) })
            }
            try out.close()
        } catch {
            try? out.close()
            try? FileManager.default.removeItem(at: wav)
            throw error
        }
        if !keep { return ["uri": wav.absoluteString, "format": "wav"] }
        defer { try? FileManager.default.removeItem(at: wav) }
        return ["uri": try AacEncoder.encode(uri: wav.absoluteString), "format": "m4a"]
    }

    /// A 16-bit mono WAV's header at 48 kHz, as the recorder writes them.
    private func wavHeader(samples: Int) -> Data {
        let rate = UInt32(DeepFilter.rate), bytes = UInt32(samples * 2)
        var h = Data()
        func put<T: FixedWidthInteger>(_ v: T) { withUnsafeBytes(of: v.littleEndian) { h.append(contentsOf: $0) } }
        h.append("RIFF".data(using: .ascii)!); put(UInt32(36) + bytes)
        h.append("WAVE".data(using: .ascii)!)
        h.append("fmt ".data(using: .ascii)!); put(UInt32(16)); put(UInt16(1)); put(UInt16(1)); put(rate); put(rate * 2); put(UInt16(2)); put(UInt16(16))
        h.append("data".data(using: .ascii)!); put(bytes)
        return h
    }
}

private func floats(_ data: Data) -> [Float] {
    [Float](unsafeUninitializedCapacity: data.count / 4) { buf, n in n = data.copyBytes(to: buf) / 4 }
}

/**
 * DeepFilterNet3 (models/README.md) through ONNX Runtime: one run's features
 * in, its gains and filter out. Four threads: it runs while the person
 * waits, and the model is most of the time a part takes.
 */
final class CleanUpModel {
    /// The environment lives as long as the session that needs it.
    private let env: ORTEnv
    private let session: ORTSession

    private init(env: ORTEnv, session: ORTSession) { self.env = env; self.session = session }

    static func load() throws -> CleanUpModel {
        guard let path = modelPath("deepfilter") else {
            throw NSError(domain: "MicrophoneEnergy", code: 11, userInfo: [NSLocalizedDescriptionKey: "Clean up's model is missing"])
        }
        let env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(4)
        return CleanUpModel(env: env, session: try ORTSession(env: env, modelPath: path, sessionOptions: options))
    }

    func run(_ erb: [Float], _ spec: [Float], _ frames: Int) throws -> DeepFilter.ModelAnswer {
        var e = erb, s = spec
        let n = NSNumber(value: frames)
        let erbValue = try ORTValue(tensorData: NSMutableData(bytes: &e, length: e.count * MemoryLayout<Float>.size),
                                    elementType: .float, shape: [1, 1, n, 32])
        let specValue = try ORTValue(tensorData: NSMutableData(bytes: &s, length: s.count * MemoryLayout<Float>.size),
                                     elementType: .float, shape: [1, 2, n, 96])
        let out = try session.run(withInputs: ["feat_erb": erbValue, "feat_spec": specValue],
                                  outputNames: ["erb_mask", "df_coefs"], runOptions: nil)
        guard let mask = out["erb_mask"], let coefs = out["df_coefs"] else {
            throw NSError(domain: "MicrophoneEnergy", code: 14, userInfo: [NSLocalizedDescriptionKey: "Clean up's model gave no answer"])
        }
        return DeepFilter.ModelAnswer(mask: floats(try mask.tensorData() as Data), coefs: floats(try coefs.tensorData() as Data))
    }
}
