package expo.modules.nearbylink

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/** The install file Give the app hands over (`NativeKeptFile` in src/NearbyLinkModule.ts). */
class KeptFile(val name: String, val file: File) {
  val size: Long get() = file.length()

  fun toMap(): Map<String, Any?> = mapOf("name" to name, "size" to size.toDouble())
}

/**
 * The install file Give the app hands over (docs/nearby-sync-plan.md 14.5), kept as a copy in
 * the app's own files folder, `install-file/`, and nowhere else: the module serves files only
 * from its own folders, and reading a file's package and signer needs a real path. A file is kept
 * only if it is this app's own: the same package name and the same signing certificates as the
 * running app. At most one is kept. Works on every Android the app runs on.
 */
class InstallFiles(private val context: Context) {
  private val folder: File get() = File(context.filesDir, FOLDER)

  /**
   * Copies `uri` (a content or file URI) to `install-file/<name>.part`, checks it, and keeps it as
   * `<name>`, deleting any other file there. FILE_NO_SPACE when it and `minFreeBytes` would not
   * fit, FILE_UNREADABLE when it cannot be read, FILE_WRITE_FAILED when the copy cannot be
   * written, FILE_REFUSED when it is not this app's own.
   */
  fun keep(uri: String, name: String, minFreeBytes: Long): KeptFile {
    if (!nameOk(name)) throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a carried build's name")
    if (minFreeBytes < 0) throw NearbyException(NearbyCode.BAD_ARGUMENT, "limits are not negative")
    val source = Uri.parse(uri)
    if (source.scheme != "content" && source.scheme != "file") throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a content or file URI")
    synchronized(lock) {
      val dir = folder
      dir.mkdirs()
      if (!dir.isDirectory) throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "no folder for the install file")
      val size = sizeOf(source)
      if (size != null && dir.usableSpace - size < minFreeBytes) throw NearbyException(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor")
      val part = File(dir, "$name.part")
      try {
        val input = try {
          context.contentResolver.openInputStream(source)
        } catch (e: Exception) {
          null
        } ?: throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not open the install file")
        input.use { copy(it, part, dir, minFreeBytes) }
        if (!ours(part)) throw NearbyException(NearbyCode.FILE_REFUSED, "not this app's own install file")
        val kept = File(dir, name)
        if (!part.renameTo(kept)) throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not keep the install file")
        for (other in dir.listFiles().orEmpty()) if (other.name != name) other.delete()
        return KeptFile(name, kept)
      } catch (e: Exception) {
        part.delete()
        throw e as? NearbyException ?: NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not keep the install file", e)
      }
    }
  }

  /** The kept file, or null. */
  fun kept(): KeptFile? = synchronized(lock) {
    folder.listFiles().orEmpty()
      .filter { it.isFile && nameOk(it.name) }
      .maxByOrNull { it.lastModified() }
      ?.let { KeptFile(it.name, it) }
  }

  /** Deletes the kept file, and a copy left part-way. */
  fun drop() = synchronized(lock) {
    for (f in folder.listFiles().orEmpty()) f.delete()
  }

  /** The size the provider gives, or null when it does not know. */
  private fun sizeOf(source: Uri): Long? {
    if (source.scheme == "file") return source.path?.let { File(it) }?.takeIf { it.isFile }?.length()
    return try {
      context.contentResolver.query(source, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        val at = c.getColumnIndex(OpenableColumns.SIZE)
        if (c.moveToFirst() && at >= 0 && !c.isNull(at)) c.getLong(at).takeIf { it >= 0 } else null
      }
    } catch (e: Exception) {
      null
    }
  }

  /** Copies and syncs; a read that fails is FILE_UNREADABLE, a write FILE_WRITE_FAILED. */
  private fun copy(input: InputStream, part: File, dir: File, minFreeBytes: Long) {
    val out = try { FileOutputStream(part, false) } catch (e: IOException) {
      throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not open the copy", e)
    }
    out.use { o ->
      val buffer = ByteArray(64 * 1024)
      var sinceCheck = 0L
      while (true) {
        val n = try { input.read(buffer) } catch (e: IOException) {
          throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not read the install file", e)
        }
        if (n < 0) break
        // A size the provider did not give is checked as the copy grows.
        sinceCheck += n
        if (sinceCheck >= SPACE_CHECK) {
          sinceCheck = 0
          if (dir.usableSpace < minFreeBytes) throw NearbyException(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor")
        }
        try { o.write(buffer, 0, n) } catch (e: IOException) {
          throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not write the copy", e)
        }
      }
      try {
        o.flush()
        o.fd.sync()
      } catch (e: IOException) {
        throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not finish the copy", e)
      }
    }
  }

  /** Whether the file at `apk` has this app's package name and exactly its signing certificates. */
  private fun ours(apk: File): Boolean {
    val pm = context.packageManager
    val archive = try { archiveInfo(pm, apk.path) } catch (e: Exception) { null } ?: return false
    if (archive.packageName != context.packageName) return false
    val own = try { installedInfo(pm, context.packageName) } catch (e: Exception) { null } ?: return false
    return sameSigners(signers(archive), signers(own))
  }

  // GET_SIGNATURES below Android 9: its old weakness, a package with several signers matched on
  // any one (Android 4.4 and earlier), does not apply, since every signer is compared here.
  @Suppress("DEPRECATION")
  private fun archiveInfo(pm: PackageManager, path: String): PackageInfo? = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
      pm.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES)
    else -> pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES)
  }

  @Suppress("DEPRECATION")
  private fun installedInfo(pm: PackageManager, pkg: String): PackageInfo? = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
      pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
    else -> pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
  }

  /** The certificates that sign the package now (not past ones it rotated from), as their bytes. */
  @Suppress("DEPRECATION")
  private fun signers(info: PackageInfo): List<ByteArray> {
    val found: Array<Signature>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.signingInfo?.apkContentsSigners
    } else {
      info.signatures
    }
    return found.orEmpty().map { it.toByteArray() }
  }

  companion object {
    /** The folder under the app's files folder; nothing else in it. */
    const val FOLDER = "install-file"
    private const val SPACE_CHECK = 1L shl 20
    private val lock = Any()
    /** A carried build's name, as core's `carriedApkName` writes it (packages/core/src/carriedApk.ts). */
    private val NAME = Regex("^r[0-9]+-l[0-9]+-p[0-9]+(\\.[0-9]+)?-[0-9a-f]{8}\\.apk$")

    fun nameOk(name: String): Boolean = name.length <= 128 && NAME.matches(name)

    /** Two non-empty sets of certificates, equal as sets by their SHA-256. */
    fun sameSigners(a: List<ByteArray>, b: List<ByteArray>): Boolean {
      if (a.isEmpty() || b.isEmpty()) return false
      val digest = { c: ByteArray -> Bytes.hex(MessageDigest.getInstance("SHA-256").digest(c)) }
      return a.map(digest).toSet() == b.map(digest).toSet()
    }
  }
}
