package expo.modules.microphoneenergy

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors

/**
 * Clean up on an Android phone (decision 178): a part's file read and brought
 * to 48 kHz, DeepFilterNet3 run over it (DeepFilter.kt), and the slider's mix
 * written as a file. Each part being cleaned has a folder in the cache
 * holding its sound as recorded and its cleaned sound as 48 kHz floats, so a
 * long part is never held in memory whole; the folder goes when the app
 * forgets the part. Parts are cleaned one at a time, on a thread of their own.
 */
class CleanUp(private val context: () -> Context?) {
  private val worker = Executors.newSingleThreadExecutor()
  private val lock = Any()
  /** Parts the app still wants, each with the turn it was asked for; a part forgotten mid-way stops at its next run. */
  private val live = HashMap<String, Int>()
  private var turn = 0
  /** Loaded on the worker when a part first needs it, and let go when no part is left. */
  private var model: CleanUpModel? = null
  private var mixes = 0
  /** Whether the folders an app stopped with the sheet open left behind are gone (`sweep`). On the worker only. */
  private var swept = false

  /** Cleans the part at `uri` as `id`: its length and the sums its bars are drawn from (deepFilter.ts SliceSums). */
  fun clean(id: String, uri: String, progress: (Double) -> Unit, done: (Map<String, Any>?, Exception?) -> Unit) {
    val mine = synchronized(lock) { turn += 1; live[id] = turn; turn }
    worker.execute {
      try {
        done(run(id, mine, uri, progress), null)
      } catch (e: Exception) {
        if (!wanted(id, mine)) folder(id)?.deleteRecursively()
        done(null, e)
      }
    }
  }

  /** The cleaned part with `limitDb` of its sound as recorded mixed back in (none without a limit): a WAV to hear, or AAC to keep. */
  fun mix(id: String, limitDb: Double?, keep: Boolean, done: (Map<String, Any>?, Exception?) -> Unit) {
    worker.execute {
      try { done(writeMix(id, limitDb, keep), null) } catch (e: Exception) { done(null, e) }
    }
  }

  /** The app is done with the part: its work stops and its folder goes. */
  fun forget(id: String) {
    synchronized(lock) { live.remove(id) }
    worker.execute {
      folder(id)?.deleteRecursively()
      if (synchronized(lock) { live.isEmpty() }) { model?.close(); model = null }
    }
  }

  private fun wanted(id: String, mine: Int): Boolean = synchronized(lock) { live[id] == mine }

  private fun folder(id: String): File? {
    val ctx = context() ?: return null
    return File(File(ctx.cacheDir, "CleanUp"), id.replace(Regex("[^A-Za-z0-9_-]"), "_"))
  }

  /**
   * The first part cleaned since the app started takes away every folder left by an app stopped
   * with the sheet open: folders are made only on the worker, so none of this start's is there yet.
   */
  private fun sweep(ctx: Context) {
    if (swept) return
    swept = true
    File(ctx.cacheDir, "CleanUp").deleteRecursively()
  }

  private fun run(id: String, mine: Int, uri: String, progress: (Double) -> Unit): Map<String, Any> {
    val check = { if (!wanted(id, mine)) throw IllegalStateException("Clean up stopped") }
    check()
    val ctx = context() ?: throw IllegalStateException("Context not available")
    sweep(ctx)
    val dir = folder(id)!!
    dir.deleteRecursively()
    dir.mkdirs()
    val x = File(dir, "x.f32"); val y = File(dir, "y.f32")

    val length = decode(File(java.net.URI(uri)), x) { done -> check(); progress(0.1 * done) }
    val net = model ?: CleanUpModel.load(ctx).also { model = it }

    RandomAccessFile(x, "r").use { reader ->
      FileOutputStream(y).use { writer ->
        val bytes = ByteArray(4 * DeepFilter.RUN_FRAMES * 480 * 2)
        DeepFilter.clean(
          length,
          { at, into ->
            reader.seek(at * 4)
            val want = into.size * 4
            val buf = if (bytes.size >= want) bytes else ByteArray(want)
            var got = 0
            while (got < want) { val n = reader.read(buf, got, want - got); if (n <= 0) break; got += n }
            ByteBuffer.wrap(buf, 0, got - got % 4).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(into, 0, got / 4)
            java.util.Arrays.fill(into, got / 4, into.size, 0f)
          },
          { erb, spec, frames -> check(); net.run(erb, spec, frames) },
          { part, count -> writer.write(floatBytes(part, count)) },
          { done -> progress(0.1 + 0.85 * done) }
        )
      }
    }

    val sums = DeepFilter.SliceSums(BAR_COUNT)
    both(x, y, length) { a, b, n, at -> sums.add(a, b, n, at, length.toLong()) }
    progress(1.0)
    return mapOf(
      "durationMs" to length * 1000.0 / DeepFilter.RATE,
      "sums" to listOf(sums.n.toList(), sums.xx.toList(), sums.xy.toList(), sums.yy.toList())
    )
  }

  /** The part's file as 48 kHz mono floats in `target`; how many samples it holds. */
  private fun decode(source: File, target: File, progress: (Double) -> Unit): Int {
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

  /** Both sounds a block at a time: `body` gets a stretch of each, its size, and where it starts. */
  private fun both(x: File, y: File, length: Int, body: (FloatArray, FloatArray, Int, Long) -> Unit) {
    RandomAccessFile(x, "r").use { a ->
      RandomAccessFile(y, "r").use { b ->
        val bytes = ByteArray(BLOCK * 4)
        val xs = FloatArray(BLOCK); val ys = FloatArray(BLOCK)
        var at = 0L
        while (at < length) {
          val n = minOf(BLOCK.toLong(), length - at).toInt()
          a.readFully(bytes, 0, n * 4); ByteBuffer.wrap(bytes, 0, n * 4).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(xs, 0, n)
          b.readFully(bytes, 0, n * 4); ByteBuffer.wrap(bytes, 0, n * 4).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(ys, 0, n)
          body(xs, ys, n, at)
          at += n
        }
      }
    }
  }

  private fun writeMix(id: String, limitDb: Double?, keep: Boolean): Map<String, Any> {
    val dir = folder(id) ?: throw IllegalStateException("Context not available")
    val x = File(dir, "x.f32"); val y = File(dir, "y.f32")
    if (!y.exists() || y.length() == 0L) throw IllegalStateException("Nothing cleaned for this part")
    val length = (y.length() / 4).toInt()
    // A new preview replaces the last; a player still holding the last keeps reading it until it lets go.
    dir.listFiles()?.filter { it.name.startsWith("mix-") }?.forEach { it.delete() }
    mixes += 1
    val wav = File(dir, if (keep) "kept.wav" else "mix-$mixes.wav")
    try {
      FileOutputStream(wav).use { out ->
        out.write(wavHeader(length))
        val gain = DeepFilter.mixGain(limitDb)
        both(x, y, length) { a, b, n, _ ->
          val pcm = DeepFilter.pcm16(DeepFilter.mix(a, b, n, gain))
          val bytes = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
          bytes.asShortBuffer().put(pcm)
          out.write(bytes.array())
        }
      }
    } catch (e: Exception) {
      wav.delete()
      throw e
    }
    if (!keep) return mapOf("uri" to "file://${wav.absolutePath}", "format" to "wav")
    val m4a = File(dir, "kept.m4a")
    try { AacEncoder.encode(wav, m4a) } finally { wav.delete() }
    return mapOf("uri" to "file://${m4a.absolutePath}", "format" to "m4a")
  }

  companion object {
    /** Bars a part is drawn with (barsModel.ts BAR_COUNT). */
    const val BAR_COUNT = 64
    private const val BLOCK = 65536

    private fun floatBytes(x: FloatArray, count: Int): ByteArray {
      val b = ByteBuffer.allocate(count * 4).order(ByteOrder.LITTLE_ENDIAN)
      b.asFloatBuffer().put(x, 0, count)
      return b.array()
    }

    /** A 16-bit mono WAV's header at 48 kHz, as the recorder writes them. */
    private fun wavHeader(samples: Int): ByteArray {
      val rate = DeepFilter.RATE; val bytes = samples * 2
      val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      h.put("RIFF".toByteArray()); h.putInt(36 + bytes); h.put("WAVE".toByteArray())
      h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1); h.putInt(rate); h.putInt(rate * 2); h.putShort(2); h.putShort(16)
      h.put("data".toByteArray()); h.putInt(bytes)
      return h.array()
    }
  }
}

/**
 * DeepFilterNet3 (models/README.md) through ONNX Runtime: one run's features
 * in, its gains and filter out. Four threads: it runs while the person
 * waits, and the model is most of the time a part takes.
 */
class CleanUpModel private constructor(private val env: OrtEnvironment, private val session: OrtSession) : AutoCloseable {
  fun run(erb: FloatArray, spec: FloatArray, frames: Int): DeepFilter.ModelAnswer {
    OnnxTensor.createTensor(env, FloatBuffer.wrap(erb), longArrayOf(1, 1, frames.toLong(), 32)).use { e ->
      OnnxTensor.createTensor(env, FloatBuffer.wrap(spec), longArrayOf(1, 2, frames.toLong(), 96)).use { s ->
        session.run(mapOf("feat_erb" to e, "feat_spec" to s)).use { out ->
          val mask = (out.get("erb_mask").get() as OnnxTensor).floatBuffer
          val coefs = (out.get("df_coefs").get() as OnnxTensor).floatBuffer
          return DeepFilter.ModelAnswer(FloatArray(mask.remaining()).also { mask.get(it) }, FloatArray(coefs.remaining()).also { coefs.get(it) })
        }
      }
    }
  }

  override fun close() { session.close() }

  companion object {
    fun load(context: Context): CleanUpModel {
      val bytes = context.assets.open("deepfilter.onnx").use { it.readBytes() }
      val env = OrtEnvironment.getEnvironment()
      val options = OrtSession.SessionOptions().apply { setIntraOpNumThreads(4); setInterOpNumThreads(1) }
      return CleanUpModel(env, env.createSession(bytes, options))
    }
  }
}
