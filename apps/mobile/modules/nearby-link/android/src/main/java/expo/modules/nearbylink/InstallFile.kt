package expo.modules.nearbylink

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** The install file Give the app hands over (`NativeKeptFile` in src/NearbyLinkModule.ts). */
class KeptFile(val name: String, val file: File) {
  val size: Long get() = file.length()

  fun toMap(): Map<String, Any?> = mapOf("name" to name, "size" to size.toDouble())
}

/**
 * The install file Give the app hands over (docs/nearby-sync-plan.md 14.5), kept as a copy in
 * the app's own files folder, `install-file/`, and nowhere else: the module serves files only
 * from its own folders, and reading a file's package and signer needs a real path. A file is kept
 * only if it is this app's own (the same package name and the same signing certificates as the
 * running app) and its name tells the truth (its runtime version starts with the name's
 * fingerprint). At most one is kept.
 *
 * Reading an archive's signers takes different flags by Android version: Android 9 and 10
 * collect an archive's certificates only when GET_SIGNATURES is asked for, so there both are
 * (`archiveInfo`); without it every file would be refused.
 */
class InstallFiles(private val context: Context) {
  private val folder: File get() = File(context.filesDir, FOLDER)

  /**
   * Copies `uri` (a content URI, as the system picker gives) to a `.part` file of its own in
   * `install-file/`, checks it, and keeps it as `<name>`, deleting every other file there.
   * FILE_TOO_BIG past `MAX_BYTES`, FILE_NO_SPACE when it and `minFreeBytes` would not fit,
   * FILE_UNREADABLE when it cannot be read or is not a plain file, FILE_WRITE_FAILED when the copy
   * cannot be written, FILE_REFUSED when it is not this app's own or not what its name says.
   * The copy runs outside the lock, so a slow provider holds up nothing else.
   */
  fun keep(uri: String, name: String, minFreeBytes: Long): KeptFile {
    if (!nameOk(name)) throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a carried build's name")
    if (minFreeBytes < 0) throw NearbyException(NearbyCode.BAD_ARGUMENT, "limits are not negative")
    val source = Uri.parse(uri)
    if (source.scheme != "content") throw NearbyException(NearbyCode.BAD_ARGUMENT, "not a content URI")
    val dir = folder
    val part = File(dir, "$name.${UUID.randomUUID()}.part")
    synchronized(lock) {
      dir.mkdirs()
      if (!dir.isDirectory) throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "no folder for the install file")
      // A copy a stopped app left behind; never one another call is still writing.
      for (f in dir.listFiles().orEmpty()) if (f.name.endsWith(".part") && f.name !in writing) f.delete()
      writing.add(part.name)
    }
    try {
      openPlainFile(source, dir, minFreeBytes).use { copy(it, part, dir, minFreeBytes) }
      synchronized(lock) {
        if (!ours(part, name)) throw NearbyException(NearbyCode.FILE_REFUSED, "not this app's own install file, or not the build its name says")
        val kept = File(dir, name)
        if (!part.renameTo(kept)) throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not keep the install file")
        for (other in dir.listFiles().orEmpty()) if (other.name != name && other.name !in writing) other.delete()
        return KeptFile(name, kept)
      }
    } catch (e: Exception) {
      part.delete()
      throw e as? NearbyException ?: NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not keep the install file", e)
    } finally {
      synchronized(lock) { writing.remove(part.name) }
    }
  }

  /** The kept file, or null. */
  fun kept(): KeptFile? = synchronized(lock) {
    folder.listFiles().orEmpty()
      .filter { it.isFile && nameOk(it.name) }
      .maxByOrNull { it.lastModified() }
      ?.let { KeptFile(it.name, it) }
  }

  /** Deletes the kept file, and any copy left part-way that no call is still writing. */
  fun drop() = synchronized(lock) {
    for (f in folder.listFiles().orEmpty()) if (f.name !in writing) f.delete()
  }

  /**
   * The picked file, read through its descriptor: a plain file (not a pipe a provider streams),
   * of a size under `MAX_BYTES` that fits with `minFreeBytes` to spare.
   */
  private fun openPlainFile(source: Uri, dir: File, minFreeBytes: Long): InputStream {
    val fd = try {
      context.contentResolver.openFileDescriptor(source, "r")
    } catch (e: Exception) {
      null
    } ?: throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not open the install file")
    try {
      val stat = try { Os.fstat(fd.fileDescriptor) } catch (e: Exception) {
        throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not read the install file", e)
      }
      if (!OsConstants.S_ISREG(stat.st_mode)) throw NearbyException(NearbyCode.FILE_UNREADABLE, "not a plain file")
      if (stat.st_size > MAX_BYTES) throw NearbyException(NearbyCode.FILE_TOO_BIG, "over the size limit")
      if (dir.usableSpace - stat.st_size < minFreeBytes) throw NearbyException(NearbyCode.FILE_NO_SPACE, "the disk would fall under its floor")
      return ParcelFileDescriptor.AutoCloseInputStream(fd)
    } catch (e: Exception) {
      try { fd.close() } catch (_: IOException) {}
      throw e
    }
  }

  /** Copies and syncs; a read that fails is FILE_UNREADABLE, a write FILE_WRITE_FAILED. */
  private fun copy(input: InputStream, part: File, dir: File, minFreeBytes: Long) {
    val out = try { FileOutputStream(part, false) } catch (e: IOException) {
      throw NearbyException(NearbyCode.FILE_WRITE_FAILED, "could not open the copy", e)
    }
    out.use { o ->
      val buffer = ByteArray(64 * 1024)
      var written = 0L
      var sinceCheck = 0L
      while (true) {
        val n = try { input.read(buffer) } catch (e: IOException) {
          throw NearbyException(NearbyCode.FILE_UNREADABLE, "could not read the install file", e)
        }
        if (n < 0) break
        // A file that grows as it is read is held to the same limits.
        written += n
        if (written > MAX_BYTES) throw NearbyException(NearbyCode.FILE_TOO_BIG, "over the size limit")
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

  /** Whether the file at `apk` has this app's package name and exactly its signing certificates, and is the build `name` says. */
  private fun ours(apk: File, name: String): Boolean {
    val pm = context.packageManager
    val archive = try { archiveInfo(pm, apk.path) } catch (e: Exception) { null } ?: return false
    if (archive.packageName != context.packageName) return false
    val own = try { installedInfo(pm, context.packageName) } catch (e: Exception) { null } ?: return false
    if (!sameSigners(signers(archive), signers(own))) return false
    return runtimeMatches(name, runtimeVersionOf(pm, archive, apk.path))
  }

  // GET_SIGNATURES's old weakness, a package with several signers matched on any one (Android
  // 4.4 and earlier), does not apply: every signer is compared here.
  @Suppress("DEPRECATION")
  private fun archiveInfo(pm: PackageManager, path: String): PackageInfo? = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
      pm.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of((PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_META_DATA).toLong()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_META_DATA)
    // Android 9 and 10 collect an archive's certificates only for GET_SIGNATURES; GET_SIGNING_CERTIFICATES then fills `signingInfo`.
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ->
      pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES or PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_META_DATA)
    else -> pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES or PackageManager.GET_META_DATA)
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

  /**
   * The archive's runtime version as expo-updates reads it (`UpdatesConfiguration.getRuntimeVersion`):
   * its meta-data, a string or a string resource of the archive's own, and under the fingerprint
   * policy, which this app uses, the archive's `fingerprint` asset. Null when it cannot be read.
   */
  // Bundle.get, deprecated from Android 13, is the one way to tell a string from a resource id
  // without the typed getters' warnings.
  @Suppress("DEPRECATION")
  private fun runtimeVersionOf(pm: PackageManager, archive: PackageInfo, path: String): String? = try {
    val app = archive.applicationInfo
    if (app == null) {
      null
    } else {
      // The archive's own resources and assets, not the running app's.
      app.sourceDir = path
      app.publicSourceDir = path
      val resources by lazy { pm.getResourcesForApplication(app) }
      val meta = when (val value = app.metaData?.get(RUNTIME_VERSION_KEY)) {
        is String -> value
        is Int -> resources.getString(value)
        else -> null
      }
      runtimeVersionFrom(meta) { resources.assets.open(FINGERPRINT_ASSET).use { it.readBytes().toString(Charsets.UTF_8) } }
    }
  } catch (e: Exception) {
    null
  }

  companion object {
    /** The folder under the app's files folder; nothing else in it. */
    const val FOLDER = "install-file"
    /** Far past any build of the app; a larger file is not one. */
    const val MAX_BYTES = 1L shl 30
    const val RUNTIME_VERSION_KEY = "expo.modules.updates.EXPO_RUNTIME_VERSION"
    /** expo-updates' meta-data value for "read the `fingerprint` asset" (the fingerprint policy). */
    const val FINGERPRINT_SENTINEL = "file:fingerprint"
    private const val FINGERPRINT_ASSET = "fingerprint"
    private const val SPACE_CHECK = 1L shl 20
    private val lock = Any()
    /** The `.part` names that calls in this process are still writing. */
    private val writing = HashSet<String>()
    /** A carried build's name, as core's `carriedApkName` writes it (packages/core/src/carriedApk.ts). */
    private val NAME = Regex("^r[0-9]+-l[0-9]+-p[0-9]+(\\.[0-9]+)?-[0-9a-f]{8}\\.apk$")

    fun nameOk(name: String): Boolean = name.length <= 128 && NAME.matches(name)

    /** Two non-empty sets of certificates, equal as sets by their SHA-256. */
    fun sameSigners(a: List<ByteArray>, b: List<ByteArray>): Boolean {
      if (a.isEmpty() || b.isEmpty()) return false
      val digest = { c: ByteArray -> Bytes.hex(MessageDigest.getInstance("SHA-256").digest(c)) }
      return a.map(digest).toSet() == b.map(digest).toSet()
    }

    /**
     * The runtime version from expo-updates' meta-data value, read as expo-updates reads it: a
     * leading `string:` dropped, and for its fingerprint sentinel the build's `fingerprint` asset.
     * Null when there is none.
     */
    fun runtimeVersionFrom(meta: String?, fingerprintAsset: () -> String?): String? {
      val value = meta?.removePrefix("string:")?.trim() ?: return null
      val version = if (value == FINGERPRINT_SENTINEL) fingerprintAsset()?.trim() else value
      return version?.takeIf { it.isNotEmpty() }
    }

    /** The fingerprint a carried build's name holds: its last `-xxxxxxxx` before `.apk`. */
    fun fingerprintOf(name: String): String = name.removeSuffix(".apk").substringAfterLast('-')

    /**
     * Whether a build whose runtime version is `runtimeVersion` may go by `name`: its first 8
     * characters, lowercased as core's `carriedApkName` writes them, are the name's fingerprint,
     * so an older build renamed to today's name is refused. A runtime version that cannot be read
     * (null) keeps the file: this fails open on purpose, since the signer check has already shown
     * the file is this app's own, and a build whose metadata reads differently on some phone
     * should not leave its carrier with no way to give the app.
     */
    fun runtimeMatches(name: String, runtimeVersion: String?): Boolean {
      if (runtimeVersion == null) return true
      return runtimeVersion.lowercase().take(8) == fingerprintOf(name)
    }
  }
}
