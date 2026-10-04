import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount, formatINRShort } from '../lib/format';
import {
  closeProblem,
  LOST_REASONS,
  NOTE_MAX,
  STAGES,
  stageLabel,
  type CloseDetails,
  type LostReason,
} from '../../shared/domain';
import { focusGrid } from './MoveMenu';

/**
 * One dialog for the two moments a move needs a deliberate step:
 *  - big moves (more than 20 deals): count, value and where they come from;
 *  - closing deals: Lost needs a reason (keys 1–7), Won takes an optional note.
 * A bulk close is both at once, so it is one dialog, not two in a row.
 */
export function ConfirmDialog() {
  const c = usePipeline((s) => s.confirm);
  const [reason, setReason] = useState<LostReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const closing = pipeline.getState().confirm?.closing;
    if (closing === 'lost') reasonsRef.current?.focus();
    else if (closing === 'won') noteRef.current?.focus();
    else confirmRef.current?.focus();
  }, []);

  if (!c) return null;

  const n = c.moves.length;
  const single = n === 1 ? pipeline.getState().display.get(c.moves[0].id) : undefined;
  const lost = c.closing === 'lost';
  const details: CloseDetails | undefined = c.closing ? { ...(lost && reason ? { reason } : {}), note } : undefined;
  // Once the user has tried to confirm, keep the message in step with what they fix.
  const liveError = error && c.closing ? closeProblem(c.closing, details) : null;

  const cancel = () => {
    actions().cancelConfirm();
    focusGrid();
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const problem = actions().confirmMove(details);
    if (problem) {
      setError(problem);
      if (problem.includes('note')) noteRef.current?.focus();
      else reasonsRef.current?.focus();
      return;
    }
    focusGrid();
  };
  const pick = (r: LostReason) => {
    setReason(r);
    if (r === 'other') noteRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    const typing = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (lost && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const r = LOST_REASONS[Number(e.key) - 1];
      if (r) {
        e.preventDefault();
        pick(r.id);
        return;
      }
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      submit();
    }
  };

  const title = single
    ? c.closing
      ? `${lost ? 'Close' : 'Mark'} ${single.company} as ${stageLabel(c.closing)}`
      : `Move ${single.company} to ${stageLabel(c.moves[0].to)}?`
    : c.to
      ? `Move ${formatCount(n)} deals to ${stageLabel(c.to)}?`
      : `Move ${formatCount(n)} deals forward one stage?`;

  return (
    <div className="backdrop" onMouseDown={cancel}>
      <form
        className="dialog"
        role={single ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        data-keyscope="local"
        data-testid="confirm-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={submit}
      >
        <div className="body">
          <h2 id="confirm-title">{title}</h2>
          <p id="confirm-desc">
            {single
              ? `${formatINRShort(single.value)} · now in ${stageLabel(single.stage)}.`
              : `Total value ${formatINRShort(c.value)}.${c.closing && c.closingCount === n ? ' This closes them.' : ''}`}
          </p>
          {!single && (
            <div className="breakdown">
              {STAGES.filter((s) => c.byStage[s.id]).map((s) => (
                <span key={s.id} className="chip">
                  from {s.label}: {formatCount(c.byStage[s.id]!)}
                </span>
              ))}
            </div>
          )}

          {lost && (
            <fieldset className="close-fields">
              <legend>
                {single ? 'Why was it lost?' : 'Why were they lost?'}{' '}
                {!single && <span className="muted">Applies to all {formatCount(c.closingCount)}.</span>}
              </legend>
              <div
                ref={reasonsRef}
                className="reasons"
                role="radiogroup"
                aria-label="Lost reason"
                aria-required="true"
                aria-invalid={!!liveError && !reason}
                tabIndex={-1}
              >
                {LOST_REASONS.map((r, i) => (
                  <label key={r.id} className={`reason ${reason === r.id ? 'on' : ''}`}>
                    <input type="radio" name="lost-reason" checked={reason === r.id} onChange={() => pick(r.id)} />
                    <kbd>{i + 1}</kbd> {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {c.closing && (
            <label className="note-field">
              <span>
                {lost ? (reason === 'other' ? 'Note (required for Other)' : 'Note (optional)') : 'Win note (optional)'}
                {!single && c.closing === 'won' && c.closingCount < n && (
                  <span className="muted"> · {formatCount(c.closingCount)} of these close as Won</span>
                )}
              </span>
              <input
                ref={noteRef}
                type="text"
                value={note}
                maxLength={NOTE_MAX}
                placeholder={lost ? 'What would have changed the outcome?' : 'What made it work?'}
                aria-invalid={!!liveError && reason === 'other' && !note.trim()}
                onChange={(e) => setNote(e.target.value)}
              />
              {note.length > NOTE_MAX - 60 && (
                <span className="muted">
                  {note.length}/{NOTE_MAX}
                </span>
              )}
            </label>
          )}

          {liveError && (
            <p className="field-error" role="alert">
              {liveError}
              {liveError === 'Pick a reason' ? ' (1–7).' : '.'}
            </p>
          )}

          {!single && <p>Saves run in the background in batches. You can keep working, stop the job part-way, or undo it.</p>}
          {c.skippedChanged > 0 && (
            <div className="warnbox" role="note">
              {formatCount(c.skippedChanged)} selected deal{c.skippedChanged === 1 ? ' was' : 's were'} changed by teammates after
              you selected {c.skippedChanged === 1 ? 'it' : 'them'} and will be skipped.
            </div>
          )}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel <kbd>Esc</kbd>
          </button>
          <button ref={confirmRef} type="submit" className="btn primary" data-testid="confirm-move">
            {single && c.closing ? `Mark as ${stageLabel(c.closing)}` : `Move ${formatCount(n)} deal${n === 1 ? '' : 's'}`}{' '}
            <kbd>↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
