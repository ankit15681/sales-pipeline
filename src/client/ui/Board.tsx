import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef } from 'react';
import { actions, usePipeline, useStageStats } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount, formatINRShort } from '../lib/format';
import { STAGE_BY_ID, stageLabel, type StageId } from '../../shared/domain';
import { BOARD_STAGES, getBoard } from './boardModel';
import { CARD_GAP, CARD_HEIGHT, DealCard } from './DealCard';
import { useDropTarget } from './drag';
import { STAGE_COLORS } from './visual';

export const BOARD_ID = 'deal-board';
const SLOT = CARD_HEIGHT + CARD_GAP;

const SORT_LABEL: Record<string, string> = {
  priority: 'priority',
  value: 'value',
  company: 'name',
  lastActivity: 'last activity',
  closeDate: 'close date',
  stageAge: 'time in stage',
  owner: 'owner',
  stage: 'stage',
};

// Each column reports what it has on screen; teammates' "hotspot" edits target these.
const visibleByColumn = new Map<StageId, string[]>();
const reportVisible = () => actions().setVisibleIds([...visibleByColumn.values()].flat());

/**
 * Board = the same stable, filtered, sorted list as the table, grouped by stage.
 * Five virtualized columns (~8 cards each in the DOM, whatever the column size).
 */
export function BoardView() {
  const ids = usePipeline((s) => s.view.ids);
  const held = usePipeline((s) => s.view.heldStage);
  const pending = usePipeline((s) => s.view.pendingNew);
  const departed = usePipeline((s) => s.view.departed);
  const dataRev = usePipeline((s) => s.dataRev);
  const focusId = usePipeline((s) => s.focusId);
  const tab = usePipeline((s) => s.view.query.tab);
  const sortKey = usePipeline((s) => s.view.query.sort.key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const board = useMemo(() => getBoard(pipeline.getState()), [ids, held, pending, departed, dataRev]);
  const total = BOARD_STAGES.reduce((n, s) => n + board.value[s], 0) || 1;

  useEffect(() => {
    document.getElementById(BOARD_ID)?.focus({ preventScroll: true });
    return () => {
      visibleByColumn.clear();
    };
  }, []);

  return (
    <div className="board-wrap">
      <div
        id={BOARD_ID}
        className="board"
        role="application"
        aria-roledescription="board"
        aria-label={tab === 'focus' ? 'My focus board' : 'Pipeline board'}
        tabIndex={0}
        aria-activedescendant={focusId ? `card-${focusId}` : undefined}
        data-page-size={6}
      >
        {BOARD_STAGES.map((st) => (
          <BoardColumn
            key={st}
            stage={st}
            ids={board.columns[st]}
            count={board.count[st]}
            value={board.value[st]}
            arriving={board.arriving[st]}
            share={board.value[st] / total}
            sortLabel={SORT_LABEL[sortKey]}
          />
        ))}
      </div>
      <ClosingZones />
    </div>
  );
}

const BoardColumn = memo(function BoardColumn(props: {
  stage: StageId;
  ids: string[];
  count: number;
  value: number;
  arriving: number;
  share: number;
  sortLabel: string;
}) {
  const { stage, ids, count, value, arriving, share, sortLabel } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const label = stageLabel(stage);
  const colors = STAGE_COLORS[stage];

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SLOT,
    overscan: 4,
    paddingStart: CARD_GAP,
    paddingEnd: CARD_GAP,
    getItemKey: (i) => ids[i],
  });

  const focusId = usePipeline((s) => s.focusId);
  const focusIdx = useMemo(() => (focusId ? ids.indexOf(focusId) : -1), [focusId, ids]);
  useEffect(() => {
    if (focusIdx >= 0) virtualizer.scrollToIndex(focusIdx, { align: 'auto' });
  }, [focusIdx, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    visibleByColumn.set(stage, ids.slice(first, last + 1));
    reportVisible();
  }, [ids, first, last, stage]);

  const { over, active, already } = useDropTarget(stage);

  const selectColumn = () => {
    const s = pipeline.getState();
    const real = ids.filter((id) => s.display.get(id)?.stage === stage && !s.view.departed.has(id));
    const allIn = real.length > 0 && real.every((id) => s.selection.has(id));
    const sel = new Set(s.selection);
    for (const id of real) {
      if (allIn) sel.delete(id);
      else sel.add(id);
    }
    s.setSelection(sel);
  };

  const openInTable = () => {
    actions().setLayout('table');
    actions().setTab(stage);
  };

  const cls = ['col', active && !already && 'drop-armed', over && !already && 'drop-over'].filter(Boolean).join(' ');

  return (
    <section className={cls} data-drop-stage={stage} data-testid={`column-${stage}`}>
      <header className="colhead">
        <div className="t">
          <span className="sq" style={{ background: colors.dot }} />
          {label}
          <span className="spacer" />
          <button className="btn small ghost" onClick={selectColumn} title={`Select every deal in ${label}`} tabIndex={-1}>
            Select all
          </button>
        </div>
        <div className="meta">
          <span>{formatCount(count)} deals</span>
          <span>{formatINRShort(value)}</span>
        </div>
        <div className="vbar">
          <i style={{ width: `${Math.max(2, share * 100)}%`, background: colors.dot }} />
        </div>
        {arriving > 0 && (
          <button className="newpill" onClick={() => actions().refreshView()} tabIndex={-1}>
            +{formatCount(arriving)} from teammates · Refresh <kbd>U</kbd>
          </button>
        )}
      </header>
      {over && <div className="droptip">{already ? `Already in ${label}` : `Drop to move to ${label}`}</div>}
      <div className="cards" ref={scrollRef} role="listbox" aria-label={`${label}, ${count} deals`} aria-multiselectable="true">
        {ids.length === 0 ? (
          <div className="col-empty">No deals here</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((it) => (
              <DealCard key={it.key} id={ids[it.index]} column={stage} top={it.start} />
            ))}
          </div>
        )}
      </div>
      <footer className="colfoot">
        <span>By {sortLabel}</span>
        <button className="linkbtn" onClick={openInTable} tabIndex={-1}>
          Open in table ↗
        </button>
      </footer>
    </section>
  );
});

/** Won and Lost are where deals end up, not lists to browse, so they are drop zones. */
function ClosingZones() {
  const stats = useStageStats();
  return (
    <div className="closezones">
      {(['won', 'lost'] as const).map((st) => (
        <ClosingZone key={st} stage={st} count={stats.count[st]} value={stats.value[st]} />
      ))}
    </div>
  );
}

function ClosingZone({ stage, count, value }: { stage: 'won' | 'lost'; count: number; value: number }) {
  const { over, active } = useDropTarget(stage);
  const s = STAGE_BY_ID[stage];
  return (
    <div
      className={`closezone ${stage} ${active ? 'armed' : ''} ${over ? 'over' : ''}`}
      data-drop-stage={stage}
      data-testid={`zone-${stage}`}
    >
      <strong>
        {stage === 'won' ? '✓' : '✕'} {active ? `Drop to mark ${s.label}` : s.label}
      </strong>
      <span className="muted">
        {formatCount(count)} · {formatINRShort(value)} · or press <kbd>{s.key}</kbd>
      </span>
      <button
        className="linkbtn"
        tabIndex={-1}
        onClick={() => {
          actions().setLayout('table');
          actions().setTab(stage);
        }}
      >
        View in table ↗
      </button>
    </div>
  );
}
