import ExpoModulesCore
import AVFoundation
import Foundation

/**
 * New VAD Algorithm - Simple Threshold with Pre-Onset Buffer
 * 
 * Key differences from old module (MicrophoneEnergyModule.old.swift):
 * - No EMA smoothing - uses raw peak amplitude for immediate response
 * - Pre-onset buffer tracking - continuously tracks a safe cut point
 * - Three-state machine: IDLE -> ONSET_PENDING -> RECORDING
 * - Async file writing - no blocking, no cooldown needed
 * - Ring buffer always fills (not paused during recording)
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
    private let ringBufferMaxSize = 10
    
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
    
    // VAD configuration
    private var vadEnabled = false
    private var vadThreshold: Float = 0.05
    private var vadOnsetMultiplier: Float = 0.1
    private var vadMaxOnsetDuration: Int = 250
    private var vadSilenceDuration: Int = 300
    private var vadMinSegmentDuration: Int = 500
    private var vadRewindHalfPause = true
    private var vadMinActiveAudioDuration: Int = 250  // Discard clips with less active audio than this
    
    // VAD state machine
    private var vadState = "IDLE"
    private var preOnsetCutPoint: TimeInterval = 0
    private var lockedOnsetTime: TimeInterval = 0
    private var lastAboveThresholdTime: TimeInterval = 0
    private var recordingStartTime: TimeInterval = 0
    private var activeAudioTime: TimeInterval = 0  // Cumulative time above threshold during recording
    private var lastFrameTime: TimeInterval = 0    // For calculating delta time
    
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
    }
    
    private func startEnergyDetection() async throws {
        if isActive { await stopEnergyDetectionInternal() }
        ringBuffer.removeAll()
        if let stale = segmentWriter { wavWriteQueue.async { stale.discard() } }
        segmentWriter = nil
        isRecordingSegment = false
        activeAudioTime = 0
        lastFrameTime = 0
        
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
        vadState = "IDLE"
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
    
    private func configureVAD(config: [String: Any?]) {
        configLock.lock()
        defer { configLock.unlock() }
        if let threshold = config["threshold"] as? NSNumber { vadThreshold = threshold.floatValue }
        if let silenceDuration = config["silenceDuration"] as? NSNumber { vadSilenceDuration = silenceDuration.intValue }
        if let minSegmentDuration = config["minSegmentDuration"] as? NSNumber { vadMinSegmentDuration = minSegmentDuration.intValue }
        if let onsetMultiplier = config["onsetMultiplier"] as? NSNumber { vadOnsetMultiplier = onsetMultiplier.floatValue }
        if let maxOnsetDuration = config["maxOnsetDuration"] as? NSNumber { vadMaxOnsetDuration = maxOnsetDuration.intValue }
        if let rewindHalfPause = config["rewindHalfPause"] as? Bool { vadRewindHalfPause = rewindHalfPause }
        if let minActiveAudioDuration = config["minActiveAudioDuration"] as? NSNumber { vadMinActiveAudioDuration = minActiveAudioDuration.intValue }
    }
    
    private func enableVAD() {
        configLock.lock()
        vadEnabled = true
        vadState = "IDLE"
        preOnsetCutPoint = 0
        lockedOnsetTime = 0
        lastAboveThresholdTime = 0
        activeAudioTime = 0
        lastFrameTime = 0
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
        vadState = "IDLE"
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
        ringBuffer.append(RingBufferEntry(buffer: bufferCopy, timestamp: now))
        if ringBuffer.count > ringBufferMaxSize { ringBuffer.removeFirst() }
        
        if isRecordingSegment, let writer = segmentWriter {
            let keep = vadRewindHalfPause ? Int(sampleRate) * vadSilenceDuration / 2000 : 0
            wavWriteQueue.async { writer.append(bufferCopy, keepSamples: keep) }
        }
        if vadEnabled { handleVAD(rawPeak: normalizedAmplitude, now: now) }
        
        sendEvent("onEnergyResult", ["energy": normalizedAmplitude, "timestamp": now])
    }
    
    private func handleVAD(rawPeak: Float, now: TimeInterval) {
        configLock.lock()
        defer { configLock.unlock() }
        guard vadEnabled && isActive else { return }
        let onsetThreshold = vadThreshold * vadOnsetMultiplier
        
        if rawPeak > vadThreshold { lastAboveThresholdTime = now }
        
        switch vadState {
        case "IDLE":
            preOnsetCutPoint = max(0, now - TimeInterval(vadMaxOnsetDuration))
            if rawPeak > onsetThreshold {
                vadState = "ONSET_PENDING"
                lockedOnsetTime = preOnsetCutPoint
                if rawPeak > vadThreshold { confirmAndStartRecording(now: now) }
            }
        case "ONSET_PENDING":
            if now - lockedOnsetTime > TimeInterval(vadMaxOnsetDuration) { lockedOnsetTime = now - TimeInterval(vadMaxOnsetDuration) }
            if rawPeak > vadThreshold { confirmAndStartRecording(now: now) }
            else if rawPeak <= onsetThreshold { vadState = "IDLE" }
        case "RECORDING":
            // Track cumulative time above threshold
            let deltaMs = now - lastFrameTime
            if rawPeak > vadThreshold {
                activeAudioTime += deltaMs
            }
            lastFrameTime = now
            
            let silenceMs = now - lastAboveThresholdTime
            let durationMs = now - recordingStartTime
            if silenceMs >= TimeInterval(vadSilenceDuration) && durationMs >= TimeInterval(vadMinSegmentDuration) {
                stopRecordingAsync()
            }
        default: break
        }
    }
    
    private func confirmAndStartRecording(now: TimeInterval) {
        vadState = "RECORDING"
        lastAboveThresholdTime = now
        recordingStartTime = now
        activeAudioTime = 0  // Reset active audio tracking
        lastFrameTime = now
        sendEvent("onSegmentStart", [:])
        let prerollMs = Int(now - lockedOnsetTime)
        do { try startSegment(options: ["prerollMs": prerollMs]) } catch {
            vadState = "IDLE"
            sendEvent("onError", ["message": error.localizedDescription])
        }
    }
    
    private func stopRecordingAsync() {
        guard isRecordingSegment else { return }
        isRecordingSegment = false
        vadState = "IDLE"
        let writer = segmentWriter
        segmentWriter = nil
        
        // Check if enough active audio - discard transients/short sounds
        if activeAudioTime < TimeInterval(vadMinActiveAudioDuration) {
            print("VAD: Discarding segment - only \(Int(activeAudioTime))ms of active audio (min: \(vadMinActiveAudioDuration)ms)")
            wavWriteQueue.async { writer?.discard() }
            // Emit empty URI to notify JS that recording stopped but was discarded
            self.sendEvent("onSegmentComplete", ["uri": "", "duration": 0])
            return
        }
        
        let startTime = segmentStartTime
        let endTime = Date().timeIntervalSince1970 * 1000
        let rewindMs = vadRewindHalfPause ? vadSilenceDuration / 2 : 0
        let trimSamples = Int(sampleRate) * rewindMs / 1000
        finishSegment(writer, startTime: startTime, endTime: endTime - Double(rewindMs), trimSamples: trimSamples)
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
                DispatchQueue.main.async {
                    self.sendEvent("onSegmentComplete", ["uri": uri, "startTime": startTime, "endTime": endTime, "duration": endTime - startTime])
                }
            } catch {
                let message = "Could not save recording (\(writer.url.lastPathComponent)): \(error.localizedDescription)"
                DispatchQueue.main.async { self.sendEvent("onError", ["message": message]) }
            }
        }
    }
    
    private func startSegment(options: [String: Any?]?) throws {
        configLock.lock()
        defer { configLock.unlock() }
        guard isActive else { throw NSError(domain: "MicrophoneEnergy", code: 4, userInfo: nil) }
        if isRecordingSegment { return }
        
        let prerollMs = (options?["prerollMs"] as? NSNumber)?.intValue ?? 200
        let fileURL = SegmentWriter.stagingDirectory().appendingPathComponent("segment_\(UUID().uuidString).wav")
        let writer = try SegmentWriter(url: fileURL, sampleRate: Int(sampleRate))
        
        segmentStartTime = Date().timeIntervalSince1970 * 1000
        
        let maxPrerollBuffers = Int(Double(prerollMs) / (2048.0 / (sampleRate / 1000.0)))
        let buffersToWrite = min(ringBuffer.count, maxPrerollBuffers)
        let preroll = ringBuffer.suffix(buffersToWrite).map { $0.buffer }
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
        vadState = "IDLE"
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
