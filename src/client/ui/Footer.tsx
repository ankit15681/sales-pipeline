import { useMemo } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount } from '../lib/format';

/** Running bulk jobs (with progress and Stop) plus a reminder of the main keys. */
export function Footer() {
  const syncRev = usePipeline((s) => s.syncRev);
  const layout = usePipeline((s) => s.layout);
  const jobs = useMemo(() => {
    const { jobs, entries } = pipeline.getState();
    const running = [...jobs.values()].filter((j) => !j.finishedAt);
    if (!running.length) return [];
    const notSaved = new Map<string, number>();
    for (const e of entries.values()) {
      if (e.jobId && (e.status === 'failed' || e.status === 'conflict')) notSaved.set(e.jobId, (notSaved.get(e.jobId) ?? 0) + 1);
    }
    return running.map((j) => ({ ...j, notSaved: notSaved.get(j.id) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRev]);

  return (
    <footer className="footer">
      {jobs.map((j) => {
        const done = j.saved + j.notSaved + j.cancelled;
        return (
          <div className="job" key={j.id} role="status" data-testid="job">
            <span>{j.label.replace(/^Moved/, 'Moving')}</span>
            <span
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={j.total}
              aria-valuenow={done}
              aria-label={`${j.label} progress`}
            >
              <span className="bar-ok" style={{ width: `${(j.saved / j.total) * 100}%` }} />
              <span className="bar-err" style={{ width: `${(j.notSaved / j.total) * 100}%` }} />
            </span>
            <span className="muted">
              {formatCount(j.saved)} / {formatCount(j.total)} saved
              {j.notSaved ? ` · ${formatCount(j.notSaved)} not saved` : ''}
            </span>
            <button className="btn small" onClick={() => actions().cancelJob(j.id)}>
              Stop
            </button>
          </div>
        );
      })}
      {!jobs.length && (
        <div className="hints" aria-hidden>
          <span>
            <kbd>J</kbd>/<kbd>K</kbd> move
          </span>
          <span>
            <kbd>X</kbd> select
          </span>
          <span>
            <kbd>1</kbd>–<kbd>7</kbd> or <kbd>M</kbd> change stage
          </span>
          <span>
            <kbd>E</kbd> edit
          </span>
          <span>
            <kbd>⌘A</kbd> select all
          </span>
          <span>
            <kbd>←</kbd>/<kbd>→</kbd> {layout === 'board' ? 'columns' : 'views'}
          </span>
          {layout === 'board' && (
            <span>
              <kbd>⇧←</kbd>/<kbd>⇧→</kbd> move a stage
            </span>
          )}
          <span>
            <kbd>V</kbd> {layout === 'board' ? 'table' : 'board'}
          </span>
          <span>
            <kbd>Z</kbd> undo
          </span>
          <span>
            <kbd>?</kbd> all shortcuts
          </span>
        </div>
      )}
      <span className="spacer" />
    </footer>
  );
}
