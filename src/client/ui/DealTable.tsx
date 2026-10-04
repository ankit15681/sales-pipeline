import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { actions, usePipeline } from '../app/hooks';
import type { SortKey } from '../store/query';
import { DealRow, ROW_HEIGHT } from './DealRow';

export const GRID_ID = 'deal-grid';

const COLUMNS: { label: string; sort?: SortKey; num?: boolean; title?: string }[] = [
  { label: '' },
  { label: 'Deal', sort: 'company' },
  { label: 'Value', sort: 'value', num: true },
  { label: 'Licences', num: true },
  { label: 'Owner', sort: 'owner' },
  { label: 'Stage', sort: 'stage' },
  { label: 'Last activity', sort: 'lastActivity' },
  { label: 'Close', sort: 'closeDate' },
  { label: 'Why now', sort: 'priority', title: 'Sorted by priority: overdue, closing soon, idle, stuck, high value' },
  { label: 'Status' },
];

/**
 * One virtualized list instead of a 7-column board: only ~30 rows exist in the
 * DOM whether the view holds 30 or 12,000 deals.
 */
export function DealTable() {
  const ids = usePipeline((s) => s.view.ids);
  const focusId = usePipeline((s) => s.focusId);
  const focusIndex = usePipeline((s) => (s.focusId ? (s.view.index.get(s.focusId) ?? -1) : -1));
  const sort = usePipeline((s) => s.view.query.sort);
  const tab = usePipeline((s) => s.view.query.tab);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => ids[i],
  });

  useEffect(() => {
    if (focusIndex >= 0) virtualizer.scrollToIndex(focusIndex, { align: 'auto' });
  }, [focusIndex, virtualizer]);

  // New view → back to the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    actions().setVisibleIds(ids.slice(first, last + 1));
  }, [ids, first, last]);

  useEffect(() => {
    document.getElementById(GRID_ID)?.focus({ preventScroll: true });
  }, []);

  const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 1);

  return (
    <div
      id={GRID_ID}
      className="table-wrap"
      role="grid"
      tabIndex={0}
      aria-label="Deals"
      aria-rowcount={ids.length + 1}
      aria-multiselectable="true"
      aria-activedescendant={focusId ? `row-${focusId}` : undefined}
      data-page-size={pageSize}
    >
      <div className="thead grid-cols" role="row" aria-rowindex={1}>
        {COLUMNS.map((c, i) => {
          const active = c.sort && sort.key === c.sort;
          const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
          if (!c.sort)
            return (
              <div key={i} role="columnheader" className={`th ${c.num ? 'num' : ''}`}>
                {c.label}
              </div>
            );
          return (
            <div key={i} role="columnheader" aria-sort={ariaSort} style={{ height: '100%' }}>
              <button
                className={`th ${c.num ? 'num' : ''}`}
                style={{ width: '100%' }}
                title={c.title ?? `Sort by ${c.label.toLowerCase()}`}
                tabIndex={-1}
                onClick={() => actions().toggleSort(c.sort!)}
              >
                {c.sort === 'priority' && tab === 'lost'
                  ? 'Lost reason'
                  : c.sort === 'priority' && tab === 'won'
                    ? 'Win note'
                    : c.label}
                {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            </div>
          );
        })}
      </div>
      <div className="scroller" ref={scrollRef}>
        {ids.length === 0 ? (
          <div className="empty">{tab === 'focus' ? 'Nothing urgent on your plate. Nice.' : 'No deals match these filters.'}</div>
        ) : (
          <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => (
              <DealRow key={item.key} id={ids[item.index]} index={item.index} top={item.start} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
