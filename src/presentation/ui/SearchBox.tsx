import { useDeferredValue, useId, useMemo, useState, type RefObject } from 'react';
import { useSnapshot } from '@/app/providers/AppContext';
import { searchNodes } from '@/application/queries/search';
import { getAncestorIds } from '@/domain/graph/hierarchy';
import { Icon } from '@/design-system/components/Icon';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import styles from './SearchBox.module.css';

export function SearchBox({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const snapshot = useSnapshot();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const hits = useMemo(() => searchNodes(snapshot, deferred, 10), [snapshot, deferred]);
  const listId = useId();

  const choose = (id: string) => {
    useUi.getState().select(id, { fly: true });
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const path = (id: string) =>
    getAncestorIds(snapshot.nodes, id)
      .reverse()
      .map((a) => snapshot.nodes.get(a)?.title)
      .join(' ‹ ');

  const showList = open && query.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <div className={`bevel bevel-sm ${styles.field}`}>
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          role="combobox"
          aria-label={t.toolbar.search}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          placeholder={t.toolbar.search}
          value={query}
          data-testid="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              choose(hits[active].node.id);
            }
          }}
        />
        <span className={styles.hint} aria-hidden="true">
          {t.toolbar.searchShortcut}
        </span>
      </div>
      {showList ? (
        <ul id={listId} role="listbox" aria-label={t.search.resultsLabel} className={`bevel ${styles.list}`}>
          {hits.length === 0 ? <li className={styles.empty}>{t.search.noResults}</li> : null}
          {hits.map((h, i) => {
            const trail = path(h.node.id);
            return (
              <li
                key={h.node.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(h.node.id)}
              >
                <span className={styles.title}>{h.node.title}</span>
                <span className={styles.tag}>{h.field === 'category' ? t.search.inCategory : h.field === 'description' ? t.search.inNotes : !h.node.parentId ? t.search.primary : ''}</span>
                {trail ? <span className={styles.meta}>{trail}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
