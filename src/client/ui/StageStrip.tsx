import { actions, usePipeline, useStageStats } from '../app/hooks';
import { formatCount, formatINRShort } from '../lib/format';
import { STAGES, stageLabel, type StageId } from '../../shared/domain';
import { useDropTarget } from './drag';
import type { Tab } from '../store/query';
import { STAGE_COLORS } from './visual';

/**
 * Board-like overview without a board: every stage with its live count and
 * value, doubling as tabs (← / →). Counts update live; the list below does not jump.
 */
export function StageStrip() {
  const tab = usePipeline((s) => s.view.query.tab);
  const stats = useStageStats();
  const select = (t: Tab) => actions().setTab(t);

  return (
    <div className="strip" role="tablist" aria-label="Pipeline views">
      <button
        role="tab"
        aria-controls="deal-grid"
        className="tab focus-tab"
        aria-selected={tab === 'focus'}
        onClick={() => select('focus')}
        data-testid="tab-focus"
      >
        <span className="t-label">★ My focus</span>
        <span className="t-meta">{formatCount(stats.focusCount)} need attention</span>
      </button>
      <button
        role="tab"
        aria-controls="deal-grid"
        className="tab"
        aria-selected={tab === 'open'}
        onClick={() => select('open')}
        data-testid="tab-open"
      >
        <span className="t-label">All open</span>
        <span className="t-meta">
          {formatCount(stats.openCount)} · {formatINRShort(stats.openValue)}
        </span>
      </button>
      <span className="divider" aria-hidden />
      {STAGES.map((s) => (
        <StageTab key={s.id} stage={s.id} selected={tab === s.id} count={stats.count[s.id]} value={stats.value[s.id]} />
      ))}
    </div>
  );
}

/** A stage tab is also a drop target: drag table rows onto it to move them. */
function StageTab({ stage, selected, count, value }: { stage: StageId; selected: boolean; count: number; value: number }) {
  const { active, over, already } = useDropTarget(stage);
  const cls = ['tab', active && !already && 'drop-armed', over && !already && 'drop-over'].filter(Boolean).join(' ');
  return (
    <button
      role="tab"
      aria-controls="deal-grid"
      className={cls}
      aria-selected={selected}
      onClick={() => actions().setTab(stage)}
      data-testid={`tab-${stage}`}
      data-drop-stage={stage}
    >
      <span className="t-label">
        <span className="stage-dot" style={{ background: STAGE_COLORS[stage].dot }} />
        {stageLabel(stage)}
      </span>
      <span className="t-meta">
        {over && !already ? 'Drop to move here' : `${formatCount(count)} · ${formatINRShort(value)}`}
      </span>
    </button>
  );
}
