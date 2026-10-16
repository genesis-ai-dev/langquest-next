// A draft's undo history on this phone (useUndoHistory.ts) ends when the
// draft does: published or deleted.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteExpected } from '../diagnostics/report';

/** Forget a draft's history: it was published or deleted. */
export function forgetUndoHistory(key: string): void {
  void AsyncStorage.removeItem(key).catch((e: unknown) => noteExpected('undo history: forget', e, 'write'));
}
