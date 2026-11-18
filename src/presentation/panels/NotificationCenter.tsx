import { memo, useMemo, useState } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import { groupReminders, type ReminderItem } from '@/application/queries/reminders';
import type { ReminderBucket } from '@/domain/reminders/schedule';
import { localTimezone } from '@/domain/reminders/zonedTime';
import { Button, IconButton } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { fmt, t } from '@/presentation/i18n/ar';
import { useNow } from '@/presentation/hooks/useNow';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import { useUi } from '@/presentation/state/uiStore';
import panel from './Panel.module.css';
import styles from './NotificationCenter.module.css';

const ORDER: ReminderBucket[] = ['overdue', 'today', 'upcoming', 'completed'];

/** Grouped reminders panel. Opens over the workspace from the bell. */
export const NotificationCenter = memo(function NotificationCenter() {
  const open = useUi((s) => s.panel === 'notifications');
  if (!open) return null;
  return <NotificationBody />;
});

function NotificationBody() {
  const { notifier } = useApp();
  const snapshot = useSnapshot();
  const now = useNow(30_000);
  const groups = useMemo(() => groupReminders(snapshot, now, localTimezone()), [snapshot, now]);
  const [tab, setTab] = useState<ReminderBucket>(() => (groups.overdue.length ? 'overdue' : groups.today.length ? 'today' : 'upcoming'));
  const [perm, setPerm] = useState(notifier.permission());
  const total = ORDER.reduce((n, k) => n + groups[k].length, 0);

  return (
    <section className={`bevel ${panel.popover}`} aria-label={t.reminders.title} data-testid="notification-center">
      <div className={panel.head}>
        <div className={panel.headTitle}>
          <h2>{t.reminders.title}</h2>
        </div>
        <IconButton icon="close" size="sm" label={t.dialog.close} onClick={() => useUi.getState().setPanel('none')} />
      </div>

      {perm === 'default' ? (
        <div className={styles.notice}>
          <p>{t.reminders.permissionPrompt}</p>
          <Button size="sm" variant="primary" icon="bell" onClick={async () => setPerm(await notifier.requestPermission())}>
            {t.reminders.enable}
          </Button>
        </div>
      ) : perm === 'denied' ? (
        <p className={styles.notice}>{t.reminders.permissionDenied}</p>
      ) : perm === 'unsupported' ? (
        <p className={styles.notice}>{t.reminders.unsupported}</p>
      ) : null}

      <div role="tablist" aria-label={t.reminders.title} className={styles.tabs}>
        {ORDER.map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} className={styles.tab} data-bucket={k} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
            {t.reminders[k]}
            <span className={styles.tabCount}>{groups[k].length}</span>
          </button>
        ))}
      </div>

      <div className={panel.scroll} role="tabpanel" style={{ paddingBlockStart: 12 }}>
        {total === 0 ? (
          <p className={panel.muted}>{t.reminders.emptyAll}</p>
        ) : groups[tab].length === 0 ? (
          <p className={panel.muted}>{t.reminders.empty}</p>
        ) : (
          <ul className={panel.list} data-testid="reminder-list">
            {groups[tab].map((item) => (
              <ReminderRow key={item.reminder.id} item={item} bucket={tab} now={now} />
            ))}
          </ul>
        )}
      </div>
      <p className={styles.limitation}>{t.reminders.limitation}</p>
    </section>
  );
}

function ReminderRow({ item, bucket, now }: { item: ReminderItem; bucket: ReminderBucket; now: Date }) {
  const { commands } = useApp();
  const run = useSafeCommand();
  const { reminder: r, node } = item;
  return (
    <li className={styles.item} data-bucket={bucket}>
      <button type="button" className={styles.itemMain} onClick={() => node && useUi.getState().select(node.id, { fly: true })} disabled={!node}>
        <span className={styles.itemTitle}>{node?.title ?? t.reminders.unknownNode}</span>
        <span className={styles.itemMeta}>
          {fmt.dateTime(r.dueAt)}
          {bucket !== 'completed' ? ` — ${fmt.relative(r.dueAt, now)}` : ''}
          {r.repeatRule ? (
            <>
              {' '}
              <Icon name="repeat" size={12} /> {t.repeat[r.repeatRule]}
            </>
          ) : null}
        </span>
        {r.notificationState === 'missed' && bucket === 'overdue' ? <span className={styles.missed}>{t.reminders.missed}</span> : null}
      </button>
      {r.completed ? (
        <IconButton icon="undo" size="sm" label={t.reminders.reopen} onClick={() => run(() => commands.reopenReminder(r.id))} />
      ) : (
        <IconButton icon="check" size="sm" label={t.reminders.complete} onClick={() => run(() => commands.completeReminder(r.id))} data-testid="complete-reminder" />
      )}
    </li>
  );
}
