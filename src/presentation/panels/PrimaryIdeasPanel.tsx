import { memo, useMemo, useState } from 'react';
import { useSnapshot } from '@/app/providers/AppContext';
import type { MindNode } from '@/domain/entities/types';
import { buildChildIndex, getAncestorIds } from '@/domain/graph/hierarchy';
import { IconButton } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import panel from './Panel.module.css';
import styles from './PrimaryIdeasPanel.module.css';

/**
 * Structured navigation aid: top-level ideas only, each expandable to reveal its
 * branch. Selecting an entry flies the 3D camera to it (or re-frames Focus Mode).
 * It complements the orbital scene; it does not replace it.
 */
export const PrimaryIdeasPanel = memo(function PrimaryIdeasPanel() {
  const open = useUi((s) => s.panel === 'primaries');
  return open ? <PrimaryIdeasBody /> : null;
});

function PrimaryIdeasBody() {
  const snapshot = useSnapshot();
  const selectedId = useUi((s) => s.selectedId);
  const childIndex = useMemo(() => buildChildIndex(snapshot.nodes), [snapshot.nodes]);
  const primaries = childIndex.get(null) ?? [];
  // Open the branch that contains the current selection, so the user sees where they are.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedId ? getAncestorIds(snapshot.nodes, selectedId) : []));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav className={`bevel ${panel.popover} ${styles.pop}`} aria-label={t.primaries.title} data-testid="primaries-panel">
      <div className={panel.head}>
        <div className={panel.headTitle}>
          <h2>{t.primaries.title}</h2>
          <p className={styles.hint}>{t.primaries.hint}</p>
        </div>
        <IconButton icon="close" size="sm" label={t.primaries.close} onClick={() => useUi.getState().setPanel('none')} />
      </div>
      <div className={panel.scroll}>
        {primaries.length === 0 ? (
          <p className={panel.muted}>{t.primaries.empty}</p>
        ) : (
          <ul className={styles.tree} role="list">
            {primaries.map((id) => (
              <Branch key={id} node={snapshot.nodes.get(id)!} depth={0} childIndex={childIndex} nodes={snapshot.nodes} expanded={expanded} onToggle={toggle} selectedId={selectedId} />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

interface BranchProps {
  node: MindNode;
  depth: number;
  childIndex: Map<string | null, string[]>;
  nodes: ReadonlyMap<string, MindNode>;
  expanded: Set<string>;
  onToggle(id: string): void;
  selectedId: string | null;
}

function Branch({ node, depth, childIndex, nodes, expanded, onToggle, selectedId }: BranchProps) {
  const kids = childIndex.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  const listId = `om-branch-${node.id}`;
  return (
    <li className={styles.item} data-depth={depth}>
      <div className={styles.row} data-selected={node.id === selectedId || undefined}>
        {kids.length ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-label={isOpen ? t.primaries.collapse(node.title) : t.primaries.expand(node.title)}
            onClick={() => onToggle(node.id)}
            data-testid="branch-toggle"
          >
            <Icon name="chevron" size={15} className={isOpen ? styles.chevOpen : styles.chev} />
          </button>
        ) : (
          <span className={styles.toggleSpacer} aria-hidden="true" />
        )}
        <button
          type="button"
          className={depth === 0 ? styles.primary : styles.child}
          aria-current={node.id === selectedId ? 'true' : undefined}
          onClick={() => useUi.getState().select(node.id, { fly: true })}
          data-testid={depth === 0 ? 'primary-item' : 'child-item'}
        >
          <span className={styles.title}>{node.title}</span>
          {kids.length ? <span className={styles.count}>{t.primaries.childCount(kids.length)}</span> : null}
        </button>
      </div>
      {kids.length && isOpen ? (
        <ul id={listId} className={styles.children} role="list">
          {kids.map((id) => (
            <Branch key={id} node={nodes.get(id)!} depth={depth + 1} childIndex={childIndex} nodes={nodes} expanded={expanded} onToggle={onToggle} selectedId={selectedId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
