import { CommandError } from '@langquest-next/core';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { t } from '../i18n';
import { enableNotifications, notificationStanding, tryUnregisterNotifications } from '../notifications/notifications';
import { noteExpected } from '../diagnostics/report';

/**
 * More settings' Notifications switch (UI audit, finding 114): on when this
 * phone is registered and allowed, read again when the app comes back from
 * the phone's settings. On registers, off disconnects; refused for good,
 * the phone's settings are one tap away, the only place that can allow them.
 */
export function useNotificationSwitch(): {
  on: boolean | null; blocked: boolean; busy: boolean; message: string; toggle: () => void; openSettings: () => void;
} {
  const [on, setOn] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const read = useCallback(async () => {
    try {
      const s = await notificationStanding();
      setOn(s.on);
      setBlocked(s.blocked);
    } catch (e) {
      noteExpected('notification standing', e);
      setOn(false);
    }
  }, []);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void read(); });
    return () => sub.remove();
  }, [read]);

  async function flip() {
    setBusy(true);
    setMessage('');
    try {
      if (on) {
        if (await tryUnregisterNotifications()) setOn(false);
        else setMessage(t('account.more.notificationsOffNeedsConnection'));
      } else {
        await enableNotifications();
        setOn(true);
      }
    } catch (e) {
      // Turned off on the phone says so in its own words (push.ts); anything else is the server or the device.
      if (!(e instanceof CommandError)) noteExpected('enable notifications', e);
      setMessage(e instanceof CommandError ? e.message : t('account.more.notificationsFailed'));
      await read();
    } finally {
      setBusy(false);
    }
  }
  return {
    on, blocked, busy, message,
    toggle: () => { if (on !== null && !busy) void flip(); },
    openSettings: () => { Linking.openSettings().catch((e: unknown) => noteExpected('notifications: open settings', e)); }
  };
}
