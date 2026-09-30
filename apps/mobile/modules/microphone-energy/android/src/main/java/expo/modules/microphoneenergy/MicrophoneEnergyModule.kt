package expo.modules.microphoneenergy

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.*
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow

class MicrophoneEnergyModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var isActive = false
  private var recordingScope: CoroutineScope? = null
  private var writeScope: CoroutineScope? = null
  private val configLock = Any()
  @Volatile private var pendingWrites = 0
  private val writeWaiters = mutableListOf<() -> Unit>()
  
  private data class RingBufferEntry(val buffer: ShortArray, val timestamp: Long)
  private val ringBuffer = ArrayDeque<RingBufferEntry>()
  private val ringBufferMaxSize = 10
  
  private var isRecordingSegment = false
  private var segmentStartTime: Long = 0
  private val sampleRate = 44100
  // Audio for the open segment streams to disk as it arrives; only the
  // trimming window (half the pause) stays in memory.
  private var segmentWriter: SegmentWriter? = null
  
  private var vadEnabled = false
  private var vadThreshold = 0.05f
  private var vadOnsetMultiplier = 0.1f
  private var vadMaxOnsetDuration = 250
  private var vadSilenceDuration = 300
  private var vadMinSegmentDuration = 500
  private var vadRewindHalfPause = true
  private var vadMinActiveAudioDuration = 250  // Discard clips with less active audio than this
  
  private var vadState = "IDLE"
  private var preOnsetCutPoint: Long = 0
  private var lockedOnsetTime: Long = 0
  private var lastAboveThresholdTime: Long = 0
  private var recordingStartTime: Long = 0
  private var activeAudioTime: Long = 0  // Cumulative time above threshold during recording
  private var lastFrameTime: Long = 0    // For calculating delta time

  override fun definition() = ModuleDefinition {
    Name("MicrophoneEnergy")
    Events("onEnergyResult", "onError", "onSegmentComplete", "onSegmentStart")
    
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
  }

  private fun startEnergyDetection(promise: Promise) {
    if (isActive) stopEnergyDetectionInternal()
    synchronized(ringBuffer) { ringBuffer.clear() }
    segmentWriter?.discard(); segmentWriter = null; isRecordingSegment = false
    activeAudioTime = 0; lastFrameTime = 0
    try {
      val channelConfig = AudioFormat.CHANNEL_IN_MONO
      val audioFormat = AudioFormat.ENCODING_PCM_16BIT
      val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
      audioRecord = AudioRecord(MediaRecorder.AudioSource.DEFAULT, sampleRate, channelConfig, audioFormat, bufferSize)
      if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) throw Exception("AudioRecord initialization failed")
      audioRecord?.startRecording()
      isActive = true
      promise.resolve(null)
      recordingScope = CoroutineScope(Dispatchers.IO)
      recordingScope?.launch {
        val audioData = ShortArray(bufferSize / 2)
        while (isActive && audioRecord != null) {
          val bytesRead = audioRecord!!.read(audioData, 0, audioData.size)
          if (bytesRead > 0) processAudioData(audioData, bytesRead)
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
      vadState = "IDLE"
    }
    recordingScope?.cancel()
    recordingScope = null
    audioRecord?.stop()
    audioRecord?.release()
    audioRecord = null
  }
  
  private fun configureVAD(config: Map<String, Any?>) = synchronized(configLock) {
    (config["threshold"] as? Number)?.let { vadThreshold = it.toFloat() }
    (config["silenceDuration"] as? Number)?.let { vadSilenceDuration = it.toInt() }
    (config["minSegmentDuration"] as? Number)?.let { vadMinSegmentDuration = it.toInt() }
    (config["onsetMultiplier"] as? Number)?.let { vadOnsetMultiplier = it.toFloat() }
    (config["maxOnsetDuration"] as? Number)?.let { vadMaxOnsetDuration = it.toInt() }
    (config["rewindHalfPause"] as? Boolean)?.let { vadRewindHalfPause = it }
    (config["minActiveAudioDuration"] as? Number)?.let { vadMinActiveAudioDuration = it.toInt() }
  }
  
  private fun enableVAD() {
    synchronized(configLock) {
      vadEnabled = true; vadState = "IDLE"; preOnsetCutPoint = 0; lockedOnsetTime = 0; lastAboveThresholdTime = 0
      activeAudioTime = 0; lastFrameTime = 0
    }
  }
  
  private fun disableVAD(done: () -> Unit) {
    synchronized(configLock) { vadEnabled = false; vadState = "IDLE" }
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

  private suspend fun processAudioData(audioData: ShortArray, bytesRead: Int) {
    val now = System.currentTimeMillis()
    val dataCopy = audioData.copyOf(bytesRead)
    var peakAmplitude = 0.0
    for (i in 0 until bytesRead) { peakAmplitude = max(peakAmplitude, abs(audioData[i] / 32768.0)) }
    val db = 20.0 * log10(max(peakAmplitude, 1e-10))
    val clampedDb = max(-60.0, kotlin.math.min(0.0, db))
    val normalizedAmplitude = 10.0.pow(clampedDb / 20.0).toFloat()

    synchronized(configLock) {
      if (!isActive) return
      synchronized(ringBuffer) {
        ringBuffer.addLast(RingBufferEntry(dataCopy, now))
        if (ringBuffer.size > ringBufferMaxSize) ringBuffer.removeFirst()
      }
      if (isRecordingSegment) {
        val keep = if (vadRewindHalfPause) sampleRate * vadSilenceDuration / 2000 else 0
        segmentWriter?.append(dataCopy, keep)
      }
      if (vadEnabled) handleVAD(normalizedAmplitude, now)
    }
    withContext(Dispatchers.Main) { sendEvent("onEnergyResult", mapOf("energy" to normalizedAmplitude.toDouble(), "timestamp" to now.toDouble())) }
  }
  
  private fun handleVAD(rawPeak: Float, now: Long) {
    synchronized(configLock) { handleVADLocked(rawPeak, now) }
  }

  private fun handleVADLocked(rawPeak: Float, now: Long) {
    if (!vadEnabled || !isActive) return
    val onsetThreshold = vadThreshold * vadOnsetMultiplier
    if (rawPeak > vadThreshold) lastAboveThresholdTime = now
    
    when (vadState) {
      "IDLE" -> {
        preOnsetCutPoint = max(0, now - vadMaxOnsetDuration)
        if (rawPeak > onsetThreshold) {
          vadState = "ONSET_PENDING"; lockedOnsetTime = preOnsetCutPoint
          if (rawPeak > vadThreshold) confirmAndStartRecording(now)
        }
      }
      "ONSET_PENDING" -> {
        if (now - lockedOnsetTime > vadMaxOnsetDuration) lockedOnsetTime = now - vadMaxOnsetDuration
        when { rawPeak > vadThreshold -> confirmAndStartRecording(now); rawPeak <= onsetThreshold -> vadState = "IDLE" }
      }
      "RECORDING" -> {
        // Track cumulative time above threshold
        val deltaMs = now - lastFrameTime
        if (rawPeak > vadThreshold) {
          activeAudioTime += deltaMs
        }
        lastFrameTime = now
        
        val silenceMs = now - lastAboveThresholdTime
        val durationMs = now - recordingStartTime
        if (silenceMs >= vadSilenceDuration && durationMs >= vadMinSegmentDuration) stopRecordingAsync()
      }
    }
  }
  
  private fun confirmAndStartRecording(now: Long) {
    vadState = "RECORDING"; lastAboveThresholdTime = now; recordingStartTime = now
    activeAudioTime = 0; lastFrameTime = now  // Reset active audio tracking
    sendEvent("onSegmentStart", emptyMap<String, Any>())
    val prerollMs = (now - lockedOnsetTime).toInt()
    val p = object : Promise { override fun resolve(value: Any?) {}; override fun reject(code: String?, message: String?, cause: Throwable?) {} }
    startSegment(mapOf("prerollMs" to prerollMs), p)
  }
  
  private fun stopRecordingAsync() {
    if (!isRecordingSegment) return
    isRecordingSegment = false; vadState = "IDLE"
    val writer = segmentWriter
    segmentWriter = null
    
    // Check if enough active audio - discard transients/short sounds
    if (activeAudioTime < vadMinActiveAudioDuration) {
      println("VAD: Discarding segment - only ${activeAudioTime}ms of active audio (min: ${vadMinActiveAudioDuration}ms)")
      writer?.discard()
      // Emit empty URI to notify JS that recording stopped but was discarded
      sendEvent("onSegmentComplete", mapOf("uri" to "", "duration" to 0.0))
      return
    }
    
    val rewindMs = if (vadRewindHalfPause) vadSilenceDuration / 2 else 0
    val endTime = System.currentTimeMillis() - rewindMs
    finishSegment(writer, segmentStartTime, endTime, sampleRate * rewindMs / 1000)
  }
  
  /** Completes the file off the audio thread. Every failure reaches JS as onError. */
  private fun finishSegment(writer: SegmentWriter?, startTime: Long, endTime: Long, trimSamples: Int) {
    if (writer == null) return
    synchronized(writeWaiters) { pendingWrites += 1 }
    (writeScope ?: CoroutineScope(Dispatchers.IO).also { writeScope = it }).launch {
      try {
        writer.finish(trimSamples)
        withContext(Dispatchers.Main) {
          sendEvent("onSegmentComplete", mapOf("uri" to writer.uri, "startTime" to startTime.toDouble(), "endTime" to endTime.toDouble(), "duration" to (endTime - startTime).toDouble()))
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          sendEvent("onError", mapOf("message" to "Could not save recording (${writer.file.name}): ${e.message}"))
        }
      } finally { writeFinished() }
    }
  }

  private fun startSegment(options: Map<String, Any?>?, promise: Promise) {
    synchronized(configLock) {
      if (!isActive) { promise.reject("NOT_ACTIVE", "Energy detection not active", null); return }
      if (isRecordingSegment) { promise.resolve(null); return }
      try {
        val prerollMs = (options?.get("prerollMs") as? Number)?.toInt() ?: 200
        val context = appContext.reactContext ?: throw Exception("Context not available")
        // filesDir survives restarts, unlike cacheDir, so JS can resume an
        // interrupted save from its journal.
        val dir = java.io.File(context.filesDir, "recording-staging").also { it.mkdirs() }
        val writer = SegmentWriter(java.io.File(dir, "segment_${java.util.UUID.randomUUID()}.wav"), sampleRate)
        segmentStartTime = System.currentTimeMillis()
        synchronized(ringBuffer) {
          val maxPrerollBuffers = (prerollMs / (2048.0 / (sampleRate / 1000.0))).toInt()
          val buffersToWrite = kotlin.math.min(ringBuffer.size, maxPrerollBuffers)
          for (entry in ringBuffer.takeLast(buffersToWrite)) writer.append(entry.buffer, 0)
        }
        segmentWriter = writer
        isRecordingSegment = true; promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("START_SEGMENT_ERROR", "Failed to start segment", e)
        isRecordingSegment = false; segmentWriter = null
      }
    }
  }

  /** Manual stop: no rewind. The file completes off-thread and is announced by onSegmentComplete. */
  private fun stopSegment(promise: Promise) {
    synchronized(configLock) {
      if (!isRecordingSegment) { promise.resolve(null); return }
      isRecordingSegment = false; vadState = "IDLE"
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
