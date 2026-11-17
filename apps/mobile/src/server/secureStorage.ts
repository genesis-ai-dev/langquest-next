import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureKeyValue } from './secureStorageModel';

/**
 * Where the signed-in session and the sessions kept for hand-overs live on a
 * phone: the Keychain / Keystore, never plain AsyncStorage (decisions.md 60).
 * After the first unlock, so a hand-over can be delivered while the phone is
 * locked (a push wakes the app). The web build uses secureStorage.web.ts.
 */
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const secureStorage = secureKeyValue(
  {
    get: (key) => SecureStore.getItemAsync(key, options),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    delete: (key) => SecureStore.deleteItemAsync(key, options)
  },
  AsyncStorage
);

/**
 * For what must never leave this phone: the nearby install key (decisions.md 217). On an iPhone
 * its Keychain entry is for this device only, so neither an iCloud backup nor a move to a new
 * iPhone carries it, and a restored iPhone makes a new key as a restored Android does. After the
 * first unlock, as above. Android's Keystore never leaves the phone and expo-secure-store reads no
 * `keychainAccessible` there, so on Android these are the same entries as `secureStorage`'s.
 */
const deviceOnly: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const deviceOnlyStorage = secureKeyValue(
  {
    get: (key) => SecureStore.getItemAsync(key, deviceOnly),
    set: (key, value) => SecureStore.setItemAsync(key, value, deviceOnly),
    delete: (key) => SecureStore.deleteItemAsync(key, deviceOnly)
  },
  AsyncStorage
);
