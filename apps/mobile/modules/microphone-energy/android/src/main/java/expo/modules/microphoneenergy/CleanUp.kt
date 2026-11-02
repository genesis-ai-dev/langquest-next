package expo.modules.microphoneenergy

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors

/**
 * Clean up on an Android phone (decision 179): a part's file read and brought
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

    val length = Sound.decode(File(java.net.URI(uri)), x) { done -> check(); progress(0.1 * done) }
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
          { part, count -> writer.write(Sound.floatBytes(part, count)) },
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
        out.write(Sound.wavHeader(length))
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
