import { CommandError } from '@langquest-next/core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from './i18n';

/**
 * The phones' push (push.web.ts is the browser's, which has none). Kept
 * apart so the web build never loads expo-notifications, which registers a
 * push-token listener as soon as it is imported.
 */

/** Asks for permission and returns this phone's Expo push token. */
export async function requestPushToken(): Promise<string> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('work', {
    name: t('account.notifications.channel'), importance: Notifications.AndroidImportance.DEFAULT
  });
  const permission = await Notifications.requestPermissionsAsync();
  // A CommandError: an expected answer, shown to the person as it is (account.tsx).
  if (!permission.granted) throw new CommandError(t('account.notifications.off'));
  return (await Notifications.getExpoPushTokenAsync({
    projectId: '582d3757-4245-419a-9087-e269e3bf4c4d'
  })).data;
}

/** Calls `open` for the notification that launched the app, and for each one tapped while it runs. */
export function onNotificationOpened(open: () => void): () => void {
  const receive = (response: Notifications.NotificationResponse | null) => {
    if (!response?.notification.request.content.data?.notificationId) return;
    open();
    void Notifications.clearLastNotificationResponseAsync();
  };
  void Notifications.getLastNotificationResponseAsync().then(receive);
  const listener = Notifications.addNotificationResponseReceivedListener(receive);
  return () => listener.remove();
}
