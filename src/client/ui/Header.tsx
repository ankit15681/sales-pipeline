import { actions, usePipeline, useSim, useStageStats, useSyncSummary } from '../app/hooks';
import { formatCount, formatINRShort } from '../lib/format';
import { ME } from '../../shared/owners';

export function Header() {
  const stats = useStageStats();
  return (
    <header className="header">
      <h1>Pipeline</h1>
      <span className="sub">
        {formatCount(stats.openCount)} open deals · {formatINRShort(stats.openValue)}
      </span>
      <LiveIndicator />
      <span className="spacer" />
      <SyncPill />
      <button className="btn ghost" onClick={() => actions().togglePanel('help')} aria-keyshortcuts="?">
        Shortcuts <kbd>?</kbd>
      </button>
      <button className="btn" onClick={() => actions().togglePanel('sim')} aria-keyshortcuts="Shift+S">
        Simulation <kbd>⇧S</kbd>
      </button>
      <span className="muted" title="Signed in as">
        {ME.name}
      </span>
    </header>
  );
}

function LiveIndicator() {
  const online = usePipeline((s) => s.online);
  const rate = useSim((s) => s.teammateRate);
  return (
    <span className={`live ${online ? '' : 'off'}`} title="Teammates' changes stream in live">
      <span className="dot" />
      {online ? `Live · ${rate > 0 ? `${rate} edit${rate === 1 ? '' : 's'}/s from 19 teammates` : 'teammates idle'}` : 'Offline'}
    </span>
  );
}

/** One glanceable answer to "did my stuff save?" */
export function SyncPill() {
  const sum = useSyncSummary();
  const online = usePipeline((s) => s.online);
  const notSaved = sum.failed + sum.conflicts;
  const open = () => actions().openPanel('attention');

  if (notSaved > 0) {
    return (
      <button className="sync-pill err" onClick={open} aria-keyshortcuts="A" data-testid="sync-pill">
        <span className="dot" />
        {formatCount(notSaved)} not saved{sum.conflicts ? ` (${sum.conflicts} conflict${sum.conflicts > 1 ? 's' : ''})` : ''} ·
        Review
      </button>
    );
  }
  if (!online || sum.waiting) {
    return (
      <button className="sync-pill warn" onClick={open} data-testid="sync-pill">
        <span className="dot" />
        Offline · {formatCount(sum.pending)} change{sum.pending === 1 ? '' : 's'} will save when back online
      </button>
    );
  }
  if (sum.pending > 0) {
    return (
      <button className="sync-pill busy" onClick={open} data-testid="sync-pill">
        <span className="spinner" />
        Saving {formatCount(sum.pending)}…{sum.retrying ? ` (${sum.retrying} retrying)` : ''}
      </button>
    );
  }
  return (
    <span className="sync-pill ok" data-testid="sync-pill">
      <span className="dot" />
      All changes saved
    </span>
  );
}
