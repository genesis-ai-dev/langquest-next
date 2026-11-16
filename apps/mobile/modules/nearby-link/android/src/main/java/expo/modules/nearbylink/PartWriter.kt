package expo.modules.nearbylink

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * Writes a teammate's file into its staging name (docs/nearby-sync-plan.md 5.6, 5.12): the exact
 * `.part` path JavaScript gave, inside one of the roots native allows (the app's own files and
 * cache folders). It hashes with SHA-256 as it writes, stops past `maxBytes` and when the disk
 * would fall under `minFreeBytes`, syncs before it reports, deletes the file on any failure, and
 * never renames: JavaScript compares the hash and renames. Pure, with free space passed in, so
 * JUnit runs its limits.
 */
class PartWriter(
  val target: File,
  roots: List<File>,
  private val maxBytes: Long,
  private val minFreeBytes: Long,
  private val freeBytes: (File) -> Long = { it.usableSpace },
) {
  private var out: FileOutputStream? = null
  private val digest = MessageDigest.getInstance("SHA-256")
  private var announced = -1L
  var written = 0L
    private set

  init {
    if (!target.name.endsWith(".part")) throw NearbyException(NearbyCode.STAGING_REFUSED, "a staging name ends .part")
    val path = target.canonicalPath
    val inside = roots.any { root ->
      val r = root.canonicalPath.trimEnd(File.separatorChar) + File.separator
      path.startsWith(r)
    }
    if (!inside) throw NearbyException(NearbyCode.STAGING_REFUSED, "a staging name outside the app's folders")
    if (maxBytes < 0 || minFreeBytes < 0) throw NearbyException(NearbyCode.BAD_ARGUMENT, "limits are not negative")
  }

  class Result(val size: Long, val sha256: String)

  /** The size the sender announced: refused before a byte is written if it cannot fit. */
  fun begin(size: Long) {
    if (out != null) throw NearbyException(NearbyCode.TRANSFER_BUSY, "already begun")
    if (size < 0 || size > maxBytes) throw NearbyException(NearbyCode.FILE_TOO_BIG, "over the size limit")
    val dir = target.parentFile ?: throw NearbyException(NearbyCode.STAGING_REFUSED, "no folder")
    // A folder that does not exist has no free space to read.
    dir.mkdirs()
    if (freeBytes(dir) - size < minFreeBytes) throw NearbyException(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor")
    announced = size
    try {
      out = FileOutputStream(target, false)
    } catch (e: IOException) {
      throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not open the staging file", e)
    }
  }

  fun write(bytes: ByteArray, from: Int = 0, count: Int = bytes.size - from) {
    val o = out ?: throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "not begun")
    if (written + count > maxBytes || (announced >= 0 && written + count > announced)) {
      throw NearbyException(NearbyCode.FILE_TOO_BIG, "past the size limit")
    }
    if (freeBytes(target.parentFile!!) - count < minFreeBytes) throw NearbyException(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor")
    try {
      o.write(bytes, from, count)
    } catch (e: IOException) {
      throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not write the staging file", e)
    }
    digest.update(bytes, from, count)
    written += count
  }

  /** Synced to the disk, then the size and hash. */
  fun finish(): Result {
    val o = out ?: throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "not begun")
    if (announced >= 0 && written != announced) throw NearbyException(NearbyCode.FILE_SIZE_MISMATCH, "not the size announced")
    try {
      o.flush()
      o.fd.sync()
      o.close()
    } catch (e: IOException) {
      throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not finish the staging file", e)
    }
    out = null
    return Result(written, Bytes.hex(digest.digest()))
  }

  /** Any failure: nothing is left behind. */
  fun discard() {
    try { out?.close() } catch (_: IOException) {}
    out = null
    target.delete()
  }
}
