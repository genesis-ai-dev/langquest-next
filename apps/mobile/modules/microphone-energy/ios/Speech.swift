import Foundation
import onnxruntime_objc

/**
 * Is this sound speech? (decision 135): a line-for-line port of
 * src/speech.ts, which the web module and the tests run. Keep the two in
 * step. The microphone's 44.1 kHz brought down to the model's 16 kHz, cut
 * into 512-sample chunks with the 64 samples before each; SpeechModel runs
 * Silero on them.
 */
enum Silero {
    static let sampleRate = 16000
    static let chunk = 512
    static let context = 64
}

/// Half the resampling filter's length, in input samples.
private let taps = 16

/// Streams one rate into another with a windowed-sinc filter, low-passed under the slower rate's half.
final class Resampler {
    private let step: Double
    private let cutoff: Double
    private var buf: [Double] = []
    private var at = Double(taps)

    init(inRate: Double, outRate: Double = Double(Silero.sampleRate)) {
        step = inRate / outRate
        cutoff = min(1, outRate / inRate) * 0.45
    }

    /// Some input; every output sample it completes goes to `out`.
    func push(_ input: [Float], _ out: (Double) -> Void) {
        for x in input { buf.append(Double(x)) }
        while at + Double(taps) < Double(buf.count) {
            let centre = Int(at.rounded(.down))
            var sum = 0.0, weights = 0.0
            for k in (centre - taps + 1)...(centre + taps) {
                let d = at - Double(k)
                let w = 0.5 + 0.5 * cos(Double.pi * d / Double(taps))
                let x = 2 * Double.pi * cutoff * d
                let h = (d == 0 ? 1 : sin(x) / x) * w
                sum += buf[k] * h
                weights += h
            }
            out(weights == 0 ? 0 : sum / weights)
            at += step
        }
        let drop = Int(at.rounded(.down)) - taps
        if drop > 0 { buf.removeFirst(drop); at -= Double(drop) }
    }
}

/// The model's chunks: each 512 new samples, with the 64 before them in front.
final class SpeechChunks {
    private var ctx = [Float](repeating: 0, count: Silero.context)
    private var cur = [Float](repeating: 0, count: Silero.chunk)
    private var n = 0

    func push(_ sample: Double) -> [Float]? {
        cur[n] = Float(sample)
        n += 1
        if n < Silero.chunk { return nil }
        let input = ctx + cur
        ctx = Array(cur[(Silero.chunk - Silero.context)...])
        cur = [Float](repeating: 0, count: Silero.chunk)
        n = 0
        return input
    }

    func reset() { ctx = [Float](repeating: 0, count: Silero.context); n = 0 }
}

/// A frame's score: the surest chunk that ended in it, or the last chunk's when none did.
func frameScore(_ scores: [Double], _ last: Double) -> Double { scores.max() ?? last }

/// A model the module ships (models/README.md), from its resource bundle.
func modelPath(_ name: String) -> String? {
    let bundles = [Bundle.main, Bundle(for: SpeechModel.self)]
    return bundles.lazy.compactMap { b -> String? in
        if let url = b.url(forResource: "MicrophoneEnergyModels", withExtension: "bundle"), let models = Bundle(url: url) {
            return models.path(forResource: name, ofType: "onnx")
        }
        return b.path(forResource: name, ofType: "onnx")
    }.first
}

/**
 * Silero VAD (models/README.md) through ONNX Runtime: scores one chunk as
 * speech, 0..1, carrying its state from chunk to chunk. One thread; it runs
 * on the microphone's tap, about a millisecond a chunk.
 */
final class SpeechModel {
    /// The environment lives as long as the session that needs it.
    private let env: ORTEnv
    private let session: ORTSession
    private var state = [Float](repeating: 0, count: 2 * 128)

    private init(env: ORTEnv, session: ORTSession) { self.env = env; self.session = session }

    func score(_ chunk: [Float]) throws -> Double {
        var input = chunk
        let inputValue = try ORTValue(tensorData: NSMutableData(bytes: &input, length: input.count * MemoryLayout<Float>.size),
                                      elementType: .float, shape: [1, NSNumber(value: input.count)])
        let stateValue = try ORTValue(tensorData: NSMutableData(bytes: &state, length: state.count * MemoryLayout<Float>.size),
                                      elementType: .float, shape: [2, 1, 128])
        var rate = Int64(Silero.sampleRate)
        let rateValue = try ORTValue(tensorData: NSMutableData(bytes: &rate, length: MemoryLayout<Int64>.size), elementType: .int64, shape: [])
        let out = try session.run(withInputs: ["input": inputValue, "state": stateValue, "sr": rateValue],
                                  outputNames: ["output", "stateN"], runOptions: nil)
        guard let prob = out["output"], let next = out["stateN"] else { return 0 }
        let p = try prob.tensorData() as Data
        let s = try next.tensorData() as Data
        state = s.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        return Double(p.withUnsafeBytes { $0.bindMemory(to: Float.self).first ?? 0 })
    }

    /// Forget what came before: the next chunk starts a new stretch.
    func reset() { state = [Float](repeating: 0, count: 2 * 128) }

    /// The model from the module's resources; nil where it cannot load, and parts split by levels alone.
    static func load() -> SpeechModel? {
        guard let path = modelPath("silero_vad_16k_op15") else { NSLog("MicrophoneEnergy: speech model not found; parts split by levels alone"); return nil }
        do {
            let env = try ORTEnv(loggingLevel: .warning)
            let options = try ORTSessionOptions()
            try options.setIntraOpNumThreads(1)
            return SpeechModel(env: env, session: try ORTSession(env: env, modelPath: path, sessionOptions: options))
        } catch {
            NSLog("MicrophoneEnergy: speech model not loaded (\(error)); parts split by levels alone")
            return nil
        }
    }
}
