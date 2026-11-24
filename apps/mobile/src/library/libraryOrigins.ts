// Which library files came from the library (sync's `LibraryFileOrigins`, docs/nearby-sync-plan.md
// 5.12). Only a phone passes files to a teammate, so the web keeps no record: libraryOrigins.native.ts.

export function noteLibraryFiles(_hashes: readonly string[]): void {}

export async function libraryFilesKnown(_hashes: readonly string[]): Promise<Set<string>> {
  return new Set();
}
