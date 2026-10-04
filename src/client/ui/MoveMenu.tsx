import { useEffect, useRef, useState } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { formatCount } from '../lib/format';
import { STAGES, stageLabel } from '../../shared/domain';
import { STAGE_COLORS } from './visual';

import { focusMain } from './dealStatus';

/** Back to the list or board, whichever is showing. */
export const focusGrid = focusMain;

/** "M": a small command palette for moving, so nobody needs to memorise 1–7. */
export function MoveMenu() {
  const selectionSize = usePipeline((s) => s.selection.size);
  const focused = usePipeline((s) => (s.focusId ? s.display.get(s.focusId) : undefined));
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const count = selectionSize || (focused ? 1 : 0);
  const current = selectionSize ? null : focused?.stage;
  const options = STAGES.filter((s) => s.label.toLowerCase().includes(filter.trim().toLowerCase()));

  const close = () => {
    actions().openPanel(null);
    focusGrid();
  };
  const choose = (i: number) => {
    const stage = options[i];
    if (!stage) return;
    actions().openPanel(null);
    focusGrid();
    actions().requestMove(stage.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (/^[1-7]$/.test(e.key) && !filter) {
      e.preventDefault();
      const idx = options.findIndex((s) => s.key === e.key);
      choose(idx);
    }
  };

  if (!count) {
    return null;
  }

  return (
    <div className="backdrop" onMouseDown={close}>
      <div
        className="dialog palette"
        role="dialog"
        aria-modal="true"
        aria-label="Move deals"
        data-keyscope="local"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          placeholder={count === 1 && focused ? `Move ${focused.company} to…` : `Move ${formatCount(count)} selected deals to…`}
          aria-label="Stage"
          aria-controls="move-options"
          aria-activedescendant={options[active] ? `move-${options[active].id}` : undefined}
        />
        <ul id="move-options" role="listbox">
          {options.map((s, i) => (
            <li
              key={s.id}
              id={`move-${s.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span
                className="stage-dot"
                style={{ width: 10, height: 10, borderRadius: 2, background: STAGE_COLORS[s.id].dot }}
              />
              {s.label}
              {current === s.id && <span className="muted">(current)</span>}
              <span className="spacer" />
              <kbd>{s.key}</kbd>
            </li>
          ))}
          {!options.length && <li aria-disabled="true">No stage matches “{filter}”</li>}
        </ul>
        <div className="hint">
          <kbd>↑</kbd> <kbd>↓</kbd> to pick · <kbd>Enter</kbd> to move · <kbd>1</kbd>–<kbd>7</kbd> straight to a stage ·{' '}
          <kbd>Esc</kbd> to close
          {current && <> · now in {stageLabel(current)}</>}
        </div>
      </div>
    </div>
  );
}
