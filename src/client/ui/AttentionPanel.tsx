import { useEffect, useMemo, useRef } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount, relativeTime } from '../lib/format';
import { ownerFirstName } from '../../shared/owners';
import { stageLabel } from '../../shared/domain';
import { applyMineLabel, capitalize, describeEntry, keepTheirsLabel, theirsText } from '../store/describe';
import type { SyncEntry } from '../store/types';
import { focusGrid } from './MoveMenu';

const LIMIT = 100;

/** Everything that did not (yet) reach the server, in one place. */
export function AttentionPanel() {
  const syncRev = usePipeline((s) => s.syncRev);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const groups = useMemo(() => {
    const failed: SyncEntry[] = [];
    const conflicts: SyncEntry[] = [];
    let pending = 0;
    let waiting = 0;
    for (const e of pipeline.getState().entries.values()) {
      if (e.status === 'failed') failed.push(e);
      else if (e.status === 'conflict') conflicts.push(e);
      else if (e.status === 'waiting') waiting++;
      else pending++;
    }
    return { failed, conflicts, pending, waiting };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRev]);

  const close = () => {
    actions().openPanel(null);
    focusGrid();
  };
  const display = pipeline.getState().display;
  const nothing = !groups.failed.length && !groups.conflicts.length && !groups.pending && !groups.waiting;

  return (
    <aside
      className="drawer"
      aria-labelledby="attention-title"
      data-keyscope="local"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <header>
        <h2 id="attention-title" ref={headingRef} tabIndex={-1}>
          Unsaved changes
        </h2>
        <button className="btn small" onClick={close}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="content">
        {nothing && <p className="muted">Everything you changed is saved.</p>}
        {(groups.pending > 0 || groups.waiting > 0) && (
          <p className="muted">
            {groups.pending > 0 && `${formatCount(groups.pending)} saving right now. `}
            {groups.waiting > 0 && `${formatCount(groups.waiting)} waiting for the connection to come back.`}
          </p>
        )}

        {groups.conflicts.length > 0 && (
          <section aria-labelledby="conflicts-h">
            <h3 id="conflicts-h">
              Conflicts ({formatCount(groups.conflicts.length)})<span className="spacer" />
              <button className="btn small" onClick={() => actions().resolveAllConflicts('theirs')}>
                Keep all theirs
              </button>
              <button className="btn small" onClick={() => actions().resolveAllConflicts('mine')}>
                Apply all mine
              </button>
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              A teammate changed these deals before your change reached the server. Nothing was overwritten.
            </p>
            {groups.conflicts.slice(0, LIMIT).map((e) => {
              const d = display.get(e.dealId);
              return (
                <div key={e.dealId} className="item conflict">
                  <div className="line1">
                    <strong>{d?.company}</strong>
                    <span className="ref">{d?.ref}</span>
                  </div>
                  <div className="line2">
                    {e.theirs
                      ? `${ownerFirstName(e.theirs.by)} ${theirsText(e.theirs)} ${relativeTime(e.theirs.at)}.`
                      : 'Changed by a teammate.'}{' '}
                    You wanted: {describeEntry(e)}.
                  </div>
                  <div className="btns">
                    <button className="btn small" onClick={() => actions().resolveConflict(e.dealId, 'theirs')}>
                      {keepTheirsLabel(e)}
                    </button>
                    <button className="btn small" onClick={() => actions().resolveConflict(e.dealId, 'mine')}>
                      {applyMineLabel(e)}
                    </button>
                  </div>
                </div>
              );
            })}
            {groups.conflicts.length > LIMIT && (
              <p className="muted">…and {formatCount(groups.conflicts.length - LIMIT)} more.</p>
            )}
          </section>
        )}

        {groups.failed.length > 0 && (
          <section aria-labelledby="failed-h">
            <h3 id="failed-h">
              Not saved ({formatCount(groups.failed.length)})<span className="spacer" />
              <button className="btn small" onClick={() => actions().retryAllFailed()}>
                Retry all <kbd>⇧R</kbd>
              </button>
              <button className="btn small danger" onClick={() => actions().discardAllFailed()}>
                Discard all
              </button>
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              The server didn't confirm these. They are shown as the server has them until you retry.
            </p>
            {groups.failed.slice(0, LIMIT).map((e) => {
              const d = display.get(e.dealId);
              return (
                <div key={e.dealId} className="item failed">
                  <div className="line1">
                    <strong>{d?.company}</strong>
                    <span className="ref">{d?.ref}</span>
                  </div>
                  <div className="line2">
                    {e.rejected
                      ? `${capitalize(describeEntry(e))} was refused: ${e.error}.`
                      : `${capitalize(describeEntry(e))} failed after ${e.attempts} attempt${e.attempts === 1 ? '' : 's'} (${e.error}).`}
                    {e.move && ` Still in ${d ? stageLabel(d.stage) : '?'}.`}
                  </div>
                  <div className="btns">
                    {!e.rejected && (
                      <button className="btn small" onClick={() => actions().retry(e.dealId)}>
                        Retry
                      </button>
                    )}
                    <button className="btn small" onClick={() => actions().discard(e.dealId)}>
                      Discard
                    </button>
                  </div>
                </div>
              );
            })}
            {groups.failed.length > LIMIT && <p className="muted">…and {formatCount(groups.failed.length - LIMIT)} more.</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
