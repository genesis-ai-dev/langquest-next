package expo.modules.nearbylink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class TunablesTest {
  private val base = mapOf<String, Any?>(
    "rotateMinMs" to 240000.0, "rotateMaxMs" to 360000.0, "scanStartGapMs" to 6000.0, "scanRestartMs" to 1500000.0, "connectRetries" to 3.0, "connectable" to "always",
  )

  @Test fun readsWhatJavaScriptSends() {
    val t = FindTunables.of(base)
    assertEquals(240000L, t.rotateMinMs)
    assertNull(t.afterHearing)
    assertEquals(240000L, t.rotationMs(0.0))
    assertEquals(300000L, t.rotationMs(0.5))
    val after = FindTunables.of(base + ("connectable" to mapOf("mode" to "after-hearing", "listenMs" to 1000.0, "connectableMs" to 20000.0)))
    assertEquals(FindTunables.AfterHearing(1000, 20000), after.afterHearing)
  }

  @Test fun refusesBrokenBounds() {
    for (bad in listOf(base + ("rotateMaxMs" to 1.0), base - "scanStartGapMs", base + ("connectable" to "sometimes"))) {
      try {
        FindTunables.of(bad)
        fail("refused")
      } catch (e: NearbyException) {
        assertEquals(NearbyCode.BAD_ARGUMENT, e.code)
      }
    }
  }

  @Test fun linkTunablesKeepTheirBounds() {
    val t = FindTunables.links(mapOf("queueMessages" to 0.0, "fileChunk" to 10.0))
    assertEquals(1, t.queueMessages)
    assertEquals(1024, t.fileChunk)
  }
}
