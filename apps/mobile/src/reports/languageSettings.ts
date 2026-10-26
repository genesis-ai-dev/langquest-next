import { ORG_STREAM, type EventPayloads } from '@langquest-next/core';
import { appendConfirmed, ensureDeviceId } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { serverTransport } from '../sync/serverTransport';
import { getStore } from '../storage/store';

/** A language's country, or what it aims to record and by when, as Reports' settings set them (decision 41). */
export type LanguageSetting =
  | { type: 'v1.LanguageCountrySet'; payload: EventPayloads['v1.LanguageCountrySet'] }
  | { type: 'v1.LanguageTargetSet'; payload: EventPayloads['v1.LanguageTargetSet'] };

/**
 * Write one to the organization's stream and wait for the server to take it
 * (`appendConfirmed`): Reports reads it back from the server, so a change it
 * has not taken is said as not saved (`NotSavedError`).
 */
export async function saveLanguageSetting(orgId: string, actorId: string, setting: LanguageSetting): Promise<void> {
  const deviceId = await ensureDeviceId(await getStore(), () => Crypto.randomUUID());
  const who = { orgId, streamId: ORG_STREAM, actorId, deviceId, transport: serverTransport() };
  if (setting.type === 'v1.LanguageCountrySet') await appendConfirmed(who, setting.type, setting.payload);
  else await appendConfirmed(who, setting.type, setting.payload);
}
