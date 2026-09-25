package expo.modules.microphoneenergy

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.RandomAccessFile
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Stream decoded audio to mono 44.1 kHz PCM; never concatenate container bytes. */
internal object AudioRenderer {
  fun render(clips: List<Map<String, Any?>>, destination: String): String {
    require(clips.isNotEmpty()) { "Choose audio to export." }
    val file = File(URI(destination))
    try {
      RandomAccessFile(file, "rw").use { output ->
        output.setLength(0)
        output.write(ByteArray(44))
        clips.forEach { clip -> decode(clip, output) }
        val size = output.length() - 44
        require(size in 1..0xfffffff0L) { "Audio exceeds WAV size limit." }
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt((size + 36).toInt())
        header.put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
        header.putInt(44100).putInt(88200).putShort(2).putShort(16)
        header.put("data".toByteArray()).putInt(size.toInt())
        output.seek(0); output.write(header.array())
      }
      return file.toURI().toString()
    } catch (error: Exception) { file.delete(); throw error }
  }

  private fun decode(clip: Map<String, Any?>, output: RandomAccessFile) {
    val source = File(URI(clip["uri"] as String))
    require(source.exists()) { "Download audio before editing." }
    val startUs = ((clip["startMs"] as? Number)?.toDouble() ?: 0.0) * 1000
    val endUs = ((clip["endMs"] as? Number)?.toDouble() ?: Double.MAX_VALUE) * 1000
    require(startUs >= 0 && endUs > startUs) { "Invalid audio range." }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(source.absolutePath)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: error("The file has no audio track.")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      var position = 0L
      var nextOutput = 0L
      val before = output.filePointer
      fun writePcm(bytes: ByteBuffer, count: Int) {
        bytes.order(ByteOrder.LITTLE_ENDIAN)
        val width = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
        require(encoding == AudioFormat.ENCODING_PCM_16BIT || encoding == AudioFormat.ENCODING_PCM_FLOAT) {
          "Unsupported decoded PCM format."
        }
        val frames = count / (channels * width)
        val result = java.io.ByteArrayOutputStream(frames * 2)
        repeat(frames) {
          var value = 0.0
          repeat(channels) {
            value += if (width == 4) bytes.float.toDouble() else bytes.short.toDouble() / 32768
          }
          value /= channels
          val timeUs = position * 1000000.0 / rate
          // Output frame positions are global for this source, avoiding drift per buffer.
          while (nextOutput * rate / 44100 <= position) {
            if (timeUs >= startUs && timeUs < endUs) {
              val sample = (value * 32767).toInt().coerceIn(-32768, 32767)
              result.write(sample and 255); result.write((sample shr 8) and 255)
            }
            nextOutput++
          }
          position++
        }
        output.write(result.toByteArray())
      }
      val mime = format.getString(MediaFormat.KEY_MIME)!!
      if (mime == "audio/raw") {
        if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = format.getInteger(MediaFormat.KEY_PCM_ENCODING)
        val buffer = ByteBuffer.allocate(1024 * 1024)
        while (true) {
          buffer.clear()
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0) break
          buffer.position(0); writePcm(buffer, size); extractor.advance()
        }
      } else {
        val decoder = MediaCodec.createDecoderByType(mime)
        codec = decoder; decoder.configure(format, null, null, 0); decoder.start()
        var inputDone = false
        var outputDone = false
        val info = MediaCodec.BufferInfo()
        var idle = 0
        while (!outputDone) {
          if (!inputDone) {
            val index = decoder.dequeueInputBuffer(10000)
            if (index >= 0) {
              val buffer = decoder.getInputBuffer(index)!!
              val size = extractor.readSampleData(buffer, 0)
              if (size < 0) {
                decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }
          val index = decoder.dequeueOutputBuffer(info, 10000)
          when {
            index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              val decoded = decoder.outputFormat
              rate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              channels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              if (decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = decoded.getInteger(MediaFormat.KEY_PCM_ENCODING)
            }
            index >= 0 -> {
              idle = 0
              val buffer = decoder.getOutputBuffer(index)!!
              buffer.position(info.offset); buffer.limit(info.offset + info.size)
              writePcm(buffer, info.size)
              outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
              decoder.releaseOutputBuffer(index, false)
            }
            else -> { idle++; check(idle < 3000) { "Audio decoder timed out." } }
          }
        }
      }
      require(output.filePointer > before) { "The selected range has no audio." }
    } finally {
      codec?.let { runCatching { it.stop() }; it.release() }
      extractor.release()
    }
  }
}
