import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { BUILD_ID } from '../web/webBuild';

/** A development launch has no build to name: each one counts as new. */
const LAUNCH = `launch:${Date.now()}`;

/**
 * This build of the app: the commit a web page was built from, or a
 * phone's runtime and update. What the phone keeps that this code works
 * out (a passage's line, decisions.md 140) is worked out again under a new
 * one, so an update that reads a passage differently reaches every passage
 * with no migration.
 */
export function appBuild(): string {
  if (__DEV__) return LAUNCH;
  if (Platform.OS === 'web') return BUILD_ID || LAUNCH;
  return Updates.updateId ? `${Updates.runtimeVersion ?? ''}:${Updates.updateId}` : LAUNCH;
}
