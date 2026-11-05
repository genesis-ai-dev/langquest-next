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
