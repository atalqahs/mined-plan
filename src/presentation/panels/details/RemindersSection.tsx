import { useMemo, useState } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import { remindersForNode } from '@/application/queries/reminders';
import type { RepeatRule } from '@/domain/entities/types';
import { classifyReminder } from '@/domain/reminders/schedule';
import { localTimezone } from '@/domain/reminders/zonedTime';
import { Button, IconButton } from '@/design-system/components/Button';
import { Field } from '@/design-system/components/Field';
import { Icon } from '@/design-system/components/Icon';
import { fmt, t } from '@/presentation/i18n/ar';
import { useNow } from '@/presentation/hooks/useNow';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import panel from '../Panel.module.css';
import styles from './Details.module.css';

/** Default suggestion: tomorrow 09:00 local. */
function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RemindersSection({ nodeId }: { nodeId: string }) {
  const { commands } = useApp();
  const snapshot = useSnapshot();
  const run = useSafeCommand();
  const now = useNow(30_000);
  const tz = localTimezone();
  const reminders = useMemo(() => remindersForNode(snapshot, nodeId), [snapshot, nodeId]);
  const [when, setWhen] = useState(defaultWhen);
  const [repeat, setRepeat] = useState<RepeatRule | 'none'>('none');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    // datetime-local is wall-clock in the viewer's zone; Date parses it as local time.
    const date = new Date(when);
    if (!when || Number.isNaN(date.getTime())) return setError(t.details.reminderWhen);
    setError(null);
    run(() => commands.addReminder(nodeId, date.toISOString(), tz, repeat === 'none' ? undefined : repeat));
  };

  return (
    <section className={panel.section} aria-labelledby="om-reminders">
      <div className={panel.sectionHead}>
        <h3 id="om-reminders">
          {t.details.remindersLabel}
          <span className={panel.count}>{reminders.length || ''}</span>
        </h3>
      </div>
      {reminders.length ? (
        <ul className={panel.list} data-testid="node-reminders">
          {reminders.map((r) => {
            const state = classifyReminder(r, now, tz);
            return (
              <li key={r.id} className={styles.reminderRow} data-state={state}>
                <div>
                  <div className={styles.reminderWhen}>{fmt.dateTime(r.dueAt)}</div>
                  <div className={styles.reminderMeta}>
                    <span>{state === 'completed' ? t.reminders.completed : fmt.relative(r.dueAt, now)}</span>
                    {r.repeatRule ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <Icon name="repeat" size={13} />
                        {t.repeat[r.repeatRule]}
                      </span>
                    ) : null}
                    {r.notificationState === 'missed' && !r.completed ? <span style={{ color: 'var(--danger-text)' }}>{t.reminders.missed}</span> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {r.completed ? (
                    <IconButton icon="undo" size="sm" label={t.reminders.reopen} onClick={() => run(() => commands.reopenReminder(r.id))} />
                  ) : (
                    <IconButton icon="check" size="sm" label={t.reminders.complete} onClick={() => run(() => commands.completeReminder(r.id))} />
                  )}
                  <IconButton icon="trash" size="sm" label={t.reminders.remove} onClick={() => run(() => commands.deleteReminder(r.id))} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={panel.muted}>{t.details.noReminders}</p>
      )}
      <div className={styles.addReminder}>
        <Field label={t.details.reminderWhen} error={error}>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="reminder-when" />
        </Field>
        <Field label={t.details.reminderRepeat}>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRule | 'none')}>
            {(Object.keys(t.repeat) as Array<RepeatRule | 'none'>).map((k) => (
              <option key={k} value={k}>
                {t.repeat[k]}
              </option>
            ))}
          </select>
        </Field>
        <Button icon="bell" onClick={add} data-testid="add-reminder">
          {t.details.addReminder}
        </Button>
      </div>
    </section>
  );
}
