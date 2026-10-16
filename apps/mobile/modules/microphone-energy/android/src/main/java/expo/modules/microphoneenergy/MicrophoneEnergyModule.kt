package expo.modules.microphoneenergy

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.*
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow

/** Samples per frame: the iOS tap's size, and what vadCore.ts assumes. */
private const val FRAME_SAMPLES = 2048
private const val FRAME_MS = FRAME_SAMPLES * 1000.0 / 44100

class MicrophoneEnergyModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var isActive = false
  private var recordingScope: CoroutineScope? = null
  private var writeScope: CoroutineScope? = null
  private val encodeScope = CoroutineScope(Dispatchers.Default)
  // Meter events go to the main thread without the capture loop waiting for it.
  private val main = Handler(Looper.getMainLooper())
  private val configLock = Any()
  @Volatile private var pendingWrites = 0
  private val writeWaiters = mutableListOf<() -> Unit>()
  
  private data class RingBufferEntry(val buffer: ShortArray, val timestamp: Long)
  private val ringBuffer = ArrayDeque<RingBufferEntry>()
  /** Long enough for a part's head to reach back as far as the splitter lets it, and the room before it (Chunks.kt). */
  private val ringBufferMaxSize = Chunks.ringFrames(FRAME_MS)
  
  /** A hold-to-record take, streaming to disk as it is heard. */
  private var isRecordingSegment = false
  private var segmentStartTime: Long = 0
  private val sampleRate = 44100
  private var segmentWriter: SegmentWriter? = null
  /** A session's parts and the room around them (Chunks.kt, LAN-82): the open chunk's file streams to disk as it is heard. */
  private var chunks: Chunks? = null
  /** Is this sound speech? (Speech.kt, decision 135): loaded once, before the microphone opens; null where it cannot load. */
  @Volatile private var speechModel: SpeechModel? = null
  private var speechTried = false
  private val speechLock = Any()
  private var resampler: Resampler? = null
  private val speechChunks = SpeechChunks()
  private var lastScore = 0.0
  private var chunkWriter: SegmentWriter? = null
  
  private var vadEnabled = false
  /** Where parts split (Splitter.kt, LAN-82): it learns the room and the voice, and needs no setting. */
  private var splitter: Splitter? = null
  /** What this device heard last time, until a session's splitter hears for itself. */
  private var remembered: Splitter.Heard? = null
  /** The splitter's clock: frames heard, as time. */
  private var clockMs = 0.0

  override fun definition() = ModuleDefinition {
    Name("MicrophoneEnergy")
    Events("onEnergyResult", "onError", "onSegmentComplete", "onSegmentStart", "onChunkComplete")
    
    AsyncFunction("prepareSpeech") { promise: Promise -> CoroutineScope(Dispatchers.IO).launch { speech() }; promise.resolve(null) }
    AsyncFunction("startEnergyDetection") { promise: Promise -> startEnergyDetection(promise) }
    AsyncFunction("stopEnergyDetection") { promise: Promise -> stopEnergyDetection(promise) }
    AsyncFunction("configureVAD") { config: Map<String, Any?>, promise: Promise ->
      configureVAD(config)
      promise.resolve(null)
    }
    AsyncFunction("enableVAD") { promise: Promise -> enableVAD(); promise.resolve(null) }
    AsyncFunction("disableVAD") { promise: Promise -> disableVAD { promise.resolve(null) } }
    AsyncFunction("startSegment") { options: Map<String, Any?>?, promise: Promise -> startSegment(options, promise) }
    AsyncFunction("stopSegment") { promise: Promise -> stopSegment(promise) }
    AsyncFunction("encodeAac") { uri: String, promise: Promise ->
      encodeScope.launch {
        try {
          val wav = java.io.File(java.net.URI(uri))
          val m4a = java.io.File(wav.parentFile, wav.nameWithoutExtension + ".m4a")
          AacEncoder.encode(wav, m4a)
          promise.resolve("file://${m4a.absolutePath}")
        } catch (e: Exception) {
          promise.reject("ENCODE_ERROR", "Could not convert the recording: ${e.message}", e)
        }
      }
    }
  }

  private fun startEnergyDetection(promise: Promise) {
    if (isActive) stopEnergyDetectionInternal()
    synchronized(ringBuffer) { ringBuffer.clear() }
    segmentWriter?.discard(); segmentWriter = null; isRecordingSegment = false
    chunkWriter?.discard(); chunkWriter = null
    // The speech model loads before the microphone opens (prepareSpeech usually has it ready), so the
    // microphone's buffer never fills while it loads, and every frame of a session is judged the same way.
    speech()
    try {
      val channelConfig = AudioFormat.CHANNEL_IN_MONO
      val audioFormat = AudioFormat.ENCODING_PCM_16BIT
      // Read whole 2048-sample frames, as the iOS tap and vadCore.ts do, from a
      // buffer that holds about 0.37 s: a busy phone that is late to read
      // loses nothing (the smallest buffer Android allows holds about one frame).
      val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
      val bufferSize = max(minBuffer, FRAME_SAMPLES * 2 * 8)
      audioRecord = AudioRecord(MediaRecorder.AudioSource.DEFAULT, sampleRate, channelConfig, audioFormat, bufferSize)
      if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) throw Exception("AudioRecord initialization failed")
      audioRecord?.startRecording()
      isActive = true
      promise.resolve(null)
      recordingScope = CoroutineScope(Dispatchers.IO)
      recordingScope?.launch {
        val audioData = ShortArray(FRAME_SAMPLES)
        while (isActive && audioRecord != null) {
          val samplesRead = audioRecord!!.read(audioData, 0, audioData.size)
          if (samplesRead > 0) processAudioData(audioData, samplesRead)
        }
      }
    } catch (e: SecurityException) {
      sendEvent("onError", mapOf("message" to "Microphone permission not granted"))
      promise.reject("PERMISSION_DENIED", "Microphone permission not granted", e)
    } catch (e: Exception) {
      sendEvent("onError", mapOf("message" to "Failed to start: ${e.message}"))
      promise.reject("ENERGY_DETECTION_ERROR", "Failed to start", e)
    }
  }

  private fun stopEnergyDetection(promise: Promise) {
    if (!isActive) { awaitWrites { promise.resolve(null) }; return }
    try {
      stopEnergyDetectionInternal()
      awaitWrites { finishStoppedSegment { promise.resolve(null) } }
    }
    catch (e: Exception) { promise.reject("STOP_ERROR", "Failed to stop", e) }
  }

  private fun awaitWrites(done: () -> Unit) {
    synchronized(writeWaiters) {
      if (pendingWrites == 0) done() else writeWaiters.add(done)
    }
  }

  private fun writeFinished() {
    val callbacks: List<() -> Unit>
    synchronized(writeWaiters) {
      pendingWrites = (pendingWrites - 1).coerceAtLeast(0)
      if (pendingWrites != 0) return
      callbacks = writeWaiters.toList(); writeWaiters.clear()
    }
    callbacks.forEach { it() }
  }

  private fun stopEnergyDetectionInternal() {
    synchronized(configLock) {
      isActive = false
      vadEnabled = false
      splitter?.let { remembered = it.remember(); it.pauseListening() }
      chunks?.let { keep(it.stop()) }
    }
    recordingScope?.cancel()
    recordingScope = null
    audioRecord?.stop()
    audioRecord?.release()
    audioRecord = null
  }
  
  /** Only what the device heard last time is read; the old detector's settings are ignored (LAN-82). */
  private fun configureVAD(config: Map<String, Any?>) = synchronized(configLock) {
    @Suppress("UNCHECKED_CAST")
    val heard = config["heard"] as? Map<String, Any?> ?: return@synchronized
    val room = (heard["room"] as? Number)?.toDouble()
    val voice = (heard["voice"] as? Number)?.toDouble()
    val pause = (heard["pause"] as? Number)?.toDouble()
    if (room != null && voice != null && pause != null) remembered = Splitter.Heard(room, voice, pause)
  }

  private fun enableVAD() {
    synchronized(configLock) {
      vadEnabled = true
      val sp = splitter ?: Splitter(FRAME_MS, remembered).also { splitter = it }
      if (chunks == null) chunks = Chunks(FRAME_MS, sampleRate)
      sp.pauseListening()
      // What the model heard before (a source playing) is not this stretch's.
      resampler = null; speechChunks.reset(); speechModel?.reset(); lastScore = 0.0
      // What the microphone heard while the detector was off (a source playing) never heads a part.
      synchronized(ringBuffer) { ringBuffer.clear() }
    }
  }

  private fun disableVAD(done: () -> Unit) {
    synchronized(configLock) {
      vadEnabled = false
      splitter?.let { remembered = it.remember(); it.pauseListening() }
      // A part being said is kept to here, and its chunk is finished before this resolves.
      chunks?.let { keep(it.stop()) }
    }
    awaitWrites { finishStoppedSegment(done) }
  }

  private fun finishStoppedSegment(done: () -> Unit) {
    if (!isRecordingSegment) { done(); return }
    val p = object : Promise {
      override fun resolve(value: Any?) { done() }
      override fun reject(code: String?, message: String?, cause: Throwable?) {
        sendEvent("onError", mapOf("message" to (message ?: "Failed to save recording")))
        done()
      }
    }
    stopSegment(p)
  }

  private fun processAudioData(audioData: ShortArray, bytesRead: Int) {
    val now = System.currentTimeMillis()
    val dataCopy = audioData.copyOf(bytesRead)
    var peakAmplitude = 0.0
    for (i in 0 until bytesRead) { peakAmplitude = max(peakAmplitude, abs(audioData[i] / 32768.0)) }
    val db = 20.0 * log10(max(peakAmplitude, 1e-10))
    val clampedDb = max(-60.0, kotlin.math.min(0.0, db))
    val normalizedAmplitude = 10.0.pow(clampedDb / 20.0).toFloat()
    var quiet: Double? = null

    synchronized(configLock) {
      if (!isActive) return
      synchronized(ringBuffer) {
        ringBuffer.addLast(RingBufferEntry(dataCopy, now))
        if (ringBuffer.size > ringBufferMaxSize) ringBuffer.removeFirst()
      }
      if (isRecordingSegment) segmentWriter?.append(dataCopy, 0)
      chunkWriter?.append(dataCopy, 0)
      clockMs += bytesRead * 1000.0 / sampleRate
      val sp = splitter
      val ch = chunks
      if (vadEnabled && sp != null && ch != null) {
        val action = sp.step(normalizedAmplitude.toDouble(), clockMs, scoreSpeech(dataCopy, bytesRead))
        handleSplit(sp, action)
        keep(ch.step(bytesRead, action, clockMs))
        quiet = sp.levels().quiet
      }
    }
    val q = quiet
    main.post {
      sendEvent("onEnergyResult", if (q != null) mapOf("energy" to normalizedAmplitude.toDouble(), "timestamp" to now.toDouble(), "quiet" to q)
        else mapOf("energy" to normalizedAmplitude.toDouble(), "timestamp" to now.toDouble()))
    }
  }

  /** The speech model, loaded once by whichever thread asks first (prepareSpeech, or the microphone opening); null where it cannot load. */
  private fun speech(): SpeechModel? = synchronized(speechLock) {
    if (!speechTried) { speechTried = true; speechModel = appContext.reactContext?.let { SpeechModel.load(it) } }
    speechModel
  }

  /** Called with configLock held: the speech model's score for one frame (Speech.kt), or null without a model. */
  private fun scoreSpeech(samples: ShortArray, count: Int): Double? {
    val model = speechModel ?: return null
    val r = resampler ?: Resampler(sampleRate.toDouble()).also { resampler = it }
    val floats = FloatArray(count) { samples[it] / 32768f }
    val scores = ArrayList<Double>(2)
    try {
      r.push(floats, count) { x -> speechChunks.push(x)?.let { scores.add(model.score(it)) } }
    } catch (e: Exception) {
      // The model failed mid-session: from here parts split by levels alone.
      android.util.Log.w("MicrophoneEnergy", "speech model failed; parts split by levels alone", e)
      speechModel = null
      return null
    }
    lastScore = frameScore(scores, lastScore)
    return lastScore
  }

  /**
   * Called with configLock held: a part starts or ends, as the splitter says.
   * Its events go by the main thread, as the meter's do, so JS hears them in
   * the order of the frames.
   */
  private fun handleSplit(sp: Splitter, action: Splitter.Action?) {
    when (action) {
      is Splitter.Action.Start -> { val headMs = action.headFrames * FRAME_MS; main.post { sendEvent("onSegmentStart", mapOf("headMs" to headMs)) } }
      is Splitter.Action.Stop -> {
        remembered = sp.remember()
        // A tap or a bump, not speech: nothing said is lost, so nothing is kept.
        if (action.discard) { val heard = heardMap(); main.post { sendEvent("onSegmentComplete", mapOf("uri" to "", "duration" to 0.0, "heard" to heard)) } }
      }
      null -> {}
    }
  }

  /** Called with configLock held: do what Chunks.kt says (open a chunk with the ring's last frames, mark a part in it, close it). */
  private fun keep(actions: List<Chunks.Action>) {
    for (a in actions) when (a) {
      is Chunks.Action.Open -> {
        try {
          val context = appContext.reactContext ?: throw Exception("Context not available")
          // filesDir survives restarts, unlike cacheDir, so JS can cut the parts from it after a crash (its journal).
          val dir = java.io.File(context.filesDir, "recording-staging").also { it.mkdirs() }
          val writer = SegmentWriter(java.io.File(dir, "chunk_${java.util.UUID.randomUUID()}.wav"), sampleRate)
          synchronized(ringBuffer) { for (entry in ringBuffer.takeLast(a.frames)) writer.append(entry.buffer, 0) }
          chunkWriter = writer
        } catch (e: Exception) {
          sendEvent("onError", mapOf("message" to "Could not start recording a part: ${e.message}"))
        }
      }
      is Chunks.Action.Mark -> {
        val writer = chunkWriter ?: continue
        val fromMs = a.from * 1000.0 / sampleRate
        val toMs = a.to * 1000.0 / sampleRate
        val event = mapOf("uri" to writer.uri, "chunk" to writer.uri, "fromMs" to fromMs, "toMs" to toMs,
          "duration" to toMs - fromMs, "startTime" to 0.0, "endTime" to 0.0, "heard" to heardMap())
        main.post { sendEvent("onSegmentComplete", event) }
      }
      is Chunks.Action.Close -> {
        val writer = chunkWriter ?: continue
        chunkWriter = null
        if (a.keep) finishChunk(writer) else writer.discard()
      }
    }
  }

  /** Completes a chunk's file off the audio thread, then says so; stopping waits for it. Every failure reaches JS as onError. */
  private fun finishChunk(writer: SegmentWriter) {
    synchronized(writeWaiters) { pendingWrites += 1 }
    (writeScope ?: CoroutineScope(Dispatchers.IO).also { writeScope = it }).launch {
      try {
        writer.finish(0)
        withContext(Dispatchers.Main) {
          sendEvent("onChunkComplete", mapOf("chunk" to writer.uri, "uri" to writer.uri, "duration" to writer.durationMs))
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          sendEvent("onError", mapOf("message" to "Could not save recording (${writer.file.name}): ${e.message}"))
        }
      } finally { writeFinished() }
    }
  }

  private fun heardMap(): Map<String, Double> = remembered?.let { mapOf("room" to it.room, "voice" to it.voice, "pause" to it.pause) } ?: emptyMap()

  /** Completes the file off the audio thread. Every failure reaches JS as onError. */
  private fun finishSegment(writer: SegmentWriter?, startTime: Long, endTime: Long, trimSamples: Int) {
    if (writer == null) return
    synchronized(writeWaiters) { pendingWrites += 1 }
    (writeScope ?: CoroutineScope(Dispatchers.IO).also { writeScope = it }).launch {
      try {
        writer.finish(trimSamples)
        withContext(Dispatchers.Main) {
          sendEvent("onSegmentComplete", mapOf("uri" to writer.uri, "startTime" to startTime.toDouble(), "endTime" to endTime.toDouble(), "duration" to writer.durationMs, "heard" to heardMap()))
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          sendEvent("onError", mapOf("message" to "Could not save recording (${writer.file.name}): ${e.message}"))
        }
      } finally { writeFinished() }
    }
  }

  /** A hold-to-record take: starts with up to `prerollMs` of what the microphone already heard. */
  private fun startSegment(options: Map<String, Any?>?, promise: Promise) {
    val prerollMs = (options?.get("prerollMs") as? Number)?.toDouble() ?: 200.0
    synchronized(configLock) { startSegmentFrames((prerollMs / FRAME_MS).toInt(), promise) }
  }

  /** Called with configLock held: open a take's file with the last `headFrames` frames of the ring. */
  private fun startSegmentFrames(headFrames: Int, promise: Promise) {
    if (!isActive) { promise.reject("NOT_ACTIVE", "Energy detection not active", null); return }
    if (isRecordingSegment) { promise.resolve(null); return }
    try {
      val context = appContext.reactContext ?: throw Exception("Context not available")
      // filesDir survives restarts, unlike cacheDir, so JS can resume an
      // interrupted save from its journal.
      val dir = java.io.File(context.filesDir, "recording-staging").also { it.mkdirs() }
      val writer = SegmentWriter(java.io.File(dir, "segment_${java.util.UUID.randomUUID()}.wav"), sampleRate)
      segmentStartTime = System.currentTimeMillis()
      synchronized(ringBuffer) {
        val buffersToWrite = kotlin.math.min(ringBuffer.size, headFrames)
        for (entry in ringBuffer.takeLast(buffersToWrite)) writer.append(entry.buffer, 0)
      }
      segmentWriter = writer
      isRecordingSegment = true; promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("START_SEGMENT_ERROR", "Failed to start segment", e)
      isRecordingSegment = false; segmentWriter = null
    }
  }

  /** Manual stop: no rewind. The file completes off-thread and is announced by onSegmentComplete. */
  private fun stopSegment(promise: Promise) {
    synchronized(configLock) {
      if (!isRecordingSegment) { promise.resolve(null); return }
      isRecordingSegment = false
      splitter?.pauseListening()
      val writer = segmentWriter
      segmentWriter = null
      finishSegment(writer, segmentStartTime, System.currentTimeMillis(), 0)
      promise.resolve(writer?.uri)
    }
  }
}

/**
 * Streams one segment's PCM to a WAV file as buffers arrive. Only the last
 * `keepSamples` stay in memory so a trailing trim is still possible; a long
 * utterance costs disk, not RAM. The first write error is kept and rethrown
 * by finish(), so a full disk is never a silent loss.
 */
class SegmentWriter(val file: java.io.File, private val sampleRate: Int) {
  private val out = java.io.RandomAccessFile(file, "rw")
  private val tail = ArrayDeque<ShortArray>()
  private var tailSamples = 0
  private var samplesWritten = 0
  private var failure: Exception? = null
  private var closed = false
  val uri: String get() = "file://${file.absolutePath}"
  /** The finished file's length: head, voice and tail. */
  val durationMs: Double get() = samplesWritten * 1000.0 / sampleRate

  init {
    out.setLength(0)
    out.write(wavHeader(0, sampleRate, 1, 16))
  }

  @Synchronized fun append(buffer: ShortArray, keepSamples: Int) {
    if (closed) return
    tail.addLast(buffer); tailSamples += buffer.size
    while (tail.isNotEmpty() && tailSamples - tail.first().size >= keepSamples) {
      val first = tail.removeFirst(); tailSamples -= first.size
      write(first, first.size)
    }
  }

  private fun write(buffer: ShortArray, samples: Int) {
    if (failure != null || samples <= 0) return
    try {
      val bytes = java.nio.ByteBuffer.allocate(samples * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      for (i in 0 until samples) bytes.putShort(buffer[i])
      out.write(bytes.array()); samplesWritten += samples
    } catch (e: Exception) { failure = e }
  }

  /** Flush the tail minus `trimSamples`, patch the header, close. */
  @Synchronized fun finish(trimSamples: Int) {
    if (closed) return
    closed = true
    try {
      var remaining = max(0, tailSamples - trimSamples)
      for (buffer in tail) {
        val n = kotlin.math.min(buffer.size, remaining)
        if (n <= 0) break
        write(buffer, n); remaining -= n
      }
      tail.clear()
      failure?.let { file.delete(); throw it }
      out.seek(0)
      out.write(wavHeader(samplesWritten * 2L, sampleRate, 1, 16))
      out.fd.sync()
    } finally { try { out.close() } catch (_: Exception) {} }
  }

  @Synchronized fun discard() {
    closed = true; tail.clear()
    try { out.close() } catch (_: Exception) {}
    file.delete()
  }

  private fun wavHeader(dataSize: Long, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
    val header = java.nio.ByteBuffer.allocate(44)
    header.order(java.nio.ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray()); header.putInt((36 + dataSize).toInt()); header.put("WAVE".toByteArray())
    header.put("fmt ".toByteArray()); header.putInt(16); header.putShort(1); header.putShort(channels.toShort())
    header.putInt(sampleRate); header.putInt(sampleRate * channels * bitsPerSample / 8)
    header.putShort((channels * bitsPerSample / 8).toShort()); header.putShort(bitsPerSample.toShort())
    header.put("data".toByteArray()); header.putInt(dataSize.toInt())
    return header.array()
  }
}

/**
 * A finished WAV part as AAC in MP4 (`.m4a`, decisions.md 106): mono 128 kb/s,
 * the bitrate hold-to-record always used, about a fifth of the WAV's size.
 * Reads the 16-bit PCM WAVs SegmentWriter writes; any other input throws, and
 * the caller keeps the WAV.
 */
object AacEncoder {
  private const val BIT_RATE = 128_000
  private const val TIMEOUT_US = 10_000L

  fun encode(wav: java.io.File, out: java.io.File) {
    java.io.RandomAccessFile(wav, "r").use { input ->
      val header = ByteArray(44)
      input.readFully(header)
      val h = java.nio.ByteBuffer.wrap(header).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      if (String(header, 0, 4) != "RIFF" || String(header, 8, 4) != "WAVE" || String(header, 36, 4) != "data") throw IllegalArgumentException("not a recorder WAV")
      val channels = h.getShort(22).toInt()
      val rate = h.getInt(24)
      if (h.getShort(34).toInt() != 16 || channels < 1) throw IllegalArgumentException("not 16-bit PCM")
      var remaining = minOf(h.getInt(40).toLong() and 0xffffffffL, input.length() - 44)
      if (remaining <= 0) throw IllegalArgumentException("empty recording")
      val frameBytes = 2 * channels
      out.delete()
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, channels).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
      val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      var track = -1
      var started = false
      var ok = false
      try {
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val info = MediaCodec.BufferInfo()
        val chunk = ByteArray(16384)
        var samples = 0L
        var inputDone = false
        var outputDone = false
        while (!outputDone) {
          if (!inputDone) {
            val i = codec.dequeueInputBuffer(TIMEOUT_US)
            if (i >= 0) {
              val buf = codec.getInputBuffer(i)!!
              buf.clear()
              val want = (minOf(buf.capacity().toLong(), chunk.size.toLong(), remaining).toInt() / frameBytes) * frameBytes
              val n = if (want > 0) input.read(chunk, 0, want) else -1
              val ptsUs = samples * 1_000_000L / rate
              if (n <= 0) {
                codec.queueInputBuffer(i, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                buf.put(chunk, 0, n)
                codec.queueInputBuffer(i, 0, n, ptsUs, 0)
                samples += n / frameBytes
                remaining -= n
              }
            }
          }
          val o = codec.dequeueOutputBuffer(info, TIMEOUT_US)
          if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            started = true
          } else if (o >= 0) {
            val buf = codec.getOutputBuffer(o)!!
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
            if (info.size > 0 && started) {
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              muxer.writeSampleData(track, buf, info)
            }
            codec.releaseOutputBuffer(o, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
        ok = started
      } finally {
        try { codec.stop() } catch (_: Exception) {}
        codec.release()
        try { if (started) muxer.stop() } catch (_: Exception) { ok = false }
        muxer.release()
        if (!ok) out.delete()
      }
      if (!ok) throw IllegalStateException("the encoder produced nothing")
    }
  }
}
