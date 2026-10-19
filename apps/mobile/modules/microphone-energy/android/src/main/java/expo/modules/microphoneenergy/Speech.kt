package expo.modules.microphoneenergy

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * Is this sound speech? (decision 135): a line-for-line port of
 * src/speech.ts, which the web module and the tests run. Keep the two in
 * step. The microphone's 44.1 kHz brought down to the model's 16 kHz, cut
 * into 512-sample chunks with the 64 samples before each; SpeechModel runs
 * Silero on them.
 */
object Silero {
  const val SAMPLE_RATE = 16000
  const val CHUNK = 512
  const val CONTEXT = 64
}

/** Half the resampling filter's length, in input samples. */
private const val TAPS = 16

/** Streams one rate into another with a windowed-sinc filter, low-passed under the slower rate's half. */
class Resampler(inRate: Double, outRate: Double = Silero.SAMPLE_RATE.toDouble()) {
  private val step = inRate / outRate
  private val cutoff = min(1.0, outRate / inRate) * 0.45
  private val buf = ArrayList<Double>()
  private var at = TAPS.toDouble()

  /** Some input; every output sample it completes goes to `out`. */
  fun push(input: FloatArray, count: Int, out: (Double) -> Unit) {
    for (i in 0 until count) buf.add(input[i].toDouble())
    while (at + TAPS < buf.size) {
      val centre = floor(at).toInt()
      var sum = 0.0
      var weights = 0.0
      for (k in centre - TAPS + 1..centre + TAPS) {
        val d = at - k
        val w = 0.5 + 0.5 * cos(PI * d / TAPS)
        val x = 2 * PI * cutoff * d
        val h = (if (d == 0.0) 1.0 else sin(x) / x) * w
        sum += buf[k] * h
        weights += h
      }
      out(if (weights == 0.0) 0.0 else sum / weights)
      at += step
    }
    val drop = floor(at).toInt() - TAPS
    if (drop > 0) { buf.subList(0, drop).clear(); at -= drop }
  }
}

/** The model's chunks: each 512 new samples, with the 64 before them in front. */
class SpeechChunks {
  private var ctx = FloatArray(Silero.CONTEXT)
  private var cur = FloatArray(Silero.CHUNK)
  private var n = 0

  fun push(sample: Double): FloatArray? {
    cur[n++] = sample.toFloat()
    if (n < Silero.CHUNK) return null
    val input = FloatArray(Silero.CONTEXT + Silero.CHUNK)
    System.arraycopy(ctx, 0, input, 0, Silero.CONTEXT)
    System.arraycopy(cur, 0, input, Silero.CONTEXT, Silero.CHUNK)
    ctx = cur.copyOfRange(Silero.CHUNK - Silero.CONTEXT, Silero.CHUNK)
    cur = FloatArray(Silero.CHUNK)
    n = 0
    return input
  }

  fun reset() { ctx = FloatArray(Silero.CONTEXT); n = 0 }
}

/** A frame's score: the surest chunk that ended in it, or the last chunk's when none did. */
fun frameScore(scores: List<Double>, last: Double): Double = if (scores.isEmpty()) last else scores.max()

/**
 * Silero VAD (models/README.md) through ONNX Runtime: scores one chunk as
 * speech, 0..1, carrying its state from chunk to chunk. One thread; it runs
 * on the microphone's own thread, about a millisecond a chunk.
 */
class SpeechModel private constructor(private val env: OrtEnvironment, private val session: OrtSession) {
  private var state = FloatArray(2 * 128)

  fun score(chunk: FloatArray): Double {
    OnnxTensor.createTensor(env, FloatBuffer.wrap(chunk), longArrayOf(1, chunk.size.toLong())).use { input ->
      OnnxTensor.createTensor(env, FloatBuffer.wrap(state), longArrayOf(2, 1, 128)).use { st ->
        OnnxTensor.createTensor(env, Silero.SAMPLE_RATE.toLong()).use { sr ->
          session.run(mapOf("input" to input, "state" to st, "sr" to sr)).use { out ->
            @Suppress("UNCHECKED_CAST")
            val prob = (out.get("output").get().value as Array<FloatArray>)[0][0]
            val next = (out.get("stateN").get() as OnnxTensor).floatBuffer
            state = FloatArray(next.remaining()).also { next.get(it) }
            return prob.toDouble()
          }
        }
      }
    }
  }

  /** Forget what came before: the next chunk starts a new stretch. */
  fun reset() { state = FloatArray(2 * 128) }

  companion object {
    /** The model from the module's assets; null where it cannot load, and parts split by levels alone. */
    fun load(context: Context): SpeechModel? = try {
      val bytes = context.assets.open("silero_vad_16k_op15.onnx").use { it.readBytes() }
      val env = OrtEnvironment.getEnvironment()
      val options = OrtSession.SessionOptions().apply { setIntraOpNumThreads(1); setInterOpNumThreads(1) }
      SpeechModel(env, env.createSession(bytes, options))
    } catch (e: Throwable) {
      android.util.Log.w("MicrophoneEnergy", "speech model not loaded; parts split by levels alone", e)
      null
    }
  }
}
