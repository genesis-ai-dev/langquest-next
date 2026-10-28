import AVFoundation
import Foundation

/**
 * What Clean up (decision 179) and even loudness (decision 182) share on an
 * iPhone: a recording's file read and brought to 48 kHz mono floats, kept in
 * a file so a long part is never held in memory whole, and the 16-bit WAV a
 * part is heard from.
 */
enum Sound {
    /// The recording's file as 48 kHz mono floats in `target`; how many samples it holds.
    static func decode(_ uri: String, into target: URL, progress: (Double) throws -> Void) throws -> Int {
        guard let url = URL(string: uri), url.isFileURL else { throw Sound.fail(12, "Not a file: \(uri)") }
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_384) else { throw Sound.fail(8, "No buffer") }
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
        if length == 0 { throw Sound.fail(7, "Empty recording") }
        return length
    }

    /// A 16-bit mono WAV's header at 48 kHz, as the recorder writes them.
    static func wavHeader(samples: Int) -> Data {
        let rate = UInt32(DeepFilter.rate), bytes = UInt32(samples * 2)
        var h = Data()
        func put<T: FixedWidthInteger>(_ v: T) { withUnsafeBytes(of: v.littleEndian) { h.append(contentsOf: $0) } }
        h.append("RIFF".data(using: .ascii)!); put(UInt32(36) + bytes)
        h.append("WAVE".data(using: .ascii)!)
        h.append("fmt ".data(using: .ascii)!); put(UInt32(16)); put(UInt16(1)); put(UInt16(1)); put(rate); put(rate * 2); put(UInt16(2)); put(UInt16(16))
        h.append("data".data(using: .ascii)!); put(bytes)
        return h
    }

    static func floats(_ data: Data) -> [Float] {
        [Float](unsafeUninitializedCapacity: data.count / 4) { buf, n in n = data.copyBytes(to: buf) / 4 }
    }

    static func fail(_ code: Int, _ message: String) -> NSError {
        NSError(domain: "MicrophoneEnergy", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
