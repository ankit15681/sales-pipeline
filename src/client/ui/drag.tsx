import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { pipeline } from '../app/instance';
import { formatCount, formatINRShort } from '../lib/format';
import { stageLabel, type StageId } from '../../shared/domain';

/**
 * Drag-and-drop without a library.
 *
 * Cards are always sorted (by priority), so a drop only changes a deal's stage,
 * never its position. That means:
 *  - drop targets are whole stages (board columns, Won/Lost zones, stage tabs),
 *    found with elementFromPoint + [data-drop-stage];
 *  - the source element can unmount mid-drag (virtualized lists) without breaking
 *    anything, because the drag state only holds deal ids;
 *  - the drop simply calls requestMove(), the same path as the keyboard, so
 *    confirmations, undo, retries and conflicts all behave identically.
 */
interface DragState {
  active: boolean;
  ids: string[];
  x: number;
  y: number;
  over: StageId | null;
  /** Stage(s) the dragged deals come from, to say "already there". */
  from: StageId[];
}

export const dragStore = createStore<DragState>(() => ({ active: false, ids: [], x: 0, y: 0, over: null, from: [] }));

const THRESHOLD = 6;

const hitTest = (x: number, y: number): StageId | null => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-stage]');
  return (el?.dataset.dropStage as StageId | undefined) ?? null;
};

/** Call from onPointerDown of a row or card. A click (no movement) is left alone. */
export function trackDrag(e: ReactPointerEvent, id: string) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  if ((e.target as HTMLElement).closest('button, input, a')) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const onMove = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      started = true;
      const s = pipeline.getState();
      // Dragging a selected deal drags the whole selection.
      const ids = s.selection.has(id) ? [...s.selection] : [id];
      const from = [
        ...new Set(
          ids
            .slice(0, 500)
            .map((x) => s.display.get(x)?.stage)
            .filter(Boolean),
        ),
      ] as StageId[];
      document.body.classList.add('is-dragging');
      window.getSelection()?.removeAllRanges();
      dragStore.setState({ active: true, ids, from, x: ev.clientX, y: ev.clientY, over: null });
    }
    dragStore.setState({ x: ev.clientX, y: ev.clientY, over: hitTest(ev.clientX, ev.clientY) });
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('is-dragging');
  };

  const onUp = () => {
    cleanup();
    if (!started) return;
    const { over, ids, from } = dragStore.getState();
    dragStore.setState({ active: false, ids: [], over: null, from: [] });
    if (!over) return;
    if (from.length === 1 && from[0] === over) return; // dropped where it already is
    pipeline.getState().requestMove(over, ids);
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !started) return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    dragStore.setState({ active: false, ids: [], over: null, from: [] });
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
}

/** For drop targets: is a drag happening, and is it over me? */
export function useDropTarget(stage: StageId) {
  const active = useStore(dragStore, (s) => s.active);
  const over = useStore(dragStore, (s) => s.active && s.over === stage);
  const already = useStore(dragStore, (s) => s.active && s.from.length === 1 && s.from[0] === stage);
  return { active, over, already };
}

export const useDragActive = () => useStore(dragStore, (s) => s.active);

/** The thing that follows the pointer. */
export function DragOverlay() {
  const { active, ids, x, y, over, from } = useStore(dragStore);
  if (!active) return null;
  const display = pipeline.getState().display;
  const first = display.get(ids[0]);
  let value = 0;
  for (const id of ids.slice(0, 5000)) value += display.get(id)?.value ?? 0;
  const same = over && from.length === 1 && from[0] === over;
  return (
    <div
      className="drag-overlay"
      style={{
        transform: `translate(${Math.min(x + 14, window.innerWidth - 244)}px, ${Math.min(y + 10, window.innerHeight - 96)}px)`,
      }}
      aria-hidden
    >
      {ids.length > 1 && <div className="drag-stack" />}
      <div className="drag-card">
        <div className="company">{ids.length === 1 ? first?.company : `${formatCount(ids.length)} deals`}</div>
        <div className="muted">{formatINRShort(value)}</div>
        <div className={`drag-target ${over && !same ? 'ok' : ''}`}>
          {!over ? 'Drop on a stage' : same ? `Already in ${stageLabel(over)}` : `Move to ${stageLabel(over)}`}
        </div>
      </div>
    </div>
  );
}
