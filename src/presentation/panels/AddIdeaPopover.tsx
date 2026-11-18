import { memo, useState } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import { Button, IconButton } from '@/design-system/components/Button';
import { Field } from '@/design-system/components/Field';
import { t } from '@/presentation/i18n/ar';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import { useUi } from '@/presentation/state/uiStore';
import panel from './Panel.module.css';
import styles from './AddIdeaPopover.module.css';

export const AddIdeaPopover = memo(function AddIdeaPopover() {
  const open = useUi((s) => s.addOpen);
  const parentId = useUi((s) => s.addParentId);
  return open ? <AddBody key={parentId ?? 'root'} initialParent={parentId} /> : null;
});

function AddBody({ initialParent }: { initialParent: string | null }) {
  const { commands } = useApp();
  const snapshot = useSnapshot();
  const run = useSafeCommand();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [parent, setParent] = useState<string>(initialParent && snapshot.nodes.has(initialParent) ? initialParent : '');
  const [error, setError] = useState<string | null>(null);
  const parentNode = parent ? snapshot.nodes.get(parent) : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('اكتب عنوانًا للفكرة.');
    const node = run(() => commands.createNode({ title, parentId: parent || null, category: category || undefined }));
    if (!node) return;
    const ui = useUi.getState();
    ui.closeAdd();
    ui.select(node.id, { fly: true });
    ui.toast({ message: t.toasts.created, tone: 'success', duration: 2000 });
  };

  return (
    <form className={`bevel ${panel.popover} ${styles.pop}`} aria-label={t.add.title} onSubmit={submit} data-testid="add-popover">
      <div className={panel.head}>
        <div className={panel.headTitle}>
          <h2>{t.add.title}</h2>
        </div>
        <IconButton icon="close" size="sm" label={t.add.cancel} onClick={() => useUi.getState().closeAdd()} />
      </div>
      <div className={styles.body}>
        <Field label={t.add.nameLabel} error={error}>
          <input autoFocus value={title} maxLength={120} placeholder={t.add.namePlaceholder} onChange={(e) => (setTitle(e.target.value), setError(null))} data-testid="add-title" />
        </Field>
        <Field label={t.add.parentLabel}>
          <select value={parent} onChange={(e) => setParent(e.target.value)} data-testid="add-parent">
            <option value="">{t.add.asPrimary}</option>
            {parentNode ? <option value={parentNode.id}>{t.add.under(parentNode.title)}</option> : null}
            {[...snapshot.nodes.values()]
              .filter((n) => n.id !== parent)
              .sort((a, b) => a.title.localeCompare(b.title, 'ar'))
              .slice(0, 300)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {t.add.under(n.title)}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t.add.categoryLabel}>
          <input value={category} maxLength={40} placeholder={parentNode?.category || t.add.categoryPlaceholder} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <div className={styles.actions}>
          <Button variant="primary" type="submit" icon="plus" data-testid="add-submit">
            {t.add.submit}
          </Button>
          <Button variant="quiet" onClick={() => useUi.getState().closeAdd()}>
            {t.add.cancel}
          </Button>
        </div>
      </div>
    </form>
  );
}
