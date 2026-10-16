import ExpoModulesCore
import AVFoundation
import Foundation

/**
 * The microphone, its level, and parts split where the speaker pauses
 * (Splitter.swift, LAN-82): the splitter learns the room and the voice while
 * it listens and needs no setting. Each part's audio streams to disk as it is
 * heard; the ring buffer holds the last few seconds so a part can start where
 * the voice first rose out of the room.
 */
public class MicrophoneEnergyModule: Module {
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isActive = false
    private var audioConverter: AVAudioConverter?
    private var desiredFormat: AVAudioFormat?
    
    private struct RingBufferEntry {
        let buffer: AVAudioPCMBuffer
        let timestamp: TimeInterval
    }
    private var ringBuffer: [RingBufferEntry] = []
    /// Long enough for a part's head to reach back as far as the splitter lets it, at this device's frame length.
    private var ringBufferMaxSize: Int {
        max(10, Int(((Splitter.maxHeadMs + Splitter.headMarginMs) / (splitter?.frameMs ?? 46.4)).rounded(.up)) + 2)
    }
    
    private var isRecordingSegment = false
    private var segmentStartTime: TimeInterval = 0
    // Audio for the open segment streams to disk as it arrives; only the
    // trimming window (half the pause) stays in memory. Touched only on
    // wavWriteQueue after creation.
    private var segmentWriter: SegmentWriter?
    // All WAV writes share one queue. Stop waits for this queue so the JS
    // promise cannot resolve before the final completion event is enqueued.
    private let wavWriteQueue = DispatchQueue(label: "langquest.microphone-energy.wav")
    private let configLock = NSRecursiveLock()
    
    private let sampleRate: Double = 44100
    
    private var vadEnabled = false
    /// Where parts split (Splitter.swift, LAN-82); made with the device's frame length when the first frame arrives.
    private var splitter: Splitter?
    /// What this device heard last time, until a session's splitter hears for itself.
    private var remembered: Splitter.Heard?
    /// The splitter's clock: frames heard, as time.
    private var clockMs = 0.0
    
    public func definition() -> ModuleDefinition {
        Name("MicrophoneEnergy")
        Events("onEnergyResult", "onError", "onSegmentComplete", "onSegmentStart")
        
        AsyncFunction("startEnergyDetection") { () -> Void in try await self.startEnergyDetection() }
        AsyncFunction("stopEnergyDetection") { () -> Void in try await self.stopEnergyDetection() }
        AsyncFunction("configureVAD") { (config: [String: Any?]) -> Void in self.configureVAD(config: config) }
        AsyncFunction("enableVAD") { () -> Void in self.enableVAD() }
        AsyncFunction("disableVAD") { () -> Void in await self.disableVAD() }
        AsyncFunction("startSegment") { (options: [String: Any?]?) -> Void in try self.startSegment(options: options) }
        AsyncFunction("stopSegment") { () -> String? in return try self.stopSegment() }
        AsyncFunction("encodeAac") { (uri: String) -> String in try AacEncoder.encode(uri: uri) }
    }
    
    private func startEnergyDetection() async throws {
        if isActive { await stopEnergyDetectionInternal() }
        ringBuffer.removeAll()
        if let stale = segmentWriter { wavWriteQueue.async { stale.discard() } }
        segmentWriter = nil
        isRecordingSegment = false
        
        let audioSession = AVAudioSession.sharedInstance()
        let permissionGranted = await withCheckedContinuation { continuation in
            audioSession.requestRecordPermission { granted in continuation.resume(returning: granted) }
        }
        guard permissionGranted else {
            sendEvent("onError", ["message": "Microphone permission not granted"])
            throw NSError(domain: "MicrophoneEnergy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission not granted"])
        }
        
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP])
            try audioSession.setActive(true)
            
            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { throw NSError(domain: "MicrophoneEnergy", code: 2, userInfo: nil) }
            
            inputNode = engine.inputNode
            guard let input = inputNode else { throw NSError(domain: "MicrophoneEnergy", code: 3, userInfo: nil) }
            
            let inputFormat = input.inputFormat(forBus: 0)
            // A missing or uninitialised input device (common on the iOS
            // Simulator without host microphone access) reports 0 Hz / 0
            // channels. installTap would abort the whole process on that;
            // refuse with an error the app can show instead.
            guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
                audioEngine = nil
                inputNode = nil
                let message = "No audio input available (format \(inputFormat.sampleRate) Hz, \(inputFormat.channelCount) ch)"
                sendEvent("onError", ["message": message])
                throw NSError(domain: "MicrophoneEnergy", code: 5, userInfo: [NSLocalizedDescriptionKey: message])
            }
            desiredFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: false)
            
            if inputFormat.sampleRate != sampleRate || inputFormat.channelCount != 1 {
                if let desired = desiredFormat {
                    audioConverter = AVAudioConverter(from: inputFormat, to: desired)
                }
            }
            
            let bufferSize: AVAudioFrameCount = 2048
            input.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] (buffer, time) in
                guard let self = self else { return }
                let timestamp = Date().timeIntervalSince1970 * 1000
                
                if let converter = self.audioConverter, let desired = self.desiredFormat {
                    guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: desired, frameCapacity: buffer.frameLength) else { return }
                    nonisolated(unsafe) var inputProvided = false
                    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
                        if !inputProvided { outStatus.pointee = .haveData; inputProvided = true; return buffer }
                        else { outStatus.pointee = .noDataNow; return nil }
                    }
                    var error: NSError?
                    converter.convert(to: convertedBuffer, error: &error, withInputFrom: inputBlock)
                    if error == nil && convertedBuffer.frameLength > 0 { self.processAudioData(buffer: convertedBuffer, timestamp: timestamp) }
                } else {
                    self.processAudioData(buffer: buffer, timestamp: timestamp)
                }
            }
            
            try engine.start()
            isActive = true
        } catch {
            sendEvent("onError", ["message": "Failed to start: \(error.localizedDescription)"])
            throw error
        }
    }
    
    private func stopEnergyDetection() async throws {
        if !isActive { return }
        await stopEnergyDetectionInternal()
    }
    
    private func stopEnergyDetectionInternal() async {
        configLock.lock()
        isActive = false
        vadEnabled = false
        if let sp = splitter { remembered = sp.remember(); sp.pauseListening() }
        configLock.unlock()
        
        // Preserve segment order: older queued writes emit before the final clip.
        await drainWavWritesAndMain()
        if isRecordingSegment {
            do { _ = try stopSegment() } catch {
                sendEvent("onError", ["message": error.localizedDescription])
            }
        }
        await drainWavWritesAndMain()
        
        inputNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        inputNode = nil
        audioConverter = nil
        desiredFormat = nil
        
        do { try AVAudioSession.sharedInstance().setActive(false) } catch {}
    }
    
    /// Only what the device heard last time is read; the old detector's settings are ignored (LAN-82).
    private func configureVAD(config: [String: Any?]) {
        configLock.lock()
        defer { configLock.unlock() }
        guard let heard = config["heard"] as? [String: Any],
              let room = (heard["room"] as? NSNumber)?.doubleValue,
              let voice = (heard["voice"] as? NSNumber)?.doubleValue,
              let pause = (heard["pause"] as? NSNumber)?.doubleValue else { return }
        remembered = Splitter.Heard(room: room, voice: voice, pause: pause)
    }
    
    private func enableVAD() {
        configLock.lock()
        vadEnabled = true
        splitter?.pauseListening()
        // What the microphone heard while the detector was off (a source playing) never heads a part.
        ringBuffer.removeAll()
        configLock.unlock()
    }
    
    private func drainWavWritesAndMain() async {
        await withCheckedContinuation { continuation in
            wavWriteQueue.async {
                DispatchQueue.main.async {
                    continuation.resume()
                }
            }
        }
    }

    private func disableVAD() async {
        configLock.lock()
        vadEnabled = false
        if let sp = splitter { remembered = sp.remember(); sp.pauseListening() }
        configLock.unlock()
        // Preserve segment order: older queued writes emit before the final clip.
        await drainWavWritesAndMain()
        if isRecordingSegment {
            do { _ = try stopSegment() } catch {
                sendEvent("onError", ["message": error.localizedDescription])
            }
        }
        await drainWavWritesAndMain()
    }
    
    private func processAudioData(buffer: AVAudioPCMBuffer, timestamp: TimeInterval) {
        let now = timestamp
        let frameLength = Int(buffer.frameLength)
        
        var peakAmplitude: Double = 0.0
        if let int16Data = buffer.int16ChannelData {
            let channelDataPointer = int16Data.pointee
            for i in 0..<frameLength {
                let sample = abs(Double(channelDataPointer[i]) / 32768.0)
                peakAmplitude = max(peakAmplitude, sample)
            }
        } else if let float32Data = buffer.floatChannelData {
            let channelDataPointer = float32Data.pointee
            for i in 0..<frameLength {
                peakAmplitude = max(peakAmplitude, abs(Double(channelDataPointer[i])))
            }
        } else { return }
        
        let db = 20.0 * log10(max(peakAmplitude, 1e-10))
        let clampedDb = max(-60.0, min(0.0, db))
        let normalizedAmplitude = Float(pow(10.0, clampedDb / 20.0))
        
        guard let bufferCopy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameCapacity) else { return }
        bufferCopy.frameLength = buffer.frameLength
        if let srcInt16 = buffer.int16ChannelData, let dstInt16 = bufferCopy.int16ChannelData {
            memcpy(dstInt16.pointee, srcInt16.pointee, frameLength * MemoryLayout<Int16>.size)
        } else if let srcFloat32 = buffer.floatChannelData, let dstFloat32 = bufferCopy.floatChannelData {
            memcpy(dstFloat32.pointee, srcFloat32.pointee, frameLength * MemoryLayout<Float32>.size)
        }
        
        configLock.lock()
        defer { configLock.unlock() }
        guard isActive else { return }
        let frameMs = Double(frameLength) * 1000 / sampleRate
        ringBuffer.append(RingBufferEntry(buffer: bufferCopy, timestamp: now))
        while ringBuffer.count > ringBufferMaxSize { ringBuffer.removeFirst() }
        
        if isRecordingSegment, let writer = segmentWriter {
            // The open part keeps the longest pause's worth in memory, so its tail can still be trimmed.
            let keep = Int(sampleRate * Splitter.maxPauseMs / 1000)
            wavWriteQueue.async { writer.append(bufferCopy, keepSamples: keep) }
        }
        clockMs += frameMs
        var event: [String: Any] = ["energy": normalizedAmplitude, "timestamp": now]
        if vadEnabled {
            if splitter == nil { splitter = Splitter(frameMs: frameMs, remembered: remembered) }
            if let sp = splitter {
                handleSplit(sp, sp.step(energy: Double(normalizedAmplitude), now: clockMs))
                event["quiet"] = sp.levels().quiet
            }
        }
        sendEvent("onEnergyResult", event)
    }
    
    /// Called with configLock held: start or end a part as the splitter says.
    private func handleSplit(_ sp: Splitter, _ action: Splitter.Action?) {
        switch action {
        case .start(let headFrames):
            sendEvent("onSegmentStart", ["headMs": Double(headFrames) * sp.frameMs])
            do { try openSegment(headFrames: headFrames) } catch {
                sendEvent("onError", ["message": error.localizedDescription])
            }
        case .stop(let discard, let trimMs):
            guard isRecordingSegment else { return }
            isRecordingSegment = false
            let writer = segmentWriter
            segmentWriter = nil
            remembered = sp.remember()
            if discard {
                // A tap or a bump, not speech: nothing said is lost.
                wavWriteQueue.async { writer?.discard() }
                sendEvent("onSegmentComplete", ["uri": "", "duration": 0, "heard": heardMap()])
                return
            }
            let endTime = Date().timeIntervalSince1970 * 1000 - Double(trimMs)
            finishSegment(writer, startTime: segmentStartTime, endTime: endTime, trimSamples: Int(sampleRate) * trimMs / 1000)
        case .none:
            break
        }
    }
    
    private func heardMap() -> [String: Double] {
        guard let r = remembered else { return [:] }
        return ["room": r.room, "voice": r.voice, "pause": r.pause]
    }
    
    /// Completes the file on the write queue. Every failure reaches JS as
    /// onError with the file path, so a full disk is never a silent loss.
    private func finishSegment(_ writer: SegmentWriter?, startTime: Double, endTime: Double, trimSamples: Int) {
        guard let writer = writer else { return }
        wavWriteQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                try writer.finish(trimSamples: trimSamples)
                let uri = writer.uri
                let duration = writer.durationMs
                DispatchQueue.main.async {
                    self.configLock.lock()
                    let heard = self.heardMap()
                    self.configLock.unlock()
                    self.sendEvent("onSegmentComplete", ["uri": uri, "startTime": startTime, "endTime": endTime, "duration": duration, "heard": heard])
                }
            } catch {
                let message = "Could not save recording (\(writer.url.lastPathComponent)): \(error.localizedDescription)"
                DispatchQueue.main.async { self.sendEvent("onError", ["message": message]) }
            }
        }
    }
    
    /// A hold-to-record take: starts with up to `prerollMs` of what the microphone already heard.
    private func startSegment(options: [String: Any?]?) throws {
        configLock.lock()
        defer { configLock.unlock() }
        let prerollMs = (options?["prerollMs"] as? NSNumber)?.doubleValue ?? 200
        let frameMs = ringBuffer.last.map { Double($0.buffer.frameLength) * 1000 / sampleRate } ?? 2048 * 1000 / sampleRate
        try openSegment(headFrames: Int(prerollMs / frameMs))
    }
    
    /// Called with configLock held: open a part's file with the last `headFrames` buffers of the ring.
    private func openSegment(headFrames: Int) throws {
        guard isActive else { throw NSError(domain: "MicrophoneEnergy", code: 4, userInfo: nil) }
        if isRecordingSegment { return }
        let fileURL = SegmentWriter.stagingDirectory().appendingPathComponent("segment_\(UUID().uuidString).wav")
        let writer = try SegmentWriter(url: fileURL, sampleRate: Int(sampleRate))
        segmentStartTime = Date().timeIntervalSince1970 * 1000
        let preroll = ringBuffer.suffix(min(ringBuffer.count, headFrames)).map { $0.buffer }
        wavWriteQueue.async { for buffer in preroll { writer.append(buffer, keepSamples: 0) } }
        segmentWriter = writer
        isRecordingSegment = true
    }
    
    /// Manual stop: no rewind. The file completes on the write queue and is
    /// announced by onSegmentComplete; callers drain the queue before
    /// resolving so the event precedes the promise.
    private func stopSegment() throws -> String? {
        configLock.lock()
        defer { configLock.unlock() }
        guard isRecordingSegment else { return nil }
        isRecordingSegment = false
        splitter?.pauseListening()
        let writer = segmentWriter
        segmentWriter = nil
        let startTime = segmentStartTime
        let endTime = Date().timeIntervalSince1970 * 1000
        finishSegment(writer, startTime: startTime, endTime: endTime, trimSamples: 0)
        return writer?.uri
    }
    
}

/**
 * Streams one segment's PCM to a WAV file as buffers arrive. Only the last
 * `keepSamples` stay in memory so a trailing trim (half the pause) is still
 * possible; everything older is already on disk. A long utterance costs
 * disk, not RAM. The first write error is kept and rethrown by finish().
 */
final class SegmentWriter {
    let url: URL
    private let sampleRate: Int
    private let handle: FileHandle
    private var tail: [AVAudioPCMBuffer] = []
    private var tailSamples = 0
    private var samplesWritten = 0
    private var failure: Error?
    private var closed = false
    /// The finished file's length: head, voice and tail.
    var durationMs: Double { Double(samplesWritten) * 1000 / Double(sampleRate) }
    
    var uri: String {
        let path = url.path
        return "file://" + (path.hasPrefix("/") ? path : "/" + path)
    }
    
    /// Documents/recording-staging: survives restarts, unlike tmp, so JS can
    /// resume an interrupted save from its journal.
    static func stagingDirectory() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("recording-staging", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    
    init(url: URL, sampleRate: Int) throws {
        self.url = url
        self.sampleRate = sampleRate
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: nil) else {
            throw NSError(domain: "MicrophoneEnergy", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not create \(url.lastPathComponent)"])
        }
        handle = try FileHandle(forWritingTo: url)
        try SegmentWriter.writeWAVHeader(fileHandle: handle, dataSize: 0, sampleRate: sampleRate, channels: 1, bitsPerSample: 16)
    }
    
    func append(_ buffer: AVAudioPCMBuffer, keepSamples: Int) {
        guard !closed else { return }
        tail.append(buffer)
        tailSamples += Int(buffer.frameLength)
        while let first = tail.first, tailSamples - Int(first.frameLength) >= keepSamples {
            tail.removeFirst()
            tailSamples -= Int(first.frameLength)
            write(first, samples: Int(first.frameLength))
        }
    }
    
    private func write(_ buffer: AVAudioPCMBuffer, samples: Int) {
        guard failure == nil, samples > 0 else { return }
        do {
            try handle.write(contentsOf: SegmentWriter.pcm16(buffer, samples: samples))
            samplesWritten += samples
        } catch { failure = error }
    }
    
    /// Flush the tail minus `trimSamples`, patch the header, close.
    func finish(trimSamples: Int) throws {
        guard !closed else { return }
        closed = true
        defer { try? handle.close() }
        var remaining = max(0, tailSamples - trimSamples)
        for buffer in tail {
            let n = min(Int(buffer.frameLength), remaining)
            if n <= 0 { break }
            write(buffer, samples: n)
            remaining -= n
        }
        tail.removeAll()
        if let error = failure {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        try handle.seek(toOffset: 0)
        try SegmentWriter.writeWAVHeader(fileHandle: handle, dataSize: Int64(samplesWritten * 2), sampleRate: sampleRate, channels: 1, bitsPerSample: 16)
        try handle.synchronize()
    }
    
    func discard() {
        closed = true
        tail.removeAll()
        try? handle.close()
        try? FileManager.default.removeItem(at: url)
    }
    
    private static func pcm16(_ buffer: AVAudioPCMBuffer, samples: Int) -> Data {
        if let int16Data = buffer.int16ChannelData {
            return Data(bytes: int16Data.pointee, count: samples * MemoryLayout<Int16>.size)
        }
        if let float32Data = buffer.floatChannelData {
            var int16Samples = [Int16](repeating: 0, count: samples)
            for i in 0..<samples {
                let clampedSample = max(-1.0, min(1.0, Double(float32Data.pointee[i])))
                int16Samples[i] = Int16(clampedSample * 32767.0)
            }
            return Data(bytes: int16Samples, count: samples * MemoryLayout<Int16>.size)
        }
        return Data()
    }
    
    private static func writeWAVHeader(fileHandle: FileHandle, dataSize: Int64, sampleRate: Int, channels: Int, bitsPerSample: Int) throws {
        var header = Data()
        header.append("RIFF".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(36 + dataSize).littleEndian) { Data($0) })
        header.append("WAVE".data(using: .ascii)!)
        header.append("fmt ".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(channels).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt32(sampleRate * channels * bitsPerSample / 8).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(channels * bitsPerSample / 8).littleEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(bitsPerSample).littleEndian) { Data($0) })
        header.append("data".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(dataSize).littleEndian) { Data($0) })
        try fileHandle.write(contentsOf: header)
    }
}

/**
 * A finished WAV part as AAC in MP4 (`.m4a`, decisions.md 106): mono 128 kb/s,
 * the bitrate hold-to-record always used, about a fifth of the WAV's size.
 * Throws on anything it cannot read; the caller then keeps the WAV.
 */
enum AacEncoder {
    static func encode(uri: String) throws -> String {
        guard let source = URL(string: uri), source.isFileURL else {
            throw NSError(domain: "MicrophoneEnergy", code: 6, userInfo: [NSLocalizedDescriptionKey: "Not a file: \(uri)"])
        }
        let target = source.deletingPathExtension().appendingPathExtension("m4a")
        try? FileManager.default.removeItem(at: target)
        do {
            try write(from: source, to: target)
        } catch {
            try? FileManager.default.removeItem(at: target)
            throw error
        }
        return target.absoluteString
    }

    /// In its own scope so the output file is closed (and its header finished) before the caller reads it.
    private static func write(from source: URL, to target: URL) throws {
        let input = try AVAudioFile(forReading: source)
        guard input.length > 0 else {
            throw NSError(domain: "MicrophoneEnergy", code: 7, userInfo: [NSLocalizedDescriptionKey: "Empty recording"])
        }
        let format = input.processingFormat
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: input.fileFormat.sampleRate,
            AVNumberOfChannelsKey: input.fileFormat.channelCount,
            AVEncoderBitRateKey: 128_000
        ]
        let output = try AVAudioFile(forWriting: target, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_384) else {
            throw NSError(domain: "MicrophoneEnergy", code: 8, userInfo: [NSLocalizedDescriptionKey: "No buffer"])
        }
        while input.framePosition < input.length {
            try input.read(into: buffer)
            if buffer.frameLength == 0 { break }
            try output.write(from: buffer)
        }
        if #available(iOS 18.0, *) { output.close() }
    }
}
