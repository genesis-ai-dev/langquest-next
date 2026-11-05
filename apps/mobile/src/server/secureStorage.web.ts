import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The web has no Keychain: the session stays in the browser's storage, which
 * signing out wipes (web/forgetBrowser.ts). Keeps expo-secure-store out of the web bundle.
 */
export const secureStorage = AsyncStorage;
