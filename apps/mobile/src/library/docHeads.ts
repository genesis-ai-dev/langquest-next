// The web walks no library for nearby, and keeps no heads on disk: the phones' is docHeads.native.ts.
import type { DocHead } from '@langquest-next/core';

export function headsFromDisk(_keptAs: string, _dir: () => unknown, _into: Map<string, DocHead>): Promise<void> {
  return Promise.resolve();
}

export function headsToDiskSoon(_keptAs: string, _dir: () => unknown, _hash: string, _head: DocHead): void {}
