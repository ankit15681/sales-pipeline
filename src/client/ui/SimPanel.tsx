import { actions, usePipeline, useSim } from '../app/hooks';
import { DEFAULT_SIM, pipeline, server, sim, type SimConfig } from '../app/instance';
import { focusGrid } from './MoveMenu';

/** Knobs for reviewers: make the network slow, flaky, offline, or the team busy. */
export function SimPanel() {
  const cfg = useSim((s) => s);
  const focusId = usePipeline((s) => s.focusId);
  const setCfg = (patch: Partial<SimConfig>) => sim.setState(patch);
  const close = () => {
    actions().openPanel(null);
    focusGrid();
  };

  const share = `?latency=${cfg.latencyMin}-${cfg.latencyMax}&fail=${cfg.failureRate}&lost=${cfg.lostReplyRate}&teammates=${cfg.teammateRate}&hotspot=${cfg.hotspot}&retry=${cfg.autoRetry ? 1 : 0}`;

  return (
    <aside
      className="drawer"
      aria-labelledby="sim-title"
      data-keyscope="local"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <header>
        <h2 id="sim-title">Simulation</h2>
        <button className="btn small" onClick={() => setCfg({ ...DEFAULT_SIM })}>
          Reset
        </button>
        <button className="btn small" onClick={close}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="content">
        <h3>Network</h3>
        <Range
          label="Min latency"
          value={cfg.latencyMin}
          min={0}
          max={5000}
          step={50}
          fmt={(v) => `${v} ms`}
          onChange={(v) => setCfg({ latencyMin: v, latencyMax: Math.max(v, cfg.latencyMax) })}
        />
        <Range
          label="Max latency"
          value={cfg.latencyMax}
          min={0}
          max={8000}
          step={50}
          fmt={(v) => `${v} ms`}
          onChange={(v) => setCfg({ latencyMax: v, latencyMin: Math.min(v, cfg.latencyMin) })}
        />
        <Range
          label="Failed saves"
          value={Math.round(cfg.failureRate * 100)}
          min={0}
          max={100}
          step={1}
          fmt={(v) => `${v}%`}
          help="Share of save requests that fail. The brief says about 1 in 10."
          onChange={(v) => setCfg({ failureRate: v / 100 })}
        />
        <Range
          label="…of which saved but reply lost"
          value={Math.round(cfg.lostReplyRate * 100)}
          min={0}
          max={100}
          step={5}
          fmt={(v) => `${v}%`}
          help="The server applied the change but the client never heard back. Retries must not apply it twice."
          onChange={(v) => setCfg({ lostReplyRate: v / 100 })}
        />
        <label className="toggle">
          <input type="checkbox" checked={cfg.offline} onChange={(e) => setCfg({ offline: e.target.checked })} />
          Offline (requests fail; teammates' updates are held until reconnect)
        </label>
        <label className="toggle">
          <input type="checkbox" checked={cfg.autoRetry} onChange={(e) => setCfg({ autoRetry: e.target.checked })} />
          Auto-retry failed saves (2 retries with backoff)
        </label>

        <h3 style={{ marginTop: 18 }}>Teammates</h3>
        <Range
          label="Edits per second"
          value={cfg.teammateRate}
          min={0}
          max={30}
          step={0.5}
          fmt={(v) => `${v}/s`}
          help="Moves, value changes, reassignments, activity and new deals from 19 teammates."
          onChange={(v) => setCfg({ teammateRate: v })}
        />
        <Range
          label="Hotspot"
          value={Math.round(cfg.hotspot * 100)}
          min={0}
          max={100}
          step={5}
          fmt={(v) => `${v}%`}
          help="Chance an edit lands on a deal you can see right now, so you can watch it happen."
          onChange={(v) => setCfg({ hotspot: v / 100 })}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            aria-pressed={cfg.forceConflictNext}
            onClick={() => setCfg({ forceConflictNext: !cfg.forceConflictNext })}
            data-testid="force-conflict"
          >
            {cfg.forceConflictNext ? 'Armed: next save will conflict' : 'Force a conflict on my next save'}
          </button>
          <button
            className="btn"
            disabled={!focusId}
            onClick={() => {
              if (!focusId) return;
              server.teammateMove(focusId, server.randomTeammate(Math.random));
            }}
          >
            Teammate moves the focused deal
          </button>
        </div>

        <h3 style={{ marginTop: 18 }}>Reproduce this setup</h3>
        <div className="share">{share}</div>
        <p className="muted" style={{ fontSize: 12 }}>
          Settings persist in this browser. URL params override them. {pipeline.getState().display.size.toLocaleString('en-IN')}{' '}
          deals loaded.
        </p>
      </div>
    </aside>
  );
}

function Range(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  help?: string;
  onChange: (v: number) => void;
}) {
  const id = `sim-${props.label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <span className="val">{props.fmt(props.value)}</span>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.help && <span className="help">{props.help}</span>}
    </div>
  );
}
