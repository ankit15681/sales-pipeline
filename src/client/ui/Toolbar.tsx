import { useEffect, useRef, useState } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { formatCount } from '../lib/format';
import { ME, OWNERS } from '../../shared/owners';
import type { CloseFilter, SortKey } from '../store/query';
import { focusMain } from './dealStatus';

export const SEARCH_INPUT_ID = 'deal-search';

export function Toolbar() {
  const query = usePipeline((s) => s.view.query);
  const total = usePipeline((s) => s.view.ids.length);
  const [text, setText] = useState(query.search);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setText(query.search), [query.search]);

  const onSearch = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => actions().setQuery({ search: v }), 150);
  };

  const focusTab = query.tab === 'focus';
  const layout = usePipeline((s) => s.layout);

  return (
    <div className="toolbar">
      <ViewToggle />
      {layout === 'board' && <ScopeToggle />}
      <div className="search">
        <input
          id={SEARCH_INPUT_ID}
          type="search"
          placeholder="Search company or deal ID"
          value={text}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault();
              clearTimeout(timer.current);
              actions().setQuery({ search: text });
              focusMain();
            }
          }}
          aria-label="Search deals"
          aria-keyshortcuts="/"
        />
        {!text && <kbd>/</kbd>}
      </div>
      <select
        aria-label="Owner"
        value={focusTab ? ME.id : query.owner}
        disabled={focusTab}
        title={focusTab ? 'My focus always shows your own deals' : undefined}
        onChange={(e) => actions().setQuery({ owner: e.target.value })}
      >
        <option value="all">Everyone's deals</option>
        <option value={ME.id}>My deals</option>
        <optgroup label="Teammates">
          {OWNERS.slice(1).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        aria-label="Last activity"
        value={query.idleDays}
        onChange={(e) => actions().setQuery({ idleDays: Number(e.target.value) })}
      >
        <option value={0}>Any activity</option>
        <option value={14}>No activity 14+ days</option>
        <option value={30}>No activity 30+ days</option>
        <option value={90}>No activity 90+ days</option>
        <option value={180}>No activity 180+ days</option>
      </select>
      <select
        aria-label="Close date"
        value={query.close}
        onChange={(e) => actions().setQuery({ close: e.target.value as CloseFilter })}
      >
        <option value="any">Any close date</option>
        <option value="overdue">Close date passed</option>
        <option value="next30">Closing in 30 days</option>
      </select>
      {layout === 'board' && <SortSelect />}
      <span className="count" data-testid="view-count">
        {formatCount(total)} deal{total === 1 ? '' : 's'}
      </span>
      <span className="spacer" />
      {/* On the board each column carries its own "+N from teammates · Refresh" pill. */}
      {layout === 'table' && <UpdatesPill />}
    </div>
  );
}

/** Table ⇄ Board: same deals, filters, selection and sync, two ways of looking at them. */
function ViewToggle() {
  const layout = usePipeline((s) => s.layout);
  return (
    <div className="seg" role="radiogroup" aria-label="View" title="Switch view (V)">
      {(['table', 'board'] as const).map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={layout === l}
          className={layout === l ? 'on' : ''}
          onClick={() => {
            actions().setLayout(l);
            focusMain();
          }}
          data-testid={`view-${l}`}
        >
          {l === 'table' ? '☰ Table' : '▦ Board'}
        </button>
      ))}
      <kbd className="seg-kbd">V</kbd>
    </div>
  );
}

/** On the board, stages are columns, so the only scope choice is "mine & urgent" vs everything open. */
function ScopeToggle() {
  const tab = usePipeline((s) => s.view.query.tab);
  return (
    <div className="seg" role="radiogroup" aria-label="Scope" title="Toggle scope (F)">
      <button
        role="radio"
        aria-checked={tab === 'focus'}
        className={tab === 'focus' ? 'on dark' : ''}
        onClick={() => actions().setTab('focus')}
      >
        ★ My focus
      </button>
      <button
        role="radio"
        aria-checked={tab === 'open'}
        className={tab === 'open' ? 'on dark' : ''}
        onClick={() => actions().setTab('open')}
      >
        All open
      </button>
    </div>
  );
}

const SORTS: { key: SortKey; dir: 'asc' | 'desc'; label: string }[] = [
  { key: 'priority', dir: 'desc', label: 'Cards by priority' },
  { key: 'value', dir: 'desc', label: 'Cards by value' },
  { key: 'closeDate', dir: 'asc', label: 'Cards by close date' },
  { key: 'lastActivity', dir: 'asc', label: 'Cards by oldest activity' },
  { key: 'company', dir: 'asc', label: 'Cards by name' },
];

function SortSelect() {
  const sort = usePipeline((s) => s.view.query.sort);
  const current = SORTS.findIndex((o) => o.key === sort.key && o.dir === sort.dir);
  return (
    <select
      aria-label="Sort cards"
      value={current === -1 ? '' : current}
      onChange={(e) => {
        const o = SORTS[Number(e.target.value)];
        actions().setQuery({ sort: { key: o.key, dir: o.dir } });
      }}
    >
      {current === -1 && <option value="">Custom sort</option>}
      {SORTS.map((o, i) => (
        <option key={o.label} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Teammates' changes that would reshuffle the list wait here until the user asks for them. */
function UpdatesPill() {
  const pendingNew = usePipeline((s) => s.view.pendingNew.size);
  const departed = usePipeline((s) => s.view.departed.size);
  if (!pendingNew && !departed) return null;
  const parts = [];
  if (pendingNew) parts.push(`${formatCount(pendingNew)} new`);
  if (departed) parts.push(`${formatCount(departed)} moved out`);
  return (
    <button
      className="updates-pill"
      onClick={() => actions().refreshView()}
      aria-keyshortcuts="U"
      data-testid="updates-pill"
      title="Teammates changed deals in this view. Nothing moves until you refresh."
    >
      Teammates changed this view: {parts.join(', ')} · Refresh <kbd>U</kbd>
    </button>
  );
}
