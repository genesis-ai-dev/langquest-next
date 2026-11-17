package expo.modules.nearbylink

/**
 * Find's times and retries as JavaScript sends them (`FindTunables` in packages/sync/src/nearbyLink.ts),
 * read from the map Expo hands over. Every tunable is an argument from JavaScript, because a Kotlin
 * edit needs a store review (docs/nearby-sync-plan.md 5.9). Pure.
 */
data class FindTunables(
  val rotateMinMs: Long,
  val rotateMaxMs: Long,
  val scanStartGapMs: Long,
  val scanRestartMs: Long,
  val connectRetries: Int,
  /** Null: always connectable. Otherwise connectable for `connectableMs` after hearing a teammate. */
  val afterHearing: AfterHearing?,
  /** One empty `ScanFilter`, the usual way round makers that hold back unfiltered results. */
  val emptyScanFilter: Boolean,
  /** `low`, `medium` or `high`: Android's advertising intervals. */
  val advertiseInterval: String,
  /** `low-latency`, `balanced` or `low-power`. */
  val scanMode: String,
  /** A salt no key matched is handed up again only after this long. */
  val formSaltRepeatMs: Long,
  /** How long one GATT connection may take before it is tried again. */
  val connectTimeoutMs: Long,
) {
  data class AfterHearing(val listenMs: Long, val connectableMs: Long)

  /** A jittered rotation period within the bounds, from a uniform draw in [0, 1). */
  fun rotationMs(draw: Double): Long = rotateMinMs + ((rotateMaxMs - rotateMinMs).coerceAtLeast(0) * draw).toLong()

  companion object {
    fun of(map: Map<String, Any?>): FindTunables {
      val min = long(map, "rotateMinMs")
      val max = long(map, "rotateMaxMs")
      if (min <= 0 || max < min) throw NearbyException(NearbyCode.BAD_ARGUMENT, "a rotation's bounds")
      val connectable = map["connectable"]
      val after = when {
        connectable == "always" || connectable == null -> null
        connectable is Map<*, *> && connectable["mode"] == "after-hearing" ->
          AfterHearing(number(connectable["listenMs"], "listenMs").toLong(), number(connectable["connectableMs"], "connectableMs").toLong())
        else -> throw NearbyException(NearbyCode.BAD_ARGUMENT, "connectable")
      }
      return FindTunables(
        rotateMinMs = min,
        rotateMaxMs = max,
        scanStartGapMs = long(map, "scanStartGapMs"),
        scanRestartMs = long(map, "scanRestartMs"),
        connectRetries = long(map, "connectRetries").toInt().coerceIn(0, 10),
        afterHearing = after,
        emptyScanFilter = map["emptyScanFilter"] == true,
        advertiseInterval = (map["advertiseInterval"] as? String)?.takeIf { it in setOf("low", "medium", "high") } ?: "low",
        scanMode = (map["scanMode"] as? String)?.takeIf { it in setOf("low-latency", "balanced", "low-power") } ?: "low-latency",
        formSaltRepeatMs = (map["formSaltRepeatMs"] as? Number)?.toLong() ?: 5_000,
        connectTimeoutMs = (map["connectTimeoutMs"] as? Number)?.toLong() ?: 15_000,
      )
    }

    fun links(map: Map<String, Any?>): LinkTunables {
      val d = LinkTunables()
      fun n(name: String, fallback: Long) = (map[name] as? Number)?.toLong() ?: fallback
      return LinkTunables(
        queueMessages = n("queueMessages", d.queueMessages.toLong()).toInt().coerceIn(1, 256),
        fileChunk = n("fileChunk", d.fileChunk.toLong()).toInt().coerceIn(1024, 512 * 1024),
        fileWaitMs = n("fileWaitMs", d.fileWaitMs).coerceIn(0, 120_000),
        pipeBytes = n("pipeBytes", d.pipeBytes.toLong()).toInt().coerceIn(64 * 1024, 16 * 1024 * 1024),
        byeWaitMs = n("byeWaitMs", d.byeWaitMs).coerceIn(0, 10_000),
        byeDrainMs = n("byeDrainMs", d.byeDrainMs).coerceIn(0, 10_000),
      )
    }

    private fun number(value: Any?, name: String): Number =
      value as? Number ?: throw NearbyException(NearbyCode.BAD_ARGUMENT, "$name is not a number")

    private fun long(map: Map<String, Any?>, name: String): Long {
      val v = number(map[name], name).toLong()
      if (v < 0) throw NearbyException(NearbyCode.BAD_ARGUMENT, "$name is negative")
      return v
    }
  }
}
