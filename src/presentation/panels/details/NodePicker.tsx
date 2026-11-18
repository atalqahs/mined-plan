import { useMemo, useState } from 'react';
import { useSnapshot } from '@/app/providers/AppContext';
import { searchNodes } from '@/application/queries/search';
import { Field } from '@/design-system/components/Field';
import panel from '../Panel.module.css';

interface Props {
  label: string;
  exclude: ReadonlySet<string>;
  onPick(id: string): void;
  onCancel(): void;
}

/** Inline searchable list for choosing another idea (move target, link target). */
export function NodePicker({ label, exclude, onPick, onCancel }: Props) {
  const snapshot = useSnapshot();
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const list = q.trim()
      ? searchNodes(snapshot, q, 30).map((h) => h.node)
      : [...snapshot.nodes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
    return list.filter((n) => !exclude.has(n.id)).slice(0, 8);
  }, [snapshot, q, exclude]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Field label={label} hideLabel>
        <input
          autoFocus
          type="search"
          placeholder={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
            }
            if (e.key === 'Enter' && options[0]) onPick(options[0].id);
          }}
        />
      </Field>
      <ul className={panel.list}>
        {options.map((n) => (
          <li key={n.id} className={panel.row}>
            <button type="button" className={panel.rowMain} onClick={() => onPick(n.id)}>
              {n.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
