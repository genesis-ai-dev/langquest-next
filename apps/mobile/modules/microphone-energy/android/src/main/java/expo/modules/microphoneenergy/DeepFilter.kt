package expo.modules.microphoneenergy

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln1p
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Clean up's arithmetic (decision 178): a line-for-line port of
 * src/deepFilter.ts, which the web runs and the tests hold. Keep the two in
 * step. Everything around DeepFilterNet3 but the network: the part at
 * 48 kHz, its frames and the model's features, the model a stretch at a
 * time, and the frames put back, a run at a time so a long part takes no
 * more memory than a short one. Pure, so it runs on a computer's JVM too.
 */
object DeepFilter {
  const val RATE = 48000
  const val TOOL = "deepfilternet3"
  private const val N = 960
  private const val H = 480
  private const val F = 481
  private const val NE = 32
  private const val NDF = 96
  private const val ORDER = 5
  private const val LA = 2
  private const val ALPHA = 0.99

  // ---- FFT ----

  /** A complex FFT of any length made of 2, 3, 4 and 5 (Stockham, self-sorting). Forward, unnormalised. */
  class ComplexFft(val n: Int) {
    private class Stage(val r: Int, val m: Int, val s: Int, val wr: DoubleArray, val wi: DoubleArray)
    private val stages = ArrayList<Stage>()
    private val ar = DoubleArray(n)
    private val ai = DoubleArray(n)
    private val br = DoubleArray(n)
    private val bi = DoubleArray(n)

    init {
      var left = n
      val radices = ArrayList<Int>()
      for (r in intArrayOf(4, 2, 3, 5)) while (left % r == 0) { radices.add(r); left /= r }
      require(left == 1 && n >= 1) { "FFT length $n is not made of 2, 3 and 5" }
      var len = n
      var s = 1
      for (r in radices) {
        val m = len / r
        val wr = DoubleArray(m * (r - 1))
        val wi = DoubleArray(m * (r - 1))
        for (p in 0 until m) for (k in 1 until r) {
          val a = -2 * PI * p * k / len
          wr[p * (r - 1) + k - 1] = cos(a)
          wi[p * (r - 1) + k - 1] = sin(a)
        }
        stages.add(Stage(r, m, s, wr, wi))
        len = m
        s *= r
      }
    }

    fun forward(re: DoubleArray, im: DoubleArray) {
      var xr = ar; var xi = ai; var yr = br; var yi = bi
      System.arraycopy(re, 0, xr, 0, n); System.arraycopy(im, 0, xi, 0, n)
      for (st in stages) {
        val r = st.r; val m = st.m; val s = st.s; val wr = st.wr; val wi = st.wi
        val step = s * m
        when (r) {
          4 -> for (p in 0 until m) {
            val w = p * 3
            val w1r = wr[w]; val w1i = wi[w]; val w2r = wr[w + 1]; val w2i = wi[w + 1]; val w3r = wr[w + 2]; val w3i = wi[w + 2]
            for (q in 0 until s) {
              val at = q + s * p; val out = q + 4 * s * p
              val a0r = xr[at]; val a0i = xi[at]; val a1r = xr[at + step]; val a1i = xi[at + step]
              val a2r = xr[at + 2 * step]; val a2i = xi[at + 2 * step]; val a3r = xr[at + 3 * step]; val a3i = xi[at + 3 * step]
              val t0r = a0r + a2r; val t0i = a0i + a2i; val t1r = a0r - a2r; val t1i = a0i - a2i
              val t2r = a1r + a3r; val t2i = a1i + a3i; val t3r = a1r - a3r; val t3i = a1i - a3i
              val v1r = t1r + t3i; val v1i = t1i - t3r; val v2r = t0r - t2r; val v2i = t0i - t2i; val v3r = t1r - t3i; val v3i = t1i + t3r
              yr[out] = t0r + t2r; yi[out] = t0i + t2i
              yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
              yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
              yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r
            }
          }
          2 -> for (p in 0 until m) {
            val w1r = wr[p]; val w1i = wi[p]
            for (q in 0 until s) {
              val at = q + s * p; val out = q + 2 * s * p
              val a0r = xr[at]; val a0i = xi[at]; val a1r = xr[at + step]; val a1i = xi[at + step]
              val vr = a0r - a1r; val vi = a0i - a1i
              yr[out] = a0r + a1r; yi[out] = a0i + a1i
              yr[out + s] = vr * w1r - vi * w1i; yi[out + s] = vr * w1i + vi * w1r
            }
          }
          3 -> for (p in 0 until m) {
            val w = p * 2
            val w1r = wr[w]; val w1i = wi[w]; val w2r = wr[w + 1]; val w2i = wi[w + 1]
            for (q in 0 until s) {
              val at = q + s * p; val out = q + 3 * s * p
              val a0r = xr[at]; val a0i = xi[at]; val a1r = xr[at + step]; val a1i = xi[at + step]; val a2r = xr[at + 2 * step]; val a2i = xi[at + 2 * step]
              val tr = a1r + a2r; val ti = a1i + a2i; val dr = (a1r - a2r) * S3; val di = (a1i - a2i) * S3
              val mr = a0r - 0.5 * tr; val mi = a0i - 0.5 * ti
              val v1r = mr + di; val v1i = mi - dr; val v2r = mr - di; val v2i = mi + dr
              yr[out] = a0r + tr; yi[out] = a0i + ti
              yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
              yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
            }
          }
          else -> for (p in 0 until m) {
            val w = p * 4
            val w1r = wr[w]; val w1i = wi[w]; val w2r = wr[w + 1]; val w2i = wi[w + 1]
            val w3r = wr[w + 2]; val w3i = wi[w + 2]; val w4r = wr[w + 3]; val w4i = wi[w + 3]
            for (q in 0 until s) {
              val at = q + s * p; val out = q + 5 * s * p
              val a0r = xr[at]; val a0i = xi[at]; val a1r = xr[at + step]; val a1i = xi[at + step]; val a2r = xr[at + 2 * step]; val a2i = xi[at + 2 * step]
              val a3r = xr[at + 3 * step]; val a3i = xi[at + 3 * step]; val a4r = xr[at + 4 * step]; val a4i = xi[at + 4 * step]
              val b1r = a1r + a4r; val b1i = a1i + a4i; val b2r = a2r + a3r; val b2i = a2i + a3i
              val d1r = a1r - a4r; val d1i = a1i - a4i; val d2r = a2r - a3r; val d2i = a2i - a3i
              val r1r = a0r + C51 * b1r + C52 * b2r; val r1i = a0i + C51 * b1i + C52 * b2i
              val r2r = a0r + C52 * b1r + C51 * b2r; val r2i = a0i + C52 * b1i + C51 * b2i
              val i1r = S51 * d1r + S52 * d2r; val i1i = S51 * d1i + S52 * d2i
              val i2r = S52 * d1r - S51 * d2r; val i2i = S52 * d1i - S51 * d2i
              val v1r = r1r + i1i; val v1i = r1i - i1r; val v2r = r2r + i2i; val v2i = r2i - i2r
              val v3r = r2r - i2i; val v3i = r2i + i2r; val v4r = r1r - i1i; val v4i = r1i + i1r
              yr[out] = a0r + b1r + b2r; yi[out] = a0i + b1i + b2i
              yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
              yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
              yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r
              yr[out + 4 * s] = v4r * w4r - v4i * w4i; yi[out + 4 * s] = v4r * w4i + v4i * w4r
            }
          }
        }
        val tr = xr; val ti = xi
        xr = yr; xi = yi; yr = tr; yi = ti
      }
      System.arraycopy(xr, 0, re, 0, n); System.arraycopy(xi, 0, im, 0, n)
    }
  }

  private val S3 = sqrt(3.0) / 2
  private val C51 = cos(2 * PI / 5)
  private val C52 = cos(4 * PI / 5)
  private val S51 = sin(2 * PI / 5)
  private val S52 = sin(4 * PI / 5)

  /** A real FFT of an even length through a complex one of half its length; `inverse` is unnormalised (n times the frame). */
  class RealFft(val n: Int) {
    private val h = n / 2
    private val half = ComplexFft(h)
    private val wr = DoubleArray(h + 1) { cos(2 * PI * it / n) }
    private val wi = DoubleArray(h + 1) { -sin(2 * PI * it / n) }
    private val zr = DoubleArray(h)
    private val zi = DoubleArray(h)

    init { require(n % 2 == 0) { "A real FFT needs an even length" } }

    fun forward(x: DoubleArray, re: DoubleArray, im: DoubleArray) {
      for (j in 0 until h) { zr[j] = x[2 * j]; zi[j] = x[2 * j + 1] }
      half.forward(zr, zi)
      for (k in 0..h) {
        val a = k % h; val b = (h - k) % h
        val er = 0.5 * (zr[a] + zr[b]); val ei = 0.5 * (zi[a] - zi[b])
        val or = 0.5 * (zi[a] + zi[b]); val oi = -0.5 * (zr[a] - zr[b])
        re[k] = er + wr[k] * or - wi[k] * oi
        im[k] = ei + wr[k] * oi + wi[k] * or
      }
    }

    fun inverse(re: DoubleArray, im: DoubleArray, out: DoubleArray) {
      for (k in 0 until h) {
        val b = h - k
        val ik = if (k == 0) 0.0 else im[k]; val ib = if (k == 0) 0.0 else im[b]
        val er = 0.5 * (re[k] + re[b]); val ei = 0.5 * (ik - ib)
        val dr = 0.5 * (re[k] - re[b]); val di = 0.5 * (ik + ib)
        val cr = wr[k]; val ci = -wi[k]
        val or = dr * cr - di * ci; val oi = dr * ci + di * cr
        zr[k] = er - oi
        zi[k] = -(ei + or)
      }
      half.forward(zr, zi)
      for (j in 0 until h) { out[2 * j] = 2 * zr[j]; out[2 * j + 1] = -2 * zi[j] }
    }
  }

  // ---- resampling ----

  private const val ZEROS = 16
  private const val KAISER_BETA = 8.6

  private fun besselI0(x: Double): Double {
    var s = 1.0; var t = 1.0
    for (k in 1 until 30) { t *= (x / (2 * k)).pow(2); s += t }
    return s
  }
  private tailrec fun gcd(a: Long, b: Long): Long = if (b == 0L) a else gcd(b, a % b)

  /**
   * A part at rate `from` brought to rate `to` as it is read, a piece at a time, with a Kaiser-windowed sinc.
   * It holds only the inputs its next outputs need (deepFilter.ts Resampler).
   */
  class Resampler(val from: Int, val to: Int) {
    private val up: Long
    private val down: Long
    private val span: Int
    private val taps: Int
    private val cutoff: Double
    private val i0 = besselI0(KAISER_BETA)
    private val table: DoubleArray?
    private var buf = FloatArray(0)
    private var base = 0L
    private var have = 0L
    private var next = 0L

    init {
      val g = gcd(from.toLong(), to.toLong()); up = to / g; down = from / g
      val scale = min(1.0, to.toDouble() / from); cutoff = 0.97 * scale; span = ceil(ZEROS / scale).toInt(); taps = 2 * span
      table = if (up > 4096) null else {
        val t = DoubleArray(up.toInt() * taps)
        for (f in 0 until up.toInt()) {
          var sum = 0.0
          for (j in 0 until taps) { val v = h(f.toDouble() / up - (j - span + 1)); t[f * taps + j] = v; sum += v }
          for (j in 0 until taps) t[f * taps + j] /= sum
        }
        t
      }
    }

    private fun h(d: Double): Double {
      val u = abs(d) / span
      if (u >= 1) return 0.0
      val w = besselI0(KAISER_BETA * sqrt(1 - u * u)) / i0
      val a = PI * d * cutoff
      return (if (a == 0.0) 1.0 else sin(a) / a) * w
    }

    private fun centre(i: Long): Long = if (table != null) Math.floorDiv(i * down, up) else floor(i.toDouble() * from / to).toLong()

    /** More of the part; the outputs it completes. */
    fun push(x: FloatArray): FloatArray {
      if (from == to) { have += x.size; return x.copyOf() }
      val keepFrom = max(base, min(have, centre(next) - span + 1))
      val kept = (have - keepFrom).toInt()
      val nb = FloatArray(kept + x.size)
      System.arraycopy(buf, (keepFrom - base).toInt(), nb, 0, kept)
      System.arraycopy(x, 0, nb, kept, x.size)
      buf = nb; base = keepFrom; have += x.size
      var last = next
      while (centre(last) + span < have) last++
      return outputs(last)
    }

    /** The part has ended: the outputs left, up to its length at the new rate. */
    fun end(): FloatArray = if (from == to) FloatArray(0) else outputs(have * up / down)

    private fun outputs(until: Long): FloatArray {
      val out = FloatArray(max(0L, until - next).toInt())
      val t = table
      for (i in next until until) {
        var acc = 0.0
        if (t != null) {
          val at = i * down; val c = at / up; val f = (at - c * up).toInt(); val first = c - span + 1; val row = f * taps
          if (first >= 0 && first + taps <= have) {
            val o = (first - base).toInt()
            for (j in 0 until taps) acc += buf[o + j] * t[row + j]
          } else {
            for (j in 0 until taps) { val k = first + j; if (k >= 0 && k < have) acc += buf[(k - base).toInt()] * t[row + j] }
          }
          out[(i - next).toInt()] = acc.toFloat()
        } else {
          val tt = i.toDouble() * from / to; val c = floor(tt).toLong()
          var sum = 0.0
          for (k in max(0L, c - span + 1)..min(have - 1, c + span)) { val v = h(tt - k); acc += buf[(k - base).toInt()] * v; sum += v }
          out[(i - next).toInt()] = if (sum == 0.0) 0f else (acc / sum).toFloat()
        }
      }
      next = max(next, until)
      return out
    }
  }

  /** A whole part at rate `from` brought to rate `to`. */
  fun resample(x: FloatArray, from: Int, to: Int): FloatArray {
    val r = Resampler(from, to)
    return r.push(x) + r.end()
  }

  // ---- frames and features ----

  /** How many bins each ERB band holds, lowest first (libDF erb_fb with min_nb_freqs 2): they add up to 481. */
  val ERB_WIDTHS: IntArray = run {
    fun toErb(f: Double) = 9.265 * ln1p(f / (24.7 * 9.265))
    fun fromErb(e: Double) = 24.7 * 9.265 * (kotlin.math.exp(e / 9.265) - 1)
    val lo = toErb(0.0); val hi = toErb(RATE / 2.0); val step = (hi - lo) / NE; val binHz = RATE.toDouble() / N
    val widths = IntArray(NE)
    var prev = 0; var over = 0
    for (i in 1..NE) {
      // libDF rounds an f32: Math.fround in the TypeScript.
      val bin = roundHalfUp((fromErb(lo + i * step) / binHz).toFloat().toDouble())
      var w = bin - prev - over
      if (w < 2) { over = 2 - w; w = 2 } else over = 0
      widths[i - 1] = w
      prev = bin
    }
    widths[NE - 1] += 1
    val extra = widths.sum() - F
    if (extra > 0) widths[NE - 1] -= extra
    widths
  }
  private val EDGES = IntArray(NE + 1).also { e -> for (b in 0 until NE) e[b + 1] = e[b] + ERB_WIDTHS[b] }

  /** JavaScript's Math.round: halves go up. */
  private fun roundHalfUp(v: Double): Int = floor(v + 0.5).toInt()

  private val WINDOW = DoubleArray(N) { val s = sin(0.5 * PI * (it + 0.5) / (N / 2)); sin(0.5 * PI * s * s) }
  private const val WNORM = 1.0 / (N.toDouble() * N / (2 * H))

  // ---- the model, a stretch at a time ----

  const val RUN_FRAMES = 1000
  const val RUN_SETTLE = 300
  const val RUN_CROSS = 100

  class ModelRun(val from: Int, val to: Int, val keep: Int, val cross: Int)

  fun modelRuns(frames: Int): List<ModelRun> {
    val out = ArrayList<ModelRun>()
    var s = 0
    while (s < frames) {
      val e = min(frames, s + RUN_FRAMES)
      out.add(ModelRun(max(0, s - RUN_SETTLE), if (e < frames) min(frames, e + RUN_CROSS) else frames, s, if (s > 0) RUN_CROSS else 0))
      s = e
    }
    return out
  }

  /** What the model says for `n` frames: a gain per band, [1, 1, n, 32], and the filter, [1, 5, n, 96, 2]. */
  class ModelAnswer(val mask: FloatArray, val coefs: FloatArray)

  // ---- the whole part ----

  /** How many frames cover a part of `length` samples with the half frame it lags by. */
  fun frameCount(length: Int): Int = (length + N) / H

  /**
   * A part at 48 kHz cleaned at full strength, read and written a run at a time (deepFilter.ts deepFilter).
   * `read` fills `into` with the part's samples from `at` on (zeros past its end); `net` runs the network on
   * one run's features; `write` takes the cleaned sound in order, `length` samples in all.
   */
  fun clean(
    length: Int,
    read: (at: Long, into: FloatArray) -> Unit,
    net: (erb: FloatArray, spec: FloatArray, frames: Int) -> ModelAnswer,
    write: (y: FloatArray, count: Int) -> Unit,
    progress: (Double) -> Unit
  ) {
    val frames = frameCount(length)
    val runs = modelRuns(frames)
    val held = min(frames, RUN_FRAMES + RUN_SETTLE + RUN_CROSS)
    val re = FloatArray(held * F); val im = FloatArray(held * F)
    val erb = FloatArray(held * NE); val specRe = FloatArray(held * NDF); val specIm = FloatArray(held * NDF)
    var lo = 0; var analysed = 0
    val fft = RealFft(N)
    val buf = DoubleArray(N); val xr = DoubleArray(F); val xi = DoubleArray(F); val mem = DoubleArray(N - H)
    val meanErb = DoubleArray(NE) { -60.0 + it * -30.0 / (NE - 1) }
    val unit = DoubleArray(NDF) { 0.001 + it * (0.0001 - 0.001) / (NDF - 1) }
    val mask = FloatArray(NE); val coefs = FloatArray(ORDER * NDF * 2)
    val er = DoubleArray(F); val ei = DoubleArray(F); val frame = DoubleArray(N); val out = DoubleArray(N - H)
    val tailMask = FloatArray(RUN_CROSS * NE); val tailCoefs = FloatArray(ORDER * RUN_CROSS * NDF * 2)
    var tailFrom = 0
    var skip = N - H; var left = length

    for ((r, run) in runs.withIndex()) {
      val shift = run.from - lo
      if (shift > 0) {
        val kept = analysed - run.from
        System.arraycopy(re, shift * F, re, 0, kept * F); System.arraycopy(im, shift * F, im, 0, kept * F)
        System.arraycopy(erb, shift * NE, erb, 0, kept * NE)
        System.arraycopy(specRe, shift * NDF, specRe, 0, kept * NDF); System.arraycopy(specIm, shift * NDF, specIm, 0, kept * NDF)
        lo = run.from
      }
      val x = FloatArray((run.to - analysed) * H)
      read(analysed.toLong() * H, x)
      for (t in analysed until run.to) {
        for (i in 0 until N - H) buf[i] = mem[i] * WINDOW[i]
        val at = (t - analysed) * H
        for (i in 0 until H) {
          val v = x[at + i].toDouble()
          buf[N - H + i] = v * WINDOW[N - H + i]
          mem[i] = v
        }
        fft.forward(buf, xr, xi)
        val row = (t - lo) * F
        for (k in 0 until F) { re[row + k] = (xr[k] * WNORM).toFloat(); im[row + k] = (xi[k] * WNORM).toFloat() }
        for (b in 0 until NE) {
          var e = 0.0
          for (k in EDGES[b] until EDGES[b + 1]) { val a = re[row + k].toDouble(); val c = im[row + k].toDouble(); e += a * a + c * c }
          val db = 10 * log10(e / ERB_WIDTHS[b] + 1e-10)
          meanErb[b] = db * (1 - ALPHA) + meanErb[b] * ALPHA
          erb[(t - lo) * NE + b] = ((db - meanErb[b]) / 40).toFloat()
        }
        for (k in 0 until NDF) {
          val a = re[row + k].toDouble(); val c = im[row + k].toDouble()
          unit[k] = hypot(a, c) * (1 - ALPHA) + unit[k] * ALPHA
          val d = sqrt(unit[k])
          specRe[(t - lo) * NDF + k] = (a / d).toFloat()
          specIm[(t - lo) * NDF + k] = (c / d).toFloat()
        }
      }
      analysed = run.to

      val n = run.to - run.from
      val spec = FloatArray(2 * n * NDF)
      System.arraycopy(specRe, 0, spec, 0, n * NDF); System.arraycopy(specIm, 0, spec, n * NDF, n * NDF)
      val answer = net(erb.copyOfRange(0, n * NE), spec, n)

      val end = min(frames, run.keep + RUN_FRAMES)
      val y = FloatArray((end - run.keep) * H)
      for (t in run.keep until end) {
        val u = t - run.from
        val w = if (t < run.keep + run.cross) (t - run.keep + 0.5) / run.cross else 1.0
        val v = t - tailFrom
        for (b in 0 until NE) mask[b] = if (w == 1.0) answer.mask[u * NE + b] else ((1 - w) * tailMask[v * NE + b] + w * answer.mask[u * NE + b]).toFloat()
        for (o in 0 until ORDER) {
          val into = o * NDF * 2; val from = ((o * n + u) * NDF) * 2; val tail = ((o * RUN_CROSS + v) * NDF) * 2
          for (k in 0 until NDF * 2) coefs[into + k] = if (w == 1.0) answer.coefs[from + k] else ((1 - w) * tailCoefs[tail + k] + w * answer.coefs[from + k]).toFloat()
        }
        val row = (t - lo) * F
        for (b in 0 until NE) {
          val g = mask[b].toDouble()
          for (k in EDGES[b] until EDGES[b + 1]) { er[k] = re[row + k] * g; ei[k] = im[row + k] * g }
        }
        for (k in 0 until NDF) {
          var sr = 0.0; var si = 0.0
          for (o in 0 until ORDER) {
            val tt = t - (ORDER - 1 - LA) + o
            if (tt < 0 || tt >= frames) continue
            val c = (o * NDF + k) * 2
            val cr = coefs[c].toDouble(); val ci = coefs[c + 1].toDouble()
            val a = re[(tt - lo) * F + k].toDouble(); val b = im[(tt - lo) * F + k].toDouble()
            sr += a * cr - b * ci
            si += a * ci + b * cr
          }
          er[k] = sr; ei[k] = si
        }
        fft.inverse(er, ei, frame)
        val at = (t - run.keep) * H
        for (i in 0 until H) y[at + i] = (frame[i] * WINDOW[i] + out[i]).toFloat()
        for (i in 0 until N - H) out[i] = frame[H + i] * WINDOW[H + i]
      }
      val from = min(skip, y.size); val count = min(left, y.size - from)
      skip -= from
      if (count > 0) { write(if (from == 0) y else y.copyOfRange(from, from + count), count); left -= count }

      tailFrom = end
      for (v in 0 until run.to - end) {
        val u = end + v - run.from
        System.arraycopy(answer.mask, u * NE, tailMask, v * NE, NE)
        for (o in 0 until ORDER) System.arraycopy(answer.coefs, ((o * n + u) * NDF) * 2, tailCoefs, ((o * RUN_CROSS + v) * NDF) * 2, NDF * 2)
      }
      progress((r + 1).toDouble() / runs.size)
    }
  }

  fun mixGain(limitDb: Double?): Double = if (limitDb == null) 0.0 else 10.0.pow(-abs(limitDb) / 20)

  fun mix(x: FloatArray, y: FloatArray, size: Int, gain: Double): FloatArray = FloatArray(size) { (gain * x[it] + (1 - gain) * y[it]).toFloat() }

  /** Per slice of even slices: how many samples, and the sums of x*x, x*y and y*y (deepFilter.ts SliceSums). */
  class SliceSums(count: Int) {
    val n = DoubleArray(count); val xx = DoubleArray(count); val xy = DoubleArray(count); val yy = DoubleArray(count)

    /** Adds a stretch of both sounds, from sample `at` of a part `total` samples long. */
    fun add(x: FloatArray, y: FloatArray, size: Int, at: Long, total: Long) {
      val count = n.size; val per = max(1.0, total.toDouble() / count)
      for (i in 0 until size) {
        val k = min(count - 1, floor((at + i) / per).toInt()); val a = x[i].toDouble(); val b = y[i].toDouble()
        n[k] += 1.0; xx[k] += a * a; xy[k] += a * b; yy[k] += b * b
      }
    }
  }

  /** Samples from -1 to 1 as 16-bit PCM, as the recorder writes them (JavaScript's Math.round). */
  fun pcm16(x: FloatArray): ShortArray = ShortArray(x.size) { roundHalfUp(max(-1.0, min(1.0, x[it].toDouble())) * 32767).toShort() }
}
