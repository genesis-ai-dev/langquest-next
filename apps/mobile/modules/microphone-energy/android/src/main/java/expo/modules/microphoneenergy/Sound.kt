package expo.modules.microphoneenergy

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * What Clean up (decision 179) and even loudness (decision 182) share on an
 * Android phone: a recording's file read and brought to 48 kHz mono floats,
 * kept in a file so a long part is never held in memory whole, and the
 * 16-bit WAV a part is heard from.
 */
object Sound {
  /** The recording's file as 48 kHz mono floats in `target`; how many samples it holds. */
  fun decode(source: File, target: File, progress: (Double) -> Unit): Int {
    var length = 0
    var resampler: DeepFilter.Resampler? = null
    FileOutputStream(target).use { out ->
      val put = { rate: Int, mono: FloatArray ->
        val r = resampler ?: DeepFilter.Resampler(rate, DeepFilter.RATE).also { resampler = it }
        val part = r.push(mono)
        if (part.isNotEmpty()) { out.write(floatBytes(part, part.size)); length += part.size }
      }
      if (!readWav(source, put, progress)) readCodec(source, put, progress)
      val last = resampler?.end() ?: FloatArray(0)
      if (last.isNotEmpty()) { out.write(floatBytes(last, last.size)); length += last.size }
    }
    if (length == 0) throw IllegalArgumentException("empty recording")
    return length
  }

  /** A 16-bit PCM WAV read as it is, as the recorder writes them; false for any other file. */
  private fun readWav(file: File, put: (Int, FloatArray) -> Unit, progress: (Double) -> Unit): Boolean {
    RandomAccessFile(file, "r").use { input ->
      val head = ByteArray(12)
      if (input.length() < 44 || input.read(head) != 12) return false
      if (String(head, 0, 4) != "RIFF" || String(head, 8, 4) != "WAVE") return false
      var rate = 0; var channels = 0; var bits = 0; var pcm = false
      val chunk = ByteArray(8)
      while (input.filePointer + 8 <= input.length()) {
        input.readFully(chunk)
        val c = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN)
        val name = String(chunk, 0, 4); val size = c.getInt(4).toLong() and 0xffffffffL
        if (name == "fmt ") {
          val f = ByteArray(16); input.readFully(f)
          val b = ByteBuffer.wrap(f).order(ByteOrder.LITTLE_ENDIAN)
          pcm = b.getShort(0).toInt() == 1; channels = b.getShort(2).toInt(); rate = b.getInt(4); bits = b.getShort(14).toInt()
          input.seek(input.filePointer + size - 16 + (size and 1))
        } else if (name == "data") {
          if (!pcm || bits != 16 || channels < 1 || rate <= 0) return false
          val frameBytes = 2 * channels
          val total = minOf(size, input.length() - input.filePointer) / frameBytes
          val bytes = ByteArray(16384 * frameBytes)
          var done = 0L
          while (done < total) {
            val frames = minOf(16384L, total - done).toInt()
            input.readFully(bytes, 0, frames * frameBytes)
            val s = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val mono = FloatArray(frames)
            for (i in 0 until frames) {
              var m = 0.0
              for (ch in 0 until channels) m += s.get(i * channels + ch)
              mono[i] = (m / channels / 32768).toFloat()
            }
            put(rate, mono)
            done += frames
            progress(done.toDouble() / total)
          }
          return true
        } else {
          input.seek(input.filePointer + size + (size and 1))
        }
      }
      return false
    }
  }

  /** Any other sound file (AAC from the recorder, or anything Android can decode), through the platform's decoder. */
  private fun readCodec(file: File, put: (Int, FloatArray) -> Unit, progress: (Double) -> Unit) {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(file.absolutePath)
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
        ?: throw IllegalArgumentException("no sound in ${file.name}")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var float = false
      val c = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec = c
      c.configure(format, null, null, 0)
      c.start()
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      while (true) {
        if (!inputDone) {
          val i = c.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val n = extractor.readSampleData(c.getInputBuffer(i)!!, 0)
            if (n < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
            else { c.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
          }
        }
        val o = c.dequeueOutputBuffer(info, 10_000)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val f = c.outputFormat
          rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
        } else if (o >= 0) {
          val buf = c.getOutputBuffer(o)!!
          if (info.size > 0 && channels > 0) {
            buf.position(info.offset); buf.limit(info.offset + info.size)
            val b = buf.slice().order(ByteOrder.nativeOrder())
            val frames = info.size / ((if (float) 4 else 2) * channels)
            val mono = FloatArray(frames)
            if (float) {
              val s = b.asFloatBuffer()
              for (i in 0 until frames) { var m = 0.0; for (ch in 0 until channels) m += s.get(i * channels + ch); mono[i] = (m / channels).toFloat() }
            } else {
              val s = b.asShortBuffer()
              for (i in 0 until frames) { var m = 0.0; for (ch in 0 until channels) m += s.get(i * channels + ch); mono[i] = (m / channels / 32768).toFloat() }
            }
            put(rate, mono)
            if (durationUs > 0) progress(minOf(1.0, info.presentationTimeUs.toDouble() / durationUs))
          }
          c.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
      }
    } finally {
      try { codec?.stop() } catch (_: Exception) {}
      codec?.release()
      extractor.release()
    }
  }

  fun floatBytes(x: FloatArray, count: Int): ByteArray {
    val b = ByteBuffer.allocate(count * 4).order(ByteOrder.LITTLE_ENDIAN)
    b.asFloatBuffer().put(x, 0, count)
    return b.array()
  }

  /** A 16-bit mono WAV's header at 48 kHz, as the recorder writes them. */
  fun wavHeader(samples: Int): ByteArray {
    val rate = DeepFilter.RATE; val bytes = samples * 2
    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()); h.putInt(36 + bytes); h.put("WAVE".toByteArray())
    h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1); h.putInt(rate); h.putInt(rate * 2); h.putShort(2); h.putShort(16)
    h.put("data".toByteArray()); h.putInt(bytes)
    return h.array()
  }
}
