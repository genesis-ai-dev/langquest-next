import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * The phones' push (push.web.ts is the browser's, which has none). Kept
 * apart so the web build never loads expo-notifications, which registers a
 * push-token listener as soon as it is imported.
 */

/** Asks for permission and returns this phone's Expo push token. */
export async function requestPushToken(): Promise<string> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('work', {
    name: 'Work updates', importance: Notifications.AndroidImportance.DEFAULT
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notifications are off. Your inbox still works.');
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
