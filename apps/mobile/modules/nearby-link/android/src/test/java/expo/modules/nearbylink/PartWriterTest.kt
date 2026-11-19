package expo.modules.nearbylink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PartWriterTest {
  @get:Rule val tmp = TemporaryFolder()
  private val files = Vectors.json.getJSONObject("files")

  private fun expectCode(code: NearbyCode, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: NearbyException) {
      assertEquals(code, e.code)
    }
  }

  private fun root() = tmp.root
  private fun target(name: String = "abc.m4a.nearby.part") = File(root(), "blobs/$name")

  @Test fun writesHashesAndSyncsAFile() {
    val bytes = Vectors.pattern(files.getInt("bytes"))
    val w = PartWriter(target(), listOf(root()), 1_000_000, 0)
    w.begin(bytes.size.toLong())
    var at = 0
    while (at < bytes.size) {
      val n = minOf(65536, bytes.size - at)
      w.write(bytes, at, n)
      at += n
    }
    val r = w.finish()
    assertEquals(bytes.size.toLong(), r.size)
    assertEquals(files.getString("sha256"), r.sha256)
    assertEquals(bytes.size.toLong(), target().length())
  }

  @Test fun anEmptyFileHasTheEmptyHash() {
    val w = PartWriter(target(), listOf(root()), 10, 0)
    w.begin(0)
    assertEquals(files.getString("empty"), w.finish().sha256)
  }

  @Test fun refusesANameThatIsNotAPartOrOutsideTheRoots() {
    expectCode(NearbyCode.STAGING_REFUSED) { PartWriter(File(root(), "abc.m4a"), listOf(root()), 10, 0) }
    expectCode(NearbyCode.STAGING_REFUSED) { PartWriter(File(root(), "../elsewhere/x.part"), listOf(root()), 10, 0) }
    expectCode(NearbyCode.STAGING_REFUSED) { PartWriter(File(tmp.newFolder("other"), "x.part"), listOf(File(root(), "blobs")), 10, 0) }
  }

  @Test fun stopsPastMaxBytesAndLeavesNothing() {
    expectCode(NearbyCode.FILE_TOO_BIG) { PartWriter(target(), listOf(root()), 10, 0).begin(11) }
    val w = PartWriter(target(), listOf(root()), 10, 0)
    w.begin(10)
    w.write(ByteArray(6))
    expectCode(NearbyCode.FILE_TOO_BIG) { w.write(ByteArray(6)) }
    w.discard()
    assertFalse(target().exists())
  }

  @Test fun stopsWhenTheDiskWouldFallUnderItsFloor() {
    var free = 1000L
    expectCode(NearbyCode.FILE_NO_SPACE) { PartWriter(target(), listOf(root()), 10_000, 500) { free }.begin(600) }
    val w = PartWriter(target(), listOf(root()), 10_000, 500) { free }
    w.begin(400)
    w.write(ByteArray(100))
    free = 550
    expectCode(NearbyCode.FILE_NO_SPACE) { w.write(ByteArray(100)) }
    w.discard()
    assertFalse(target().exists())
  }

  @Test fun refusesAFileThatIsNotTheSizeAnnounced() {
    val w = PartWriter(target(), listOf(root()), 100, 0)
    w.begin(10)
    w.write(ByteArray(5))
    expectCode(NearbyCode.FILE_SIZE_MISMATCH) { w.finish() }
    expectCode(NearbyCode.FILE_TOO_BIG) { PartWriter(target("b.part"), listOf(root()), 100, 0).apply { begin(3) }.write(ByteArray(4)) }
  }
}
