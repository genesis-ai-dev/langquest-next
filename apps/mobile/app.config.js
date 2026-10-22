// app.json with one change for store builds: the version that people see
// in the stores (decisions.md 150). Apple takes one App Store version per
// version number, so every build that goes to review needs a higher one.
// The EAS workflow on main passes the merge commit's time to its build jobs
// as LQ_STORE_VERSION_TIME, and the version is that time in UTC as
// year.monthday.hourminute (2026-10-22T18:30:00Z is 2026.1022.1830), which
// only grows. Every other build keeps app.json's version. The fingerprint
// leaves the version out (fingerprint.config.js), so a new version number
// never needs a rebuild by itself.

/** The store version for an ISO time, or null when there is none. */
function storeVersion(time) {
  if (!time) return null;
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) throw new Error(`LQ_STORE_VERSION_TIME is not a time: ${time}`);
  return `${at.getUTCFullYear()}.${(at.getUTCMonth() + 1) * 100 + at.getUTCDate()}.${at.getUTCHours() * 100 + at.getUTCMinutes()}`;
}

module.exports = ({ config }) => ({ ...config, version: storeVersion(process.env.LQ_STORE_VERSION_TIME) ?? config.version });
module.exports.storeVersion = storeVersion;
