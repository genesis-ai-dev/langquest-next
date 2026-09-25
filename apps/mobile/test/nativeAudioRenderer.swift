import AVFoundation
import Foundation

/// Run with scripts/check-native-audio.sh on macOS; needs system AAC services.
@main enum NativeAudioRendererCheck {
  static func main() throws {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1])
    let wav = directory.appendingPathComponent("input.wav")
    let m4a = directory.appendingPathComponent("input.m4a")
    let result = try AudioRenderer.render([
      ["uri": wav.absoluteString, "startMs": 100.0, "endMs": 600.0],
      ["uri": m4a.absoluteString, "startMs": 200.0, "endMs": 950.0]
    ], destination: directory.appendingPathComponent("result.wav").absoluteString)
    let output = try AVAudioFile(forReading: URL(string: result)!)
    let duration = Double(output.length) / output.processingFormat.sampleRate
    precondition(abs(duration - 1.25) < 0.02, "Unexpected duration: \(duration)")
    precondition(output.processingFormat.channelCount == 1)
    precondition(output.processingFormat.sampleRate == 44100)
    let samples = AVAudioPCMBuffer(pcmFormat: output.processingFormat, frameCapacity: 2048)!
    try output.read(into: samples)
    precondition((0..<Int(samples.frameLength)).contains {
      abs(samples.floatChannelData![0][$0]) > 0.01
    }, "Rendered audio is silent")
    let invalid = directory.appendingPathComponent("invalid.wav")
    do {
      _ = try AudioRenderer.render([
        ["uri": wav.absoluteString, "startMs": 900.0, "endMs": 200.0]
      ], destination: invalid.absoluteString)
      preconditionFailure("Renderer accepted a reversed audio range")
    } catch {
      precondition(!FileManager.default.fileExists(atPath: invalid.path))
    }
    print("PASS: WAV + stereo AAC trimmed and assembled into audible 1.25s mono WAV; failed output cleaned up")
  }
}
