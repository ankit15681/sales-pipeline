import { useMemo } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import { formatCount, formatINRShort } from '../lib/format';
import { STAGES } from '../../shared/domain';

export function BulkBar() {
  const selection = usePipeline((s) => s.selection);
  const viewSize = usePipeline((s) => s.view.ids.length);
  const value = useMemo(() => {
    const d = pipeline.getState().display;
    let v = 0;
    for (const id of selection) v += d.get(id)?.value ?? 0;
    return v;
  }, [selection]);

  if (!selection.size) return null;
  const all = selection.size === viewSize;

  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions" data-testid="bulkbar">
      <strong>
        {all ? 'All ' : ''}
        {formatCount(selection.size)} selected
      </strong>
      <span>· {formatINRShort(value)}</span>
      {!all && viewSize > selection.size && (
        <button className="btn small" onClick={() => actions().selectAll()}>
          Select all {formatCount(viewSize)} <kbd>⌘A</kbd>
        </button>
      )}
      <span className="spacer" />
      <button className="btn small" onClick={() => actions().openEdit()} title="Change owner or close date">
        Edit fields <kbd>E</kbd>
      </button>
      <span>Move to:</span>
      {STAGES.map((s) => (
        <button key={s.id} className="btn small" onClick={() => actions().requestMove(s.id)} title={`Move to ${s.label}`}>
          {s.label} <kbd>{s.key}</kbd>
        </button>
      ))}
      <button className="btn small" onClick={() => actions().clearSelection()}>
        Clear <kbd>Esc</kbd>
      </button>
    </div>
  );
}
