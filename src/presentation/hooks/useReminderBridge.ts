import { useEffect } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';

/** Connects scheduler events to in-app toasts and native browser notifications. */
export function useReminderBridge() {
  const { scheduler, store, notifier } = useApp();
  useEffect(() => {
    const off = scheduler.on((event) => {
      const ui = useUi.getState();
      const nodes = store.getSnapshot().nodes;
      if (event.type === 'missed') {
        ui.toast({
          message: t.reminders.missedToast(event.reminders.length),
          tone: 'warning',
          duration: 0,
          action: { label: t.reminders.title, run: () => useUi.getState().setPanel('notifications') },
        });
        notifier.notify({ title: t.reminders.notificationTitle, body: t.reminders.missedToast(event.reminders.length), tag: 'orbital-missed' });
        return;
      }
      for (const r of event.reminders) {
        const title = nodes.get(r.nodeId)?.title ?? t.reminders.unknownNode;
        const open = () => useUi.getState().select(r.nodeId, { fly: true });
        ui.toast({ message: t.reminders.dueToast(title), tone: 'warning', duration: 0, action: { label: t.reminders.open, run: open } });
        notifier.notify({ title: t.reminders.notificationTitle, body: r.note ? `${title} — ${r.note}` : title, tag: `orbital-${r.id}`, onClick: open });
      }
    });
    scheduler.start();
    const wake = () => scheduler.wake();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      off();
      scheduler.stop();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [scheduler, store, notifier]);
}
