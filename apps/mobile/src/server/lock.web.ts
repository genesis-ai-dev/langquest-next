import type { Session } from '@supabase/supabase-js';
import type { Wrap } from '../auth/lockModel';

/**
 * The web never locks a sign-in (decisions.md 168): a browser forgets
 * everything on sign-out (forgetBrowser.ts, decision 11), so there is
 * nothing to come back to. The same calls as lock.ts, doing nothing, keep
 * the lock's cryptography out of the web bundle.
 */
export const LOCKS_ON_SIGN_OUT = false;

export type PatternChoice = { kind: 'ok' } | { kind: 'pictureTaken' };
export type Opened = { kind: 'ok'; actorId: string; key: string } | { kind: 'none' } | { kind: 'wrong' } | { kind: 'wait'; ms: number };

const nothing = async () => undefined;

export function onLocksChanged(_listener: () => void): () => void { return () => {}; }
export const rememberPassword = nothing as (actorId: string, address: string, password: string) => Promise<void>;
export const signedInHere = nothing as (actorId: string) => Promise<void>;
export async function lockWays(_actorId: string): Promise<Wrap['kind'][]> { return []; }
export async function lockPictures(_actorId: string): Promise<{ taken: number[]; mine: number | null }> { return { taken: [], mine: null }; }
export async function setLockPattern(_actorId: string, _dots: readonly number[], _picture: number): Promise<PatternChoice> { return { kind: 'pictureTaken' }; }
export async function lockAndSignOut(_actorId: string): Promise<void> { throw new Error('A browser does not lock a sign-in.'); }
export const sealHandedOver = nothing as (actorId: string, raw: string) => Promise<void>;
export async function keepLockedAfterHandOver(_actorId: string, _raw: string | null): Promise<boolean> { return false; }
export const dropLockedSession = nothing as (actorId: string) => Promise<void>;
export async function openLock(_kind: Wrap['kind'], _secret: string, _who: { address?: string; actorId?: string }): Promise<Opened> { return { kind: 'none' }; }
export function onUnlocked(_listener: (session: Session) => void): () => void { return () => {}; }
export async function restoreSession(_actorId: string, _key: string, _kept: string | null): Promise<boolean> { return false; }
export async function patternPeople(): Promise<{ actorId: string; picture: number }[]> { return []; }
export const forgetLock = nothing as (actorId: string) => Promise<void>;
