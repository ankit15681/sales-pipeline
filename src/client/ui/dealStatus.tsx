import { actions } from '../app/hooks';
import { ME, ownerFirstName } from '../../shared/owners';
import { LOST_REASON_BY_ID, STAGE_BY_ID, stageLabel, type CloseDetails, type Deal } from '../../shared/domain';
import { capitalize, describeEntry } from '../store/describe';
import type { Query } from '../store/query';
import type { Departed, RemoteMark, SyncEntry } from '../store/types';

/** Shared by table rows and board cards so both views tell the same story. */

export const FLASH_MS = 5000;

export const isPending = (e?: SyncEntry) =>
  !!e && (e.status === 'queued' || e.status === 'saving' || e.status === 'retrying' || e.status === 'waiting');

export function SyncStatusText({ id, entry }: { id: string; entry: SyncEntry }) {
  switch (entry.status) {
    case 'queued':
    case 'saving':
      return (
        <span className="st saving">
          <span className="spinner" /> Saving…
        </span>
      );
    case 'retrying':
      return (
        <span className="st retrying" title={entry.error}>
          <span className="spinner" /> Didn't save, retrying ({entry.attempts})…
        </span>
      );
    case 'waiting':
      return <span className="st waiting">Offline · saves when back</span>;
    case 'failed':
      return (
        <span className="st failed" title={`${capitalize(describeEntry(entry))} failed: ${entry.error}`}>
          {entry.rejected ? `Refused: ${entry.error}` : 'Not saved'}
          {!entry.rejected && (
            <button className="linkbtn" onClick={() => actions().retry(id)}>
              Retry
            </button>
          )}
          <button className="linkbtn" onClick={() => actions().discard(id)}>
            Discard
          </button>
        </span>
      );
    case 'conflict':
      return (
        <span className="st conflict">
          {entry.theirs
            ? `${ownerFirstName(entry.theirs.by)} ${entry.theirs.stage ? 'moved it' : 'changed it'} first`
            : 'Changed by a teammate'}
          <button className="linkbtn" onClick={() => actions().openPanel('attention')}>
            Resolve
          </button>
        </span>
      );
  }
}

export function departedReason(deal: Deal, d: Departed, q: Query) {
  const by = ownerFirstName(d.by);
  if (q.tab !== 'focus' && q.tab !== 'open' && deal.stage !== q.tab) return `Moved to ${stageLabel(deal.stage)} by ${by}`;
  if (q.tab === 'open' && !STAGE_BY_ID[deal.stage].open) return `Moved to ${stageLabel(deal.stage)} by ${by}`;
  if ((q.tab === 'focus' && deal.ownerId !== ME.id) || (q.owner !== 'all' && deal.ownerId !== q.owner))
    return `Reassigned to ${ownerFirstName(deal.ownerId)} by ${by}`;
  if (q.tab === 'focus') return `Updated by ${by}; no longer urgent`;
  return `Changed by ${by}; no longer matches`;
}

export function changeText(m: RemoteMark, deal: Deal) {
  const by = ownerFirstName(m.by);
  switch (m.change) {
    case 'stage':
      return `${by} moved it to ${stageLabel(deal.stage)}`;
    case 'value':
      return `${by} updated the value`;
    case 'owner':
      return `${by} reassigned it`;
    case 'closeDate':
      return `${by} changed the close date`;
    case 'activity':
      return `${by} logged activity`;
    case 'created':
      return `${by} added it`;
  }
}

/** Lost reason (with a marker when there's a note) or a Won note. The full text is in the cell's title. */
export function CloseChip({ close }: { close: CloseDetails }) {
  if (close.reason)
    return (
      <span className="chip reason" data-testid="lost-reason">
        <span className="clip">
          {LOST_REASON_BY_ID[close.reason].short}
          {close.note && close.reason !== 'other' ? ' · note' : close.note ? `: ${close.note}` : ''}
        </span>
      </span>
    );
  return close.note ? (
    <span className="chip won-note">
      <span className="clip">{close.note}</span>
    </span>
  ) : null;
}

/** Puts keyboard focus back on whichever view is showing. */
export const focusMain = () =>
  (document.getElementById('deal-grid') ?? document.getElementById('deal-board'))?.focus({ preventScroll: true });
