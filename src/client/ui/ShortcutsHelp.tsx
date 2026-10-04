import { Fragment, useEffect, useRef } from 'react';
import { actions } from '../app/hooks';
import { focusGrid } from './MoveMenu';

export const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  {
    group: 'Move around',
    items: [
      [['↓', 'J'], 'Next deal'],
      [['↑', 'K'], 'Previous deal'],
      [['PgDn', 'PgUp'], 'Page down / up'],
      [['Home', 'End'], 'First / last deal'],
      [['←', '→'], 'Table: previous / next tab · Board: previous / next column'],
      [['/'], 'Search'],
    ],
  },
  {
    group: 'Views',
    items: [
      [['V'], 'Switch Table ⇄ Board (same deals, filters and selection)'],
      [['F'], 'Toggle My focus ⇄ All open'],
      [['⇧←', '⇧→'], 'Board: carry the card to the previous / next stage'],
      [['drag'], 'Drop cards on a column or Won/Lost; drop table rows on a stage tab'],
    ],
  },
  {
    group: 'Select',
    items: [
      [['X', 'Space'], 'Select / unselect deal'],
      [['⇧↓', '⇧↑'], 'Extend selection'],
      [['⌘A'], 'Select every deal in this view (not just visible ones)'],
      [['Esc'], 'Clear selection / close panel'],
    ],
  },
  {
    group: 'Move deals',
    items: [
      [['1', '…', '7'], 'Move to New Lead … Lost (Won/Lost ask for a note / reason)'],
      [[']', '['], 'Move to next / previous stage'],
      [['M'], 'Move menu'],
      [['E'], 'Edit owner / close date of the selection'],
      [['Z'], 'Undo last change'],
    ],
  },
  {
    group: 'Sync',
    items: [
      [['A'], 'Unsaved changes & conflicts'],
      [['⇧R'], 'Retry everything that failed'],
      [['U'], 'Apply teammates’ changes to this list'],
      [['⇧S'], 'Simulation settings'],
      [['?'], 'This help'],
    ],
  },
];

export function ShortcutsHelp() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const close = () => {
    actions().openPanel(null);
    focusGrid();
  };
  return (
    <div className="backdrop" onMouseDown={close}>
      <div
        className="dialog help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        data-keyscope="local"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="body">
          <h2 id="help-title">Keyboard shortcuts</h2>
          <p>Everything works without a mouse. Shortcuts act on the selection, or on the focused deal if nothing is selected.</p>
          <div className="shortcut-cols">
            {SHORTCUTS.map((g) => (
              <dl className="shortcuts" key={g.group}>
                <h4>{g.group}</h4>
                {g.items.map(([keys, desc]) => (
                  <Fragment key={desc}>
                    <dt>
                      {keys.map((k) => (k === '…' ? ' … ' : k === 'drag' ? <span key={k}>Mouse</span> : <kbd key={k}>{k}</kbd>))}
                    </dt>
                    <dd>{desc}</dd>
                  </Fragment>
                ))}
              </dl>
            ))}
          </div>
        </div>
        <div className="actions">
          <button ref={ref} className="btn" onClick={close}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
