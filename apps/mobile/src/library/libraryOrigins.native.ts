import { SqliteLibraryFileOrigins, type LibraryFileOrigins } from '@langquest-next/sync/nearby';
import { noteExpected } from '../diagnostics/report';
import { fileLedgerDriver } from '../storage/store';

/**
 * Which library files came from the library (sync's `LibraryFileOrigins`, docs/nearby-sync-plan.md
 * 5.12, Library files; security review 2026-11-24), in the file ledger's database: a guide file
 * fetched from the organization's guide files or uploaded from the guide editor, a library source's
 * chapter downloaded, or a library file taken from a teammate. Only these are passed on to a
 * teammate as library files, so a document naming a recording's hash never moves the recording.
 */
let origins: Promise<LibraryFileOrigins> | undefined;

export function libraryOrigins(): Promise<LibraryFileOrigins> {
  origins ??= fileLedgerDriver().then((driver) => SqliteLibraryFileOrigins.open(driver)).catch((error: unknown) => { origins = undefined; throw error; });
  return origins;
}

/** These came from the library. Never waits, never throws. */
export function noteLibraryFiles(hashes: readonly string[]): void {
  void libraryOrigins().then((o) => o.add(hashes)).catch((e: unknown) => noteExpected('library files: where they came from', e));
}

export async function libraryFilesKnown(hashes: readonly string[]): Promise<Set<string>> {
  try {
    return await (await libraryOrigins()).has(hashes);
  } catch (e) {
    noteExpected('library files: where they came from', e);
    return new Set();
  }
}
