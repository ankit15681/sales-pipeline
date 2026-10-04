import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount, formatDate } from '../lib/format';
import { ME, OWNER_BY_ID, OWNERS } from '../../shared/owners';
import { editSpecText, endOfNextQuarter } from '../store/describe';
import type { CloseDateChange, EditSpec } from '../store/types';
import { focusGrid } from './MoveMenu';

type DateMode = 'keep' | 'set' | 'shift' | 'quarterEnd';

const toInputDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Local noon on that day, so time zones and DST never shift the date shown. */
const fromInputDate = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d, 12).getTime() : NaN;
};

/**
 * Change owner and/or close date on the selection (or the focused deal).
 * Fields left on "Keep" are not sent at all, so they can't clash with anyone.
 */
export function EditDialog() {
  const editing = usePipeline((s) => s.editing);
  const [ownerId, setOwnerId] = useState('');
  const [mode, setMode] = useState<DateMode>('keep');
  const [date, setDate] = useState('');
  const [days, setDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const ownerRef = useRef<HTMLSelectElement>(null);

  useEffect(() => ownerRef.current?.focus(), []);

  // What the picked deals have now: one value, or a summary for many.
  const current = useMemo(() => {
    const display = pipeline.getState().display;
    const owners = new Set<string>();
    let min = Infinity;
    let max = -Infinity;
    for (const id of editing?.ids ?? []) {
      const d = display.get(id);
      if (!d) continue;
      owners.add(d.ownerId);
      min = Math.min(min, d.closeDate);
      max = Math.max(max, d.closeDate);
    }
    return { owners, min, max };
  }, [editing]);

  if (!editing) return null;
  const n = editing.ids.length;
  const single = n === 1 ? pipeline.getState().display.get(editing.ids[0]) : undefined;
  const now = Date.now();

  const closeDate = (): CloseDateChange | undefined | 'invalid' => {
    if (mode === 'keep') return undefined;
    if (mode === 'quarterEnd') return { mode };
    if (mode === 'set') {
      const at = fromInputDate(date);
      return Number.isFinite(at) ? { mode, at } : 'invalid';
    }
    const d = Math.round(Number(days));
    return Number.isFinite(d) && d !== 0 && Math.abs(d) <= 365 ? { mode, days: d } : 'invalid';
  };
  const cd = closeDate();
  const spec: EditSpec | null = cd === 'invalid' ? null : { ...(ownerId ? { ownerId } : {}), ...(cd ? { closeDate: cd } : {}) };
  const summary = spec ? editSpecText(spec, now) : '';

  const cancel = () => {
    actions().cancelEdit();
    focusGrid();
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!spec) {
      setError(mode === 'set' ? 'Pick a date' : 'Enter a number of days between −365 and 365, not 0');
      return;
    }
    if (!summary) {
      setError('Choose an owner or a close date change');
      ownerRef.current?.focus();
      return;
    }
    actions().applyEdit(spec);
    focusGrid();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      submit();
    }
  };

  const ownerNow =
    current.owners.size === 1
      ? OWNER_BY_ID[[...current.owners][0]]?.name
      : `${formatCount(current.owners.size)} different owners`;
  const dateNow =
    current.min === current.max || single
      ? formatDate(current.min, now)
      : `${formatDate(current.min, now)} – ${formatDate(current.max, now)}`;

  return (
    <div className="backdrop" onMouseDown={cancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        data-keyscope="local"
        data-testid="edit-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={submit}
      >
        <div className="body">
          <h2 id="edit-title">{single ? `Edit ${single.company}` : `Edit ${formatCount(n)} deals`}</h2>
          <p>Only the fields you change are saved. Everything else stays as it is.</p>

          <div className="edit-grid">
            <label htmlFor="edit-owner">Owner</label>
            <div>
              <select
                id="edit-owner"
                ref={ownerRef}
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Keep as is</option>
                {OWNERS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id === ME.id ? `You (${o.name})` : o.name}
                  </option>
                ))}
              </select>
              <div className="muted small">Now: {ownerNow}</div>
            </div>

            <label htmlFor="edit-close">Close date</label>
            <div>
              <div className="row-inline">
                <select
                  id="edit-close"
                  value={mode}
                  onChange={(e) => {
                    const m = e.target.value as DateMode;
                    setMode(m);
                    setError(null);
                    if (m === 'set' && !date) setDate(toInputDate(single ? single.closeDate : now));
                  }}
                >
                  <option value="keep">Keep as is</option>
                  <option value="shift">{single ? 'Move by…' : 'Move each by…'}</option>
                  <option value="set">{single ? 'Set to…' : 'Set all to…'}</option>
                  <option value="quarterEnd">End of next quarter ({formatDate(endOfNextQuarter(now), now)})</option>
                </select>
                {mode === 'shift' && (
                  <label className="inline">
                    <input
                      type="number"
                      aria-label="Days to move each close date (negative for earlier)"
                      value={days}
                      min={-365}
                      max={365}
                      step={1}
                      onChange={(e) => setDays(e.target.value)}
                    />
                    days
                  </label>
                )}
                {mode === 'set' && (
                  <input type="date" aria-label="New close date" value={date} onChange={(e) => setDate(e.target.value)} />
                )}
              </div>
              <div className="muted small">
                Now: {dateNow}
                {mode === 'shift' && !single && ' · each deal keeps its own date, moved by the same number of days'}
              </div>
            </div>
          </div>

          {error && (
            <p className="field-error" role="alert">
              {error}.
            </p>
          )}
          {editing.skippedChanged > 0 && (
            <div className="warnbox" role="note">
              {formatCount(editing.skippedChanged)} selected deal{editing.skippedChanged === 1 ? ' was' : 's were'} changed by
              teammates after you selected {editing.skippedChanged === 1 ? 'it' : 'them'} and will be skipped.
            </div>
          )}
          <p className="preview" aria-live="polite">
            {summary ? `${single ? single.company : `${formatCount(n)} deals`}: ${summary}.` : 'Nothing changes yet.'}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel <kbd>Esc</kbd>
          </button>
          <button type="submit" className="btn primary" data-testid="apply-edit">
            {single ? 'Save' : `Update ${formatCount(n)} deals`} <kbd>↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
