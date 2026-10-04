import { memo, useMemo, type PointerEvent, type ReactNode } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatINR } from '../lib/format';
import { OWNER_BY_ID, ownerFirstName } from '../../shared/owners';
import { signalsFor } from '../lib/priority';
import { stageLabel, type StageId } from '../../shared/domain';
import { getBoard } from './boardModel';
import { changeText, departedReason, FLASH_MS, focusMain, isPending, SyncStatusText } from './dealStatus';
import { trackDrag } from './drag';
import { avatarColor } from './visual';

export const CARD_HEIGHT = 82;
export const CARD_GAP = 8;

/** One deal on the board. Same states as a table row: saving, retrying, failed, conflict, greyed, flashed. */
export const DealCard = memo(function DealCard({ id, column, top }: { id: string; column: StageId; top: number }) {
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
  // A teammate moved it to another stage: it stays here, greyed, until refresh.
  const movedAway = deal.stage !== column;
  const ghost = movedAway || !!departed;
  const owner = OWNER_BY_ID[deal.ownerId];
  const status = entry?.status;

  const cls = [
    'card',
    selected && 'selected',
    focused && 'focused',
    ghost && 'ghost',
    status === 'failed' && 'failed',
    status === 'conflict' && 'conflict',
    isPending(entry) && 'pending',
    recent && !ghost && 'flash',
  ]
    .filter(Boolean)
    .join(' ');

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    const a = actions();
    if (e.shiftKey) {
      e.preventDefault();
      selectColumnRange(id, column);
    } else if (e.metaKey || e.ctrlKey) {
      a.toggleSelect(id);
      a.setFocus(id);
    } else {
      a.setFocus(id);
    }
    focusMain();
    trackDrag(e, id);
  };

  let line2: ReactNode = `${formatINR(deal.value)} · ${deal.licences} licences`;
  if (movedAway)
    line2 = (
      <em>
        Moved to {stageLabel(deal.stage)} by {ownerFirstName(deal.updatedBy)}
      </em>
    );
  else if (departed) line2 = <em>{departedReason(deal, departed, query)}</em>;

  return (
    <div
      id={`card-${id}`}
      role="option"
      aria-selected={selected}
      className={cls}
      style={{ transform: `translateY(${top}px)`, height: CARD_HEIGHT }}
      onPointerDown={onPointerDown}
      data-testid="deal-card"
      data-deal-id={id}
      data-stage={deal.stage}
      data-sync={status ?? 'saved'}
      key={recent ? `${id}-${recent.at}` : id}
    >
      <div className="c1">
        <input
          type="checkbox"
          tabIndex={-1}
          checked={selected}
          aria-label={`Select ${deal.company}`}
          onChange={() => {}}
          onClick={(e) => {
            if (e.shiftKey) selectColumnRange(id, column);
            else actions().toggleSelect(id);
            actions().setFocus(id);
            focusMain();
          }}
        />
        <span className="company" title={deal.company}>
          {deal.company}
        </span>
        <span className="avatar" style={{ background: avatarColor(deal.ownerId) }} title={owner?.name}>
          {owner?.initials}
        </span>
      </div>
      <div className="c2">{line2}</div>
      <div className="c3">
        {entry ? (
          <SyncStatusText id={id} entry={entry} />
        ) : recent && !ghost ? (
          <span className="st remote" key={recent.at}>
            {changeText(recent, deal)}
          </span>
        ) : (
          <>
            {signals.slice(0, 1).map((s) => (
              <span key={s.kind} className={`chip ${s.kind}`}>
                {s.label}
              </span>
            ))}
            {signals.length > 1 && <span className="chip">+{signals.length - 1}</span>}
          </>
        )}
      </div>
    </div>
  );
});

/** Shift-click on the board selects a run of cards within one column. */
function selectColumnRange(id: string, column: StageId) {
  const s = pipeline.getState();
  const list = getBoard(s).columns[column];
  const anchor = s.anchorId ?? s.focusId;
  const a = anchor ? list.indexOf(anchor) : -1;
  const b = list.indexOf(id);
  const sel = new Set(s.selection);
  if (a === -1 || b === -1) sel.add(id);
  else for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(list[i]);
  s.setSelection(sel);
  s.setFocus(id);
}
