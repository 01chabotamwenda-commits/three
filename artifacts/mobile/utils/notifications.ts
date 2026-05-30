import { Platform } from 'react-native';

let Notifications: typeof import('expo-notifications') | null = null;

async function getNotifications() {
  if (Platform.OS === 'web') return null;
  if (Notifications) return Notifications;
  try {
    Notifications = await import('expo-notifications');
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    } catch (err) {
      console.warn('Notification handler setup failed:', err);
    }
    return Notifications;
  } catch {
    return null;
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const n = await getNotifications();
    if (!n) return false;
    const { status: existingStatus } = await n.getPermissionsAsync();
    if (existingStatus === 'granted') return true;
    const { status } = await n.requestPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return false;
  }
}

export async function scheduleLocalNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const n = await getNotifications();
    if (!n) return;
    const granted = await requestNotificationPermissions();
    if (!granted) return;
    await n.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: opts.data ?? {},
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('Local notification scheduling failed:', err);
  }
}

export async function scheduleTimedNotification(opts: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  triggerDate: Date;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const n = await getNotifications();
    if (!n) return;
    const granted = await requestNotificationPermissions();
    if (!granted) return;
    await n.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: opts.data ?? {},
      },
      trigger: { date: opts.triggerDate } as any,
    });
  } catch (err) {
    console.warn('Timed notification scheduling failed:', err);
  }
}

/** Web fallback: use a simple alert/toast for notification reminders */
export async function showWebNotification(opts: { title: string; body: string }): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(opts.title, { body: opts.body });
    }
  } catch (err) {
    console.warn('Web notification failed:', err);
  }
}
