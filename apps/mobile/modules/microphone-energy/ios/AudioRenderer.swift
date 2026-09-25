import AVFoundation

/// Decode and concatenate into one shareable PCM WAV. Work is streamed to disk.
enum AudioRenderer {
  static func render(_ clips: [[String: Any]], destination: String) throws -> String {
    let outputURL = URL(string: destination)!
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 44100,
      channels: 1, interleaved: true)!
    let output = try AVAudioFile(forWriting: outputURL, settings: format.settings,
      commonFormat: .pcmFormatInt16, interleaved: true)
    do {
      for clip in clips {
        guard let uri = clip["uri"] as? String, let url = URL(string: uri), url.isFileURL else {
          throw NSError(domain: "AudioEditor", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Download audio before editing."])
        }
        let input = try AVAudioFile(forReading: url)
        let rate = input.processingFormat.sampleRate
        let start = max(0, (clip["startMs"] as? Double ?? 0))
        let end = min(Double(input.length) / rate * 1000,
          clip["endMs"] as? Double ?? Double(input.length) / rate * 1000)
        guard end > start else { throw NSError(domain: "AudioEditor", code: 2) }
        input.framePosition = AVAudioFramePosition(start * rate / 1000)
        var remaining = AVAudioFramePosition((end - start) * rate / 1000)
        let converter = AVAudioConverter(from: input.processingFormat, to: format)!
        let source = AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: 8192)!
        let target = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16384)!
        var readError: Error?
        while true {
          var error: NSError?
          let status = converter.convert(to: target, error: &error) { count, state in
            if remaining <= 0 { state.pointee = .endOfStream; return nil }
            do {
              let frames = min(AVAudioFrameCount(remaining), min(count, source.frameCapacity))
              try input.read(into: source, frameCount: frames)
              remaining -= AVAudioFramePosition(source.frameLength)
              state.pointee = source.frameLength > 0 ? .haveData : .endOfStream
              return source
            } catch { readError = error; state.pointee = .endOfStream; return nil }
          }
          if let error = error { throw error }
          if let error = readError { throw error }
          if target.frameLength > 0 { try output.write(from: target) }
          if status == .endOfStream { break }
          if status == .error { throw NSError(domain: "AudioEditor", code: 3) }
        }
      }
      return outputURL.absoluteString
    } catch {
      try? FileManager.default.removeItem(at: outputURL)
      throw error
    }
  }
}
