package expo.modules.microphoneenergy

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Where one part ends and the next begins (LAN-82): a line-for-line port of
 * src/splitter.ts, which the web module and the tests run. Keep the two in
 * step. Nothing said is dropped; the rules only choose where parts split,
 * from two levels learned while listening: the room and the voice. Where the
 * speech model scores each frame (Speech.kt, decision 135), a part is only
 * sound that is both out of the room and speech.
 */
class Splitter(private val frameMs: Double, remembered: Heard?) {
  data class Heard(val room: Double, val voice: Double, val pause: Double)
  data class Levels(val room: Double, val quiet: Double, val start: Double, val voice: Double, val pause: Double)
  sealed class Action {
    /** A part starts `headFrames` frames back, counting the frame just given. */
    data class Start(val headFrames: Int) : Action()
    /** A part ends; `trimMs` after its last sound goes. `discard`: only a tap or a bump. */
    data class Stop(val discard: Boolean, val trimMs: Int) : Action()
  }

  companion object {
    const val ROOM_WINDOW_MS = 8000.0
    const val ROOM_PERCENTILE = 0.2
    const val ROOM_UNDER_PART_DB = 10.0
    const val TRUST_NOW_MS = 600.0
    const val END_MEDIAN_FRAMES = 5
    const val SPEECH_ON = 0.5
    const val SPEECH_OFF = 0.35
    const val ROOM_GUESS = -50.0
    const val VOICE_GUESS_OVER_ROOM = 24.0
    const val START_SHARE = 0.5
    const val START_MIN = 10.0
    const val QUIET_SHARE = 0.25
    const val QUIET_MIN = 6.0
    const val SOFT_START_MS = 300.0
    const val HEAD_GAP_MS = 300.0
    const val HEAD_MARGIN_MS = 140.0
    const val MAX_HEAD_MS = 3000.0
    const val TAIL_MS = 300.0
    const val MIN_SOUND_MS = 120.0
    const val PAUSE_MS = 1000.0
    const val MAX_PAUSE_MS = 2500.0
    const val MIN_GAP_MS = 150.0
    const val LEARN_AFTER_GAPS = 8
    /** Exact silence this long is the room (a quiet line, a noise gate); shorter, it is a microphone starting. */
    const val ZERO_ROOM_MS = 500.0
    /** While a part is open the room rises at most this fast (dB a second), so speech never becomes the room. */
    const val ROOM_RISE_PER_SEC = 1.5

    /** A frame's peak (0..1) in dB, -60..0. */
    fun levelDb(energy: Double): Double = max(-60.0, min(0.0, 20 * log10(max(energy, 1e-6))))

    /** The p-th quantile (0..1) of values, as splitter.ts takes it. */
    private fun quantile(values: List<Double>, p: Double): Double {
      val sorted = values.sorted()
      return sorted[min(sorted.size - 1, (sorted.size * p).toInt())]
    }
  }

  /** A frame heard: when (ms), its level (dB), and the speech model's score (null: no model). */
  private data class Frame(val t: Double, val db: Double, val s: Double?)
  private data class Calm(val t: Double, val db: Double)
  private val history = ArrayDeque<Frame>()
  private val calm = ArrayDeque<Calm>()
  private var roomDb = remembered?.room ?: ROOM_GUESS
  private var voiceDb: Double? = remembered?.voice
  private var pause = remembered?.pause ?: PAUSE_MS
  private val gaps = ArrayDeque<Double>()
  var open = false; private set
  private var lastSound = 0.0
  private var soundMs = 0.0
  private val partDbs = ArrayList<Double>()
  private var quietSince: Double? = null
  private var lastEnd = Double.NEGATIVE_INFINITY
  /** How long the 3-frame median has been exact silence (-60 dB). */
  private var zeroMs = 0.0
  /** How long this has listened since it last started (for trusting the room heard now). */
  private var listenedMs = 0.0

  fun levels(): Levels {
    val room = roomDb
    val voice = max(voiceDb ?: (room + VOICE_GUESS_OVER_ROOM), room + START_MIN)
    val span = voice - room
    return Levels(room, room + max(QUIET_MIN, QUIET_SHARE * span), room + max(START_MIN, START_SHARE * span), voice, pause)
  }

  fun remember(): Heard {
    val l = levels()
    return Heard((l.room * 10).roundToInt() / 10.0, (l.voice * 10).roundToInt() / 10.0, l.pause.roundToInt().toDouble())
  }

  /** The detector stopped (the source plays, or the session ended): nothing heard meanwhile heads a part. */
  fun pauseListening() { open = false; history.clear(); quietSince = null; zeroMs = 0.0; listenedMs = 0.0 }

  /** One frame's energy (0..1 peak) at `now` (ms, the frame's end), and the speech model's score for it, or null. */
  fun step(energy: Double, now: Double, speech: Double? = null): Action? {
    val db = levelDb(energy)
    history.addLast(Frame(now, db, speech))
    val keepFrom = now - MAX_HEAD_MS - HEAD_MARGIN_MS - frameMs
    while (history.isNotEmpty() && history.first().t < keepFrom) history.removeFirst()
    trackRoom(now)
    listenedMs += frameMs
    val l = levels()
    if (!open) return if ((db > l.start || softRun(l.quiet) >= SOFT_START_MS) && speaking()) begin(now, l.quiet) else null
    // With a model: back in the room on the median of the last few frames, or no longer speech.
    var out = db > l.quiet
    if (speech != null) {
      val recent = history.takeLast(END_MEDIAN_FRAMES).map { it.db }.sorted()
      out = recent[(recent.size - 1) / 2] > l.quiet && speech >= SPEECH_OFF
    }
    if (out) {
      quietSince?.let { since -> val gap = now - frameMs - since; if (gap >= MIN_GAP_MS) learnGap(gap) }
      quietSince = null
      lastSound = now; soundMs += frameMs; partDbs.add(db)
      return null
    }
    if (quietSince == null) quietSince = now - frameMs
    if (now - lastSound < pause) return null
    return end(now)
  }

  /** The session ends with a part open: what to keep of it. */
  fun finish(now: Double): Action? = if (open) end(now) else null

  /** Where a model scores frames, two of the last three are speech; with none, any sound may start a part. */
  private fun speaking(): Boolean {
    val last = history.takeLast(3)
    if (last.last().s == null) return true
    return last.count { (it.s ?: 0.0) >= SPEECH_ON } >= 2
  }

  /** Out of the room, and speech where a model says. */
  private fun heard(f: Frame, quiet: Double): Boolean = f.db > quiet && (f.s == null || f.s >= SPEECH_OFF)

  private fun begin(now: Double, quiet: Double): Action {
    val h = history.toList()
    var firstOut = h.size - 1
    var dip = 0.0
    for (i in h.size - 2 downTo 0) {
      val f = h[i]
      if (f.t <= lastEnd || now - f.t > MAX_HEAD_MS) break
      if (heard(f, quiet)) { firstOut = i; dip = 0.0 }
      else { dip += frameMs; if (dip > HEAD_GAP_MS) break }
    }
    var head = firstOut
    val margin = (HEAD_MARGIN_MS / frameMs).roundToInt()
    var m = 0
    while (m < margin && head > 0 && h[head - 1].t > lastEnd) { head--; m++ }
    open = true; lastSound = now; quietSince = null; partDbs.clear(); soundMs = 0.0
    for (i in head until h.size) if (heard(h[i], quiet)) { soundMs += frameMs; partDbs.add(h[i].db) }
    return Action.Start(h.size - head)
  }

  private fun end(now: Double): Action {
    open = false
    val keepUntil = min(now, lastSound + TAIL_MS)
    lastEnd = keepUntil; quietSince = null
    val discard = soundMs < MIN_SOUND_MS
    if (!discard) learnVoice()
    return Action.Stop(discard, max(0, (now - keepUntil).roundToInt()))
  }

  private fun softRun(quiet: Double): Double {
    var run = 0.0; var dip = 0.0
    for (f in history.reversed()) {
      if (f.t <= lastEnd) break
      if (heard(f, quiet)) { run += frameMs; dip = 0.0 } else { dip += frameMs; if (dip > HEAD_GAP_MS / 2) break }
    }
    return run
  }

  /** The room, from the 3-frame medians of the last few seconds: the quietest, or with a speech model the level only a fifth fall under. */
  private fun trackRoom(now: Double) {
    if (history.size >= 3) {
      val median = history.takeLast(3).map { it.db }.sorted()[1]
      zeroMs = if (median <= -59.5) zeroMs + frameMs else 0.0
      if (median > -59.5 || zeroMs >= ZERO_ROOM_MS) calm.addLast(Calm(now, median))
    }
    while (calm.isNotEmpty() && now - calm.first().t > ROOM_WINDOW_MS) calm.removeFirst()
    if (calm.isEmpty()) return
    val last = history.lastOrNull()
    val s = last?.s
    if (s == null) {
      // No model: the quietest stretch heard. Between parts the room follows it; inside one it only creeps up.
      val lowest = calm.minOf { it.db }
      val rise = if (open) ROOM_RISE_PER_SEC * frameMs / 1000 else 3.0
      roomDb = min(lowest, roomDb + rise)
      return
    }
    // With a model: how loud it usually is here.
    val usual = quantile(calm.map { it.db }, ROOM_PERCENTILE)
    // A room remembered from a quieter place gives way at once to the one heard now, when that is not speech.
    if (s < SPEECH_OFF && listenedMs < TRUST_NOW_MS && usual > roomDb) { roomDb = usual; return }
    val rise = if (open) ROOM_RISE_PER_SEC * frameMs / 1000 else 3.0
    roomDb = min(usual, roomDb + rise)
    // A reader who never pauses for long does not become the room.
    if (open && partDbs.size >= 10) roomDb = min(roomDb, quantile(partDbs, 0.75) - ROOM_UNDER_PART_DB)
  }

  private fun learnVoice() {
    if (partDbs.size * frameMs < 400) return
    val loud = quantile(partDbs, 0.75)
    voiceDb = voiceDb?.let { 0.7 * it + 0.3 * loud } ?: loud
  }

  private fun learnGap(gap: Double) {
    gaps.addLast(gap)
    if (gaps.size > 30) gaps.removeFirst()
    if (gaps.size < LEARN_AFTER_GAPS) return
    val usual = quantile(gaps.toList(), 0.9)
    pause = max(PAUSE_MS, min(MAX_PAUSE_MS, (usual * 1.5).roundToInt().toDouble()))
  }
}
