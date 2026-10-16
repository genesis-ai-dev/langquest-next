package expo.modules.microphoneenergy

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Where one part ends and the next begins (LAN-82): a line-for-line port of
 * src/splitter.ts, which the web module and the tests run. Keep the two in
 * step. Nothing said is dropped; the rules only choose where parts split,
 * from two levels learned while listening: the room (the quietest stretch of
 * the last 8 s) and the voice (how loud this person usually is here).
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

    /** A frame's peak (0..1) in dB, -60..0. */
    fun levelDb(energy: Double): Double = max(-60.0, min(0.0, 20 * log10(max(energy, 1e-6))))
  }

  private data class Frame(val t: Double, val db: Double)
  private val history = ArrayDeque<Frame>()
  private val calm = ArrayDeque<Frame>()
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
  fun pauseListening() { open = false; history.clear(); quietSince = null }

  /** One frame's energy (0..1 peak) at `now` (ms, the frame's end). */
  fun step(energy: Double, now: Double): Action? {
    val db = levelDb(energy)
    history.addLast(Frame(now, db))
    val keepFrom = now - MAX_HEAD_MS - HEAD_MARGIN_MS - frameMs
    while (history.isNotEmpty() && history.first().t < keepFrom) history.removeFirst()
    trackRoom(now)
    val l = levels()
    if (!open) return if (db > l.start || softRun(l.quiet) >= SOFT_START_MS) begin(now, l.quiet) else null
    if (db > l.quiet) {
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

  private fun begin(now: Double, quiet: Double): Action {
    val h = history.toList()
    var firstOut = h.size - 1
    var dip = 0.0
    for (i in h.size - 2 downTo 0) {
      val f = h[i]
      if (f.t <= lastEnd || now - f.t > MAX_HEAD_MS) break
      if (f.db > quiet) { firstOut = i; dip = 0.0 }
      else { dip += frameMs; if (dip > HEAD_GAP_MS) break }
    }
    var head = firstOut
    val margin = (HEAD_MARGIN_MS / frameMs).roundToInt()
    var m = 0
    while (m < margin && head > 0 && h[head - 1].t > lastEnd) { head--; m++ }
    open = true; lastSound = now; quietSince = null; partDbs.clear(); soundMs = 0.0
    for (i in head until h.size) if (h[i].db > quiet) { soundMs += frameMs; partDbs.add(h[i].db) }
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
      if (f.db > quiet) { run += frameMs; dip = 0.0 } else { dip += frameMs; if (dip > HEAD_GAP_MS / 2) break }
    }
    return run
  }

  /** The room: the quietest 3-frame median of the last few seconds. No signal at all (a microphone starting) is not the room. */
  private fun trackRoom(now: Double) {
    if (history.size >= 3) {
      val last = history.takeLast(3).map { it.db }.sorted()
      if (last[0] > -59.5) calm.addLast(Frame(now, last[1]))
    }
    while (calm.isNotEmpty() && now - calm.first().t > ROOM_WINDOW_MS) calm.removeFirst()
    if (calm.isEmpty()) return
    val lowest = calm.minOf { it.db }
    roomDb = if (now - calm.first().t < ROOM_WINDOW_MS / 2) min(lowest, roomDb + 3) else lowest
  }

  private fun learnVoice() {
    if (partDbs.size * frameMs < 400) return
    val sorted = partDbs.sorted()
    val loud = sorted[min(sorted.size - 1, (sorted.size * 0.75).toInt())]
    voiceDb = voiceDb?.let { 0.7 * it + 0.3 * loud } ?: loud
  }

  private fun learnGap(gap: Double) {
    gaps.addLast(gap)
    if (gaps.size > 30) gaps.removeFirst()
    if (gaps.size < LEARN_AFTER_GAPS) return
    val sorted = gaps.sorted()
    val usual = sorted[min(sorted.size - 1, (sorted.size * 0.9).toInt())]
    pause = max(PAUSE_MS, min(MAX_PAUSE_MS, (usual * 1.5).roundToInt().toDouble()))
  }

}
