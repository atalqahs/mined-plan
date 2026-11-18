import { memo, useMemo, useState } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import type { MindNode, NodeStatus } from '@/domain/entities/types';
import { getAncestorIds, getDescendantIds } from '@/domain/graph/hierarchy';
import { childrenOf, relatedOf } from '@/application/queries/relations';
import { Button, IconButton } from '@/design-system/components/Button';
import { Field } from '@/design-system/components/Field';
import { nodeSwatches } from '@/design-system/tokens/palette';
import { fmt, t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { useDraft } from '@/presentation/hooks/useDraft';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import { useDeleteFlow } from '@/presentation/hooks/useDeleteFlow';
import { NodePicker } from './NodePicker';
import { RemindersSection } from './RemindersSection';
import panel from '../Panel.module.css';
import styles from './Details.module.css';

/** Right-side (RTL start) idea panel. Opens over the workspace, never navigates away. */
export const DetailsPanel = memo(function DetailsPanel() {
  const selectedId = useUi((s) => s.selectedId);
  const open = useUi((s) => s.detailsOpen);
  const snapshot = useSnapshot();
  const node = selectedId ? snapshot.nodes.get(selectedId) : undefined;
  if (!open || !node) return null;
  // Keyed by id: local drafts reset (and flush) when switching ideas.
  return <DetailsBody key={node.id} node={node} />;
});

function DetailsBody({ node }: { node: MindNode }) {
  const { commands } = useApp();
  const snapshot = useSnapshot();
  const run = useSafeCommand();
  const focus = useUi((s) => s.focus);
  const requestDelete = useDeleteFlow();
  const [mode, setMode] = useState<'none' | 'move' | 'link'>('none');

  const title = useDraft(node.title, (v) => {
    if (!v.trim()) return title.reset();
    run(() => commands.updateNode(node.id, { title: v }, { coalesce: true }));
  });
  const notes = useDraft(node.description, (v) => run(() => commands.updateNode(node.id, { description: v }, { coalesce: true })), 800);
  const category = useDraft(node.category, (v) => run(() => commands.updateNode(node.id, { category: v }, { coalesce: true })), 600);

  const ancestors = useMemo(() => getAncestorIds(snapshot.nodes, node.id).reverse(), [snapshot.nodes, node.id]);
  const kids = useMemo(() => childrenOf(snapshot, node.id), [snapshot, node.id]);
  const related = useMemo(() => relatedOf(snapshot, node.id), [snapshot, node.id]);
  const categories = useMemo(() => [...new Set([...snapshot.nodes.values()].map((n) => n.category).filter(Boolean))].slice(0, 30), [snapshot.nodes]);
  const moveExclude = useMemo(() => new Set([node.id, ...getDescendantIds(snapshot.nodes, node.id), ...(node.parentId ? [node.parentId] : [])]), [snapshot.nodes, node.id, node.parentId]);
  const linkExclude = useMemo(() => new Set([node.id, ...related.map((r) => r.other.id)]), [node.id, related]);
  const parent = node.parentId ? snapshot.nodes.get(node.parentId) : undefined;
  const go = (id: string) => useUi.getState().select(id, { fly: true });
  const isFocused = focus.active;

  return (
    <aside className={`bevel ${panel.drawer}`} aria-label={t.details.panelLabel} data-testid="details-panel">
      <div className={panel.head}>
        <div className={panel.headTitle}>
          {ancestors.length ? (
            <nav className={styles.crumbs} aria-label={t.details.parentLabel}>
              {ancestors.map((id, i) => (
                <span key={id}>
                  <button type="button" onClick={() => go(id)}>
                    {snapshot.nodes.get(id)?.title}
                  </button>
                  {i < ancestors.length - 1 ? ' ‹ ' : ''}
                </span>
              ))}
            </nav>
          ) : null}
          <label htmlFor="om-title" className="sr-only">
            {t.details.titleLabel}
          </label>
          <input
            id="om-title"
            className={styles.titleInput}
            value={title.draft}
            maxLength={120}
            onChange={(e) => title.change(e.target.value)}
            onBlur={title.flush}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            data-testid="details-title"
          />
          {isFocused ? <span className={styles.focusBadge}>{t.focus.active} — {focus.level === 1 ? t.focus.direct : t.focus.extended}</span> : null}
        </div>
        <IconButton icon="close" label={t.details.close} size="sm" onClick={() => useUi.getState().closeDetails()} />
      </div>

      <div className={panel.scroll}>
        <section className={panel.section}>
          <div className={panel.actions}>
            <Button size="sm" icon="focus" onClick={() => (isFocused ? useUi.getState().exitFocus() : useUi.getState().enterFocus())} aria-pressed={isFocused}>
              {isFocused ? t.focus.exit : t.details.focusHere}
            </Button>
            <Button size="sm" icon="link" onClick={() => setMode(mode === 'link' ? 'none' : 'link')} aria-expanded={mode === 'link'}>
              {t.details.connect}
            </Button>
            <Button size="sm" icon="plus" onClick={() => useUi.getState().openAdd(node.id)}>
              {t.details.addChild}
            </Button>
          </div>
          <Field label={t.details.notesLabel}>
            <textarea value={notes.draft} placeholder={t.details.notesPlaceholder} onChange={(e) => notes.change(e.target.value)} onBlur={notes.flush} data-testid="details-notes" rows={6} />
          </Field>
        </section>

        <section className={panel.section}>
          <div className={panel.grid2}>
            <Field label={t.details.categoryLabel}>
              <input value={category.draft} list="om-categories" maxLength={40} onChange={(e) => category.change(e.target.value)} onBlur={category.flush} />
            </Field>
            <datalist id="om-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Field label={t.details.statusLabel}>
              <select value={node.status} onChange={(e) => run(() => commands.updateNode(node.id, { status: e.target.value as NodeStatus }))}>
                {(Object.keys(t.status) as NodeStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {t.status[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t.details.deadlineLabel}>
            <input
              type="date"
              value={node.deadline ? toDateInput(node.deadline) : ''}
              onChange={(e) => run(() => commands.updateNode(node.id, { deadline: e.target.value ? fromDateInput(e.target.value) : null }))}
              data-testid="details-deadline"
            />
          </Field>
          <div role="group" aria-label={t.details.colorLabel} style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', fontWeight: 500 }}>{t.details.colorLabel}</span>
            <div className={styles.swatches}>
              <button type="button" className={`${styles.swatch} ${styles.swatchNone}`} aria-pressed={!node.color} aria-label={t.details.defaultColor} title={t.details.defaultColor} onClick={() => run(() => commands.updateNode(node.id, { color: undefined }))} />
              {nodeSwatches.map((c) => (
                <button key={c} type="button" className={styles.swatch} style={{ background: c }} aria-pressed={node.color === c} aria-label={c} onClick={() => run(() => commands.updateNode(node.id, { color: c }))} />
              ))}
            </div>
          </div>
        </section>

        <section className={panel.section} aria-labelledby="om-parent">
          <div className={panel.sectionHead}>
            <h3 id="om-parent">{t.details.parentLabel}</h3>
            <Button size="sm" variant="quiet" icon="move" onClick={() => setMode(mode === 'move' ? 'none' : 'move')} aria-expanded={mode === 'move'}>
              {t.details.move}
            </Button>
          </div>
          {parent ? (
            <ul className={panel.list}>
              <li className={panel.row}>
                <button type="button" className={panel.rowMain} onClick={() => go(parent.id)}>
                  {parent.title}
                </button>
              </li>
            </ul>
          ) : (
            <p className={panel.muted}>{t.details.noParent}</p>
          )}
          {mode === 'move' ? (
            <>
              {node.parentId ? (
                <Button size="sm" onClick={() => (run(() => commands.moveNode(node.id, null)), setMode('none'))}>
                  {t.details.moveToRoot}
                </Button>
              ) : null}
              <NodePicker label={t.details.moveSearch} exclude={moveExclude} onCancel={() => setMode('none')} onPick={(id) => (run(() => commands.moveNode(node.id, id)), setMode('none'))} />
            </>
          ) : null}
        </section>

        <section className={panel.section} aria-labelledby="om-children">
          <div className={panel.sectionHead}>
            <h3 id="om-children">
              {t.details.childrenLabel}
              <span className={panel.count}>{kids.length || ''}</span>
            </h3>
          </div>
          {kids.length ? (
            <ul className={panel.list}>
              {kids.map((k) => (
                <li key={k.id} className={panel.row}>
                  <button type="button" className={panel.rowMain} onClick={() => go(k.id)}>
                    {k.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={panel.muted}>{t.details.noChildren}</p>
          )}
          <InlineChildAdd parentId={node.id} />
        </section>

        <section className={panel.section} aria-labelledby="om-related">
          <div className={panel.sectionHead}>
            <h3 id="om-related">
              {t.details.relatedLabel}
              <span className={panel.count}>{related.length || ''}</span>
            </h3>
          </div>
          {related.length ? (
            <ul className={panel.list} data-testid="related-list">
              {related.map((r) => (
                <li key={r.edge.id} className={panel.row} style={{ borderInlineStartColor: 'var(--c-accent)' }}>
                  <button type="button" className={panel.rowMain} onClick={() => go(r.other.id)}>
                    {r.other.title}
                  </button>
                  <RelationInput edgeId={r.edge.id} value={r.edge.relationType} />
                  <IconButton icon="unlink" size="sm" label={t.details.removeLink} onClick={() => run(() => commands.disconnect(r.edge.id))} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={panel.muted}>{t.details.noRelated}</p>
          )}
          {mode === 'link' ? (
            <>
              <NodePicker label={t.details.connectSearch} exclude={linkExclude} onCancel={() => setMode('none')} onPick={(id) => (run(() => commands.connect(node.id, id)), setMode('none'))} />
              <Button size="sm" variant="quiet" icon="target" onClick={() => (useUi.getState().startLink(node.id), setMode('none'))}>
                {t.details.connectIn3d}
              </Button>
            </>
          ) : null}
        </section>

        <RemindersSection nodeId={node.id} />
      </div>

      <div className={panel.foot}>
        <span>
          {t.details.updated}: {fmt.dateTime(node.updatedAt)}
        </span>
        <Button size="sm" variant="danger" icon="trash" onClick={() => requestDelete(node.id)} data-testid="delete-node">
          {t.details.delete}
        </Button>
      </div>
    </aside>
  );
}

function InlineChildAdd({ parentId }: { parentId: string }) {
  const { commands } = useApp();
  const run = useSafeCommand();
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        if (run(() => commands.createNode({ title: value, parentId }))) setValue('');
      }}
    >
      <Field label={t.details.addChild} hideLabel>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.details.addChildPlaceholder} maxLength={120} data-testid="add-child-input" />
      </Field>
    </form>
  );
}

function RelationInput({ edgeId, value }: { edgeId: string; value: string }) {
  const { commands } = useApp();
  const run = useSafeCommand();
  const draft = useDraft(value, (v) => run(() => commands.updateEdge(edgeId, v)), 900);
  return (
    <input
      className={styles.relationInput}
      value={draft.draft}
      placeholder={t.details.relationPlaceholder}
      aria-label={t.details.relationPlaceholder}
      maxLength={40}
      onChange={(e) => draft.change(e.target.value)}
      onBlur={draft.flush}
    />
  );
}

/** Deadlines are calendar dates; store as local-noon UTC instant to avoid off-by-one across zones. */
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInput(v: string): string {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
