import { memo, useMemo, type MouseEvent } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { formatDate, formatINR, relativeDays } from '../lib/format';
import { OWNER_BY_ID, ME } from '../../shared/owners';
import { signalsFor } from '../lib/priority';
import { STAGE_BY_ID, stageLabel, type Deal } from '../../shared/domain';
import type { Query } from '../store/query';
import type { Departed, RemoteMark, SyncEntry } from '../store/types';
import { closeText } from '../store/describe';
import { changeText, CloseChip, departedReason, FLASH_MS, focusMain, isPending, SyncStatusText } from './dealStatus';
import { trackDrag } from './drag';
import { avatarColor, STAGE_COLORS } from './visual';

export const ROW_HEIGHT = 40;
const focusGrid = focusMain;

export const DealRow = memo(function DealRow({ id, index, top }: { id: string; index: number; top: number }) {
  const deal = usePipeline((s) => s.display.get(id));
  const entry = usePipeline((s) => s.entries.get(id));
  const mark = usePipeline((s) => s.remoteMarks.get(id));
  const departed = usePipeline((s) => s.view.departed.get(id));
  const selected = usePipeline((s) => s.selection.has(id));
  const focused = usePipeline((s) => s.focusId === id);
  const query = usePipeline((s) => s.view.query);
  const signals = useMemo(() => (deal ? signalsFor(deal, Date.now()) : []), [deal]);

  if (!deal) return null;
  const now = Date.now();
  const recent = mark && now - mark.at < FLASH_MS ? mark : undefined;
  const status = entry?.status;
  const pending = isPending(entry);
  const owner = OWNER_BY_ID[deal.ownerId];
  const overdue = STAGE_BY_ID[deal.stage].open && deal.closeDate < now;
  const colors = STAGE_COLORS[deal.stage];

  const cls = [
    'row',
    'grid-cols',
    selected && 'selected',
    focused && 'focused',
    departed && 'departed',
    status === 'failed' && 'failed',
    status === 'conflict' && 'conflict',
    pending && 'pending',
    recent && !departed && 'flash',
  ]
    .filter(Boolean)
    .join(' ');

  const onRowMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (e.shiftKey) {
      e.preventDefault();
      actions().selectRange(id);
    } else if (e.metaKey || e.ctrlKey) {
      actions().toggleSelect(id);
      actions().setFocus(id);
    } else {
      actions().setFocus(id);
    }
    focusGrid();
  };

  const openMoveMenu = () => {
    const a = actions();
    if (!a.selection.has(id)) a.clearSelection();
    a.setFocus(id);
    a.openPanel('moveMenu');
  };

  return (
    <div
      id={`row-${id}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={cls}
      style={{ transform: `translateY(${top}px)` }}
      onMouseDown={onRowMouseDown}
      onPointerDown={(e) => trackDrag(e, id)}
      data-testid="deal-row"
      data-deal-id={id}
      data-stage={deal.stage}
      data-sync={status ?? 'saved'}
      key={recent ? `${id}-${recent.at}` : id}
    >
      <div role="gridcell" className="td check">
        <input
          type="checkbox"
          tabIndex={-1}
          checked={selected}
          aria-label={`Select ${deal.company}`}
          onChange={() => {}}
          onClick={(e) => {
            if (e.shiftKey) actions().selectRange(id);
            else actions().toggleSelect(id);
            actions().setFocus(id);
            focusGrid();
          }}
        />
      </div>
      <div role="gridcell" className="td" title={deal.company}>
        <span className="company">{deal.company}</span>
        <span className="ref">{deal.ref}</span>
      </div>
      <div role="gridcell" className="td num">
        {formatINR(deal.value)}
      </div>
      <div role="gridcell" className="td num muted">
        {deal.licences}
      </div>
      <div role="gridcell" className="td">
        <span className="avatar" style={{ background: avatarColor(deal.ownerId) }} aria-hidden>
          {owner?.initials}
        </span>
        <span className={deal.ownerId === ME.id ? '' : 'muted'}>{deal.ownerId === ME.id ? 'You' : owner?.name}</span>
      </div>
      <div role="gridcell" className="td">
        <button
          className="stage-badge"
          style={{ background: colors.bg, color: colors.fg }}
          tabIndex={-1}
          onClick={openMoveMenu}
          title="Change stage (M)"
        >
          {stageLabel(deal.stage)} ▾
        </button>
      </div>
      <div role="gridcell" className="td muted">
        {relativeDays(deal.lastActivityAt, now)}
      </div>
      <div role="gridcell" className={`td ${overdue ? 'overdue' : 'muted'}`}>
        {formatDate(deal.closeDate, now)}
      </div>
      {deal.close ? (
        <div role="gridcell" className="td" title={closeText(deal.close)}>
          <CloseChip close={deal.close} />
        </div>
      ) : (
        <div role="gridcell" className="td" title={signals.map((s) => s.label).join(' · ')}>
          {signals.slice(0, 1).map((s) => (
            <span key={s.kind} className={`chip ${s.kind}`}>
              {s.label}
            </span>
          ))}
          {signals.length > 1 && <span className="chip">+{signals.length - 1}</span>}
        </div>
      )}
      <div role="gridcell" className="td status">
        <RowStatus id={id} deal={deal} entry={entry} departed={departed} recent={recent} query={query} />
      </div>
    </div>
  );
});

function RowStatus({
  id,
  deal,
  entry,
  departed,
  recent,
  query,
}: {
  id: string;
  deal: Deal;
  entry?: SyncEntry;
  departed?: Departed;
  recent?: RemoteMark;
  query: Query;
}) {
  if (entry) return <SyncStatusText id={id} entry={entry} />;
  if (departed) return <span className="st departed">{departedReason(deal, departed, query)}</span>;
  if (recent)
    return (
      <span className="st remote" key={recent.at}>
        {changeText(recent, deal)}
      </span>
    );
  return null;
}
