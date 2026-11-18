import { memo, useMemo } from 'react';
import { useApp, useSnapshot } from '@/app/providers/AppContext';
import { buildAdjacency, getNeighborhood } from '@/domain/graph/neighborhood';
import { buildSampleSnapshot } from '@/app/bootstrap/sampleData';
import { Button, IconButton } from '@/design-system/components/Button';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { BrandMark } from './BrandMark';
import styles from './Overlays.module.css';

/** Focus-mode status strip: what is in focus and how far it reaches. */
export const FocusBanner = memo(function FocusBanner() {
  const focus = useUi((s) => s.focus);
  const selectedId = useUi((s) => s.selectedId);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const snapshot = useSnapshot();
  const count = useMemo(() => {
    if (!focus.active || !selectedId) return 0;
    return getNeighborhood(buildAdjacency(snapshot), selectedId, focus.level).distance.size - 1;
  }, [focus, selectedId, snapshot]);
  if (!focus.active || !selectedId) return null;
  const title = snapshot.nodes.get(selectedId)?.title ?? '';
  return (
    <div className={`bevel bevel-sm ${styles.banner} ${detailsOpen ? styles.withPanel : ''}`} role="status" data-testid="focus-banner" data-level={focus.level}>
      <span>
        {t.focus.active}: «{title}» — {focus.level === 1 ? t.focus.direct : t.focus.extended}، {t.focus.related(count)}
      </span>
      <IconButton icon="close" size="sm" label={t.focus.exit} shortcut="Esc" onClick={() => useUi.getState().exitFocus()} />
    </div>
  );
});

export const LinkBanner = memo(function LinkBanner() {
  const linkFromId = useUi((s) => s.linkFromId);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const snapshot = useSnapshot();
  if (!linkFromId) return null;
  return (
    <div className={`bevel bevel-sm ${styles.banner} ${detailsOpen ? styles.withPanel : ''}`} role="status" data-testid="link-banner">
      <span>{t.linkMode.banner(snapshot.nodes.get(linkFromId)?.title ?? '')}</span>
      <Button size="sm" variant="quiet" onClick={() => useUi.getState().cancelLink()}>
        {t.linkMode.cancel}
      </Button>
    </div>
  );
});

export const EmptyState = memo(function EmptyState() {
  const { commands } = useApp();
  const empty = useSnapshot().nodes.size === 0;
  if (!empty) return null;
  return (
    <div className={styles.empty} data-testid="empty-state">
      <BrandMark size={40} className="" />
      <h2>{t.empty.headline}</h2>
      <p>{t.empty.body}</p>
      <div className={styles.emptyActions}>
        <Button variant="primary" icon="plus" onClick={() => useUi.getState().openAdd(null)}>
          {t.empty.add}
        </Button>
        <Button icon="orbit" onClick={() => commands.replaceAll(buildSampleSnapshot(), 'seed')} data-testid="load-sample">
          {t.empty.sample}
        </Button>
      </div>
    </div>
  );
});
