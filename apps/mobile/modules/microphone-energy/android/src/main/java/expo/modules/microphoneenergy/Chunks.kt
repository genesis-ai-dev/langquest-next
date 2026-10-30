package expo.modules.microphoneenergy

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * What of a recording session is kept on storage, and where each part is in
 * it (LAN-82): a line-for-line port of src/chunks.ts, which the web module
 * and the tests run. Keep the two in step. A chunk file opens when a part
 * starts, with up to PAD_MS of the room before the part's head, and closes
 * PAD_MS after the last part in it ended, so a part's edges can be moved out
 * into the room around it until the session is left, while a long silence
 * is never written. While the silence switch is on (`keepRoom`, decision
 * 192) a chunk stays open through every pause until the detector stops. The
 * module does the writing, in this order for each frame: the ring, the open
 * chunk's file, the splitter, then these actions.
 */
class Chunks(private val frameMs: Double, private val sampleRate: Int) {
  sealed class Action {
    /** Open a chunk file with the ring's last `frames` frames, the frame just heard included. */
    data class Open(val frames: Int) : Action()
    /** A part is kept: samples [from, to) of the open chunk. */
    data class Mark(val from: Int, val to: Int) : Action()
    /** The chunk ends: finish its file, or delete it when no part in it was kept. */
    data class Close(val keep: Boolean) : Action()
  }

  companion object {
    /** The room kept on each side of what was said (ms). */
    const val PAD_MS = 2000.0

    /** Frames the module's ring holds: a part's longest head and the room before it. */
    fun ringFrames(frameMs: Double): Int = ceil((Splitter.MAX_HEAD_MS + Splitter.HEAD_MARGIN_MS + PAD_MS) / frameMs).toInt() + 2
  }

  /** How many samples each frame in the module's ring holds, oldest first. */
  private val ring = ArrayDeque<Int>()
  val ringSize = ringFrames(frameMs)
  private val padFrames = (PAD_MS / frameMs).roundToInt()
  private var open = false
  /** Samples in the open chunk so far, the frame just heard included. */
  private var written = 0
  /** Where the part being said starts in the open chunk; null between parts. */
  private var partFrom: Int? = null
  private var kept = 0
  /** When the last part ended (ms, the splitter's clock): the chunk keeps PAD_MS after it. */
  private var endedAt = Double.NEGATIVE_INFINITY
  /** The silence switch (decision 193): an open chunk does not close after a part; the module sets it whenever it changes. */
  var keepRoom = false

  /** One frame of `samples` samples, heard at `now` (ms), and what the splitter said of it. */
  fun step(samples: Int, action: Splitter.Action?, now: Double): List<Action> {
    val out = ArrayList<Action>()
    ring.addLast(samples)
    if (ring.size > ringSize) ring.removeFirst()
    if (open) written += samples
    if (action is Splitter.Action.Start) {
      if (!open) {
        val frames = min(ring.size, action.headFrames + padFrames)
        open = true
        kept = 0
        written = last(frames)
        out.add(Action.Open(frames))
      }
      partFrom = max(0, written - last(action.headFrames))
    } else if (action is Splitter.Action.Stop && partFrom != null) {
      val from = partFrom!!
      if (!action.discard) {
        val trim = (action.trimMs * sampleRate / 1000.0).roundToInt()
        out.add(Action.Mark(from, max(from + 1, written - trim)))
        kept++
      }
      partFrom = null
      endedAt = now - action.trimMs
    }
    if (open && partFrom == null && !keepRoom && now - endedAt >= PAD_MS) out.add(close())
    return out
  }

  /**
   * The detector stops (recording stopped, or the source is about to play):
   * a part still being said is kept to the end of what was heard, and the
   * chunk closes. The module's ring starts empty when it listens again.
   */
  fun stop(): List<Action> {
    val out = ArrayList<Action>()
    if (open) {
      partFrom?.let { from ->
        out.add(Action.Mark(from, max(from + 1, written)))
        kept++
        partFrom = null
      }
      out.add(close())
    }
    ring.clear()
    partFrom = null
    endedAt = Double.NEGATIVE_INFINITY
    return out
  }

  private fun close(): Action {
    val keep = kept > 0
    open = false
    written = 0
    kept = 0
    return Action.Close(keep)
  }

  /** Samples in the ring's last `frames` frames. */
  private fun last(frames: Int): Int {
    var n = 0
    for (i in max(0, ring.size - frames) until ring.size) n += ring[i]
    return n
  }
}
