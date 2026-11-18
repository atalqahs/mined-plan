import type { NotificationMessage, NotificationPermissionState, Notifier } from '@/application/ports';

/**
 * Web Notifications API adapter.
 * Limitations (documented in README): notifications are shown only while a tab
 * of the app is open. There is no push server, so nothing is delivered while the
 * browser or the tab is closed; such reminders are surfaced as "missed" on the next launch.
 */
export class BrowserNotifier implements Notifier {
  permission(): NotificationPermissionState {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as NotificationPermissionState;
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    if (this.permission() === 'unsupported') return 'unsupported';
    try {
      return (await Notification.requestPermission()) as NotificationPermissionState;
    } catch {
      return this.permission();
    }
  }

  notify(message: NotificationMessage): boolean {
    if (this.permission() !== 'granted') return false;
    try {
      const n = new Notification(message.title, { body: message.body, tag: message.tag, lang: 'ar', dir: 'rtl' });
      n.onclick = () => {
        window.focus();
        message.onClick?.();
        n.close();
      };
      return true;
    } catch {
      // Some platforms (e.g. Android Chrome) only allow notifications via a service worker.
      return false;
    }
  }
}
