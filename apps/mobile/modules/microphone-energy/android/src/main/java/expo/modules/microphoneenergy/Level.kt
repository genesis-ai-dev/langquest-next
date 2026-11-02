package expo.modules.microphoneenergy

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Even loudness on an Android phone (decision 182): a recording read and
 * brought to 48 kHz (Sound.decode), measured (Meter), and, when a copy is
 * asked for, the copy turned to the loudness asked for with its peaks held
 * under the ceiling (Limiter), written as a 16-bit WAV to play. Meter
 * follows loudnessModel.ts and Limiter levelModel.ts line for line; every
 * number comes from levelModel.ts LEVEL. Recordings are taken one at a time,
 * on a thread of their own, and their 48 kHz floats stay in the cache only
 * while one is worked on.
 */
class Level(private val context: () -> Context?) {
  private val worker = Executors.newSingleThreadExecutor()
  /** Work files made, and whether those an app stopped mid-way left behind are gone. On the worker only. */
  private var made = 0
  private var swept = false

  /** The recording at `uri` measured and, with `out`, its copy written there: what was heard, the gain, and whether a copy was written. */
  fun level(uri: String, out: String?, options: Map<String, Any?>, done: (Map<String, Any?>?, Exception?) -> Unit) {
    worker.execute {
      try { done(run(uri, out, Options(options)), null) } catch (e: Exception) { done(null, e) }
    }
  }

  /** levelModel.ts LEVEL. */
  class Options(o: Map<String, Any?>) {
    val targetLufs = num(o, "targetLufs"); val maxBoostDb = num(o, "maxBoostDb"); val minChangeDb = num(o, "minChangeDb")
    val voicelessDb = num(o, "voicelessDb")
    val ceilingDb = num(o, "ceilingDb"); val lookaheadS = num(o, "lookaheadS"); val releaseS = num(o, "releaseS")
    val passes = num(o, "passes").toInt()

    private companion object {
      fun num(o: Map<String, Any?>, key: String): Double = (o[key] as? Number)?.toDouble() ?: throw IllegalArgumentException("no $key")
    }
  }

  private fun run(uri: String, out: String?, o: Options): Map<String, Any?> {
    val ctx = context() ?: throw IllegalStateException("Context not available")
    val dir = File(ctx.cacheDir, "LevelWork")
    if (!swept) { swept = true; dir.deleteRecursively() }
    dir.mkdirs()
    made += 1
    val x = File(dir, "x-$made.f32")
    try {
      val length = Sound.decode(fileOf(uri), x) {}
      val meter = Meter(DeepFilter.RATE, length.toLong())
      blocks(x, length) { a, n -> meter.add(a, n) }
      val m = meter.measured()
      var gain = playGain(m.lufs, m.noiseDb, o)
      // A silent part has no loudness and no room: those are left out, as the iPhone leaves them.
      val answer = hashMapOf<String, Any>("peakDb" to m.peakDb, "amps" to m.amps.toList(), "gainDb" to gain, "written" to false)
      m.lufs?.let { answer["lufs"] = it }
      m.noiseDb?.let { answer["noiseDb"] = it }
      if (out == null || abs(gain) < o.minChangeDb) return answer
      val target = fileOf(out)
      val part = File(target.parentFile, target.name + ".part")
      try {
        var next: Double? = gain
        var pass = 1
        while (next != null) {
          gain = next
          val heard = Meter(DeepFilter.RATE, length.toLong())
          FileOutputStream(part).use { w ->
            w.write(Sound.wavHeader(length))
            val limiter = Limiter(DeepFilter.RATE, gain, o.ceilingDb, o.lookaheadS, o.releaseS)
            val put = { y: FloatArray ->
              heard.add(y, y.size)
              val pcm = DeepFilter.pcm16(y)
              val bytes = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
              bytes.asShortBuffer().put(pcm)
              w.write(bytes.array())
            }
            blocks(x, length) { a, n -> put(limiter.push(a, n)) }
            put(limiter.end())
          }
          next = nextGain(gain, heard.measured().lufs, pass, o)
          pass += 1
        }
        if (!part.renameTo(target)) throw IllegalStateException("could not keep the copy")
      } finally {
        part.delete()
      }
      answer["gainDb"] = gain
      answer["written"] = true
      return answer
    } finally {
      x.delete()
    }
  }

  private fun fileOf(uri: String): File = if (uri.startsWith("file:")) File(java.net.URI(uri)) else File(uri)

  /** The floats a block at a time: `body` gets a stretch and its size. */
  private fun blocks(x: File, length: Int, body: (FloatArray, Int) -> Unit) {
    RandomAccessFile(x, "r").use { a ->
      val bytes = ByteArray(BLOCK * 4)
      val xs = FloatArray(BLOCK)
      var at = 0L
      while (at < length) {
        val n = minOf(BLOCK.toLong(), length - at).toInt()
        a.readFully(bytes, 0, n * 4); ByteBuffer.wrap(bytes, 0, n * 4).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(xs, 0, n)
        body(xs, n)
        at += n
      }
    }
  }

  companion object {
    private const val BLOCK = 65536

    /** loudnessModel.ts playGainDb. */
    fun playGain(lufs: Double?, noiseDb: Double?, o: Options): Double {
      if (lufs == null || (noiseDb != null && lufs - noiseDb < o.voicelessDb)) return 0.0
      return min(o.maxBoostDb, o.targetLufs - lufs)
    }

    /** levelModel.ts nextGain. */
    fun nextGain(gainDb: Double, outLufs: Double?, pass: Int, o: Options): Double? {
      if (outLufs == null || pass >= o.passes) return null
      val next = min(o.maxBoostDb, gainDb + (o.targetLufs - outLufs))
      return if (o.targetLufs - outLufs >= o.minChangeDb && next > gainDb) next else null
    }
  }
}

/** loudnessModel.ts loudnessMeter, line for line: a part's loudness (BS.1770), its loudest sample, the room between its words, and its bars' spread. */
class Meter(rate: Int, frames: Long, private val count: Int = CleanUp.BAR_COUNT) {
  class Measured(val lufs: Double?, val peakDb: Double, val noiseDb: Double?, val amps: DoubleArray)

  private val sb0: Double; private val sb1: Double; private val sb2: Double; private val sa1: Double; private val sa2: Double
  private val ca1: Double; private val ca2: Double
  private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0; private var z1 = 0.0; private var z2 = 0.0
  private val step = max(1, round(rate * STEP_S))
  private val steps = ArrayList<Double>()
  private var stepSum = 0.0; private var stepN = 0
  private val slice = max(1, round(rate * SLICE_S))
  private val rooms = ArrayList<Double>()
  private var sliceSum = 0.0; private var sliceSq = 0.0; private var sliceN = 0
  private var peak = 0.0
  private val per = max(1.0, frames.toDouble() / count)
  private val barSum = DoubleArray(count); private val barSq = DoubleArray(count); private val barN = DoubleArray(count)
  private var bar = 0; private var barEnd = ceil(per); private var at = 0L
  private var bSum = 0.0; private var bSq = 0.0; private var bN = 0.0

  init {
    // The K-weighting's two filters for `rate` (BS.1770, as libebur128 derives them for any rate).
    var f0 = 1681.974450955533; val g = 3.999843853973347; var q = 0.7071752369554196
    var k = tan((PI * f0) / rate)
    val vh = 10.0.pow(g / 20); val vb = vh.pow(0.4996667741545416)
    var a0 = 1 + k / q + k * k
    sb0 = (vh + (vb * k) / q + k * k) / a0; sb1 = (2 * (k * k - vh)) / a0; sb2 = (vh - (vb * k) / q + k * k) / a0
    sa1 = (2 * (k * k - 1)) / a0; sa2 = (1 - k / q + k * k) / a0
    f0 = 38.13547087602444; q = 0.5003270373238773
    k = tan((PI * f0) / rate)
    a0 = 1 + k / q + k * k
    ca1 = (2 * (k * k - 1)) / a0; ca2 = (1 - k / q + k * k) / a0
  }

  private fun closeBar() {
    barSum[bar] += bSum; barSq[bar] += bSq; barN[bar] += bN
    bSum = 0.0; bSq = 0.0; bN = 0.0
  }

  fun add(chunk: FloatArray, n: Int) {
    for (i in 0 until n) {
      val x = chunk[i].toDouble()
      // K-weighted, for the loudness: the shelf, then the cut (whose b is 1, −2, 1).
      val y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2
      val z = y - 2 * y1 + y2 - ca1 * z1 - ca2 * z2
      x2 = x1; x1 = x; y2 = y1; y1 = y; z2 = z1; z1 = z
      stepSum += z * z
      if (++stepN == step) { steps.add(stepSum / step); stepSum = 0.0; stepN = 0 }
      // As recorded, for the room and the bars: each slice's spread about its own middle.
      val xx = x * x
      sliceSum += x; sliceSq += xx
      if (++sliceN == slice) { rooms.add(max(0.0, sliceSq / slice - (sliceSum / slice).pow(2))); sliceSum = 0.0; sliceSq = 0.0; sliceN = 0 }
      if (at.toDouble() == barEnd && bar < count - 1) { closeBar(); bar++; barEnd = ceil((bar + 1) * per) }
      bSum += x; bSq += xx; bN++
      at++
      val m = if (x < 0) -x else x
      if (m > peak) peak = m
    }
  }

  fun measured(): Measured {
    closeBar()
    val blocks = ArrayList<Double>()
    var j = 0
    while (j + STEPS_PER_BLOCK <= steps.size) {
      var sum = 0.0
      for (i in j until j + STEPS_PER_BLOCK) sum += steps[i]
      blocks.add(sum / STEPS_PER_BLOCK)
      j++
    }
    // A part shorter than a block is one block.
    if (blocks.isEmpty() && at > 0) blocks.add((steps.fold(0.0) { s, v -> s + v * step } + stepSum) / at)
    val amps = DoubleArray(count) { if (barN[it] > 0) sqrt(max(0.0, barSq[it] / barN[it] - (barSum[it] / barN[it]).pow(2))) else 0.0 }
    return Measured(gatedLoudness(blocks), if (peak > 0) max(SILENT_DB, 20 * log10(peak)) else SILENT_DB, roomDb(rooms), amps)
  }

  companion object {
    private const val SLICE_S = 0.025
    private const val ROOM_AT = 0.05
    private const val MIN_SLICES = 20
    private const val STEP_S = 0.1
    private const val STEPS_PER_BLOCK = 4
    private const val ABSOLUTE_GATE = -70.0
    private const val RELATIVE_GATE = -10.0
    private const val SILENT_DB = -120.0

    /** JavaScript's Math.round. */
    private fun round(v: Double): Int = floor(v + 0.5).toInt()

    private fun dB(meanSquare: Double): Double = if (meanSquare > 0) max(SILENT_DB, 10 * log10(meanSquare)) else SILENT_DB

    private fun loud(ms: Double): Double = -0.691 + 10 * log10(ms)

    fun gatedLoudness(blocks: List<Double>): Double? {
      val above = blocks.filter { it > 0 && loud(it) > ABSOLUTE_GATE }
      if (above.isEmpty()) return null
      val line = loud(above.sum() / above.size) + RELATIVE_GATE
      val kept = above.filter { loud(it) > line }
      return loud(kept.sum() / kept.size)
    }

    fun roomDb(slices: List<Double>): Double? {
      if (slices.size < MIN_SLICES) return null
      val sorted = slices.sorted()
      return dB(sorted[floor(ROOM_AT * (sorted.size - 1)).toInt()])
    }
  }
}

/** levelModel.ts limiter, line for line: one channel turned by `gainDb`, every sample held at or under `ceilingDb`. */
class Limiter(rate: Int, gainDb: Double, ceilingDb: Double, lookaheadS: Double, releaseS: Double) {
  private val gain = 10.0.pow(gainDb / 20); private val ceiling = 10.0.pow(ceilingDb / 20)
  private val look = max(1, floor(rate * lookaheadS + 0.5).toInt())
  private val ease = 1 - exp(-1 / max(1.0, rate * releaseS))
  private val held = DoubleArray(look)
  private val places = DoubleArray(look); private val asks = DoubleArray(look)
  private var front = 0; private var count = 0
  private val eased = DoubleArray(look)
  private var sum = 0.0
  private var last = gain
  private var taken = 0L
  private var out = FloatArray(BLOCK); private var outN = 0

  init { for (k in 0 until look - 1) take(0.0) }

  private fun take(x: Double) {
    val i = taken++
    held[(i % look).toInt()] = x
    val m = if (x < 0) -x else x
    val ask = if (m * gain > ceiling) ceiling / m else gain
    if (count > 0 && places[front] <= i - look) { front = (front + 1) % look; count-- }
    while (count > 0 && asks[(front + count - 1) % look] >= ask) count--
    places[(front + count) % look] = i.toDouble()
    asks[(front + count) % look] = ask
    count++
    val j = i - look + 1
    if (j < 0) return
    val r = min(asks[front], last + (gain - last) * ease)
    last = r
    val slot = (j % look).toInt()
    sum += r - eased[slot]
    eased[slot] = r
    // The first `look - 1` are the silence before the part.
    if (j < look - 1) return
    val y = held[slot] * (sum / look)
    if (outN == out.size) out = out.copyOf(out.size * 2)
    out[outN++] = (if (y > ceiling) ceiling else if (y < -ceiling) -ceiling else y).toFloat()
  }

  private fun flush(): FloatArray { val done = out.copyOf(outN); outN = 0; return done }

  fun push(chunk: FloatArray, n: Int): FloatArray {
    for (k in 0 until n) take(chunk[k].toDouble())
    return flush()
  }

  fun end(): FloatArray {
    for (k in 0 until look - 1) take(0.0)
    return flush()
  }

  private companion object {
    const val BLOCK = 65536
  }
}
