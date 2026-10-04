import type { StageId } from '../../shared/domain';
import type { PipelineState } from '../store/types';

/** Open stages are columns; Won/Lost are drop zones (closing a deal, not browsing them). */
export const BOARD_STAGES: StageId[] = ['new', 'contacted', 'demo', 'proposal', 'negotiation'];

export interface BoardModel {
  columns: Record<StageId, string[]>;
  /** Live count/value of deals really in each column (ghosts excluded). */
  count: Record<StageId, number>;
  value: Record<StageId, number>;
  /** Teammates' moves into this column waiting behind "Refresh". */
  arriving: Record<StageId, number>;
}

const empty = <T>(v: () => T) => Object.fromEntries(BOARD_STAGES.map((s) => [s, v()])) as Record<StageId, T>;

/** Which column a card is drawn in: where a teammate's move found it, else its stage. */
export const columnOf = (s: PipelineState, id: string): StageId | undefined =>
  s.view.heldStage.get(id) ?? s.display.get(id)?.stage;

let cache: {
  ids: string[];
  held: Map<string, StageId>;
  pending: Set<string>;
  departed: Map<string, unknown>;
  dataRev: number;
  model: BoardModel;
} | null = null;

/**
 * The board is a grouping of the *same* stable list the table shows, so sort,
 * filters, focus, selection and teammates' updates all carry over. One pass,
 * ~2 ms for 37k deals; cached until the list or the data changes.
 */
export function getBoard(s: PipelineState): BoardModel {
  const v = s.view;
  if (
    cache &&
    cache.ids === v.ids &&
    cache.held === v.heldStage &&
    cache.pending === v.pendingNew &&
    cache.departed === v.departed &&
    cache.dataRev === s.dataRev
  )
    return cache.model;
  const columns = empty<string[]>(() => []);
  const count = empty(() => 0);
  const value = empty(() => 0);
  const arriving = empty(() => 0);
  for (const id of v.ids) {
    const d = s.display.get(id);
    if (!d) continue;
    const held = v.heldStage.get(id);
    const col = held ?? d.stage;
    const list = columns[col];
    if (!list) continue; // closed deal still in a list (e.g. greyed out after a teammate closed it)
    list.push(id);
    if (held && held !== d.stage) {
      if (arriving[d.stage] !== undefined && !v.departed.has(id)) arriving[d.stage]++;
    } else if (!v.departed.has(id)) {
      count[col]++;
      value[col] += d.value;
    }
  }
  for (const id of v.pendingNew) {
    const st = s.display.get(id)?.stage;
    if (st && arriving[st] !== undefined) arriving[st]++;
  }
  const model = { columns, count, value, arriving };
  cache = { ids: v.ids, held: v.heldStage, pending: v.pendingNew, departed: v.departed, dataRev: s.dataRev, model };
  return model;
}

/** Keyboard movement on the board. Returns the id to focus next. */
export function boardNeighbor(s: PipelineState, dir: 'up' | 'down' | 'left' | 'right', step = 1): string | null {
  const { columns } = getBoard(s);
  const nonEmpty = BOARD_STAGES.filter((st) => columns[st].length);
  if (!nonEmpty.length) return null;
  const cur = s.focusId;
  const col = cur ? columnOf(s, cur) : undefined;
  const list = col ? columns[col] : undefined;
  const i = list && cur ? list.indexOf(cur) : -1;
  if (!list || i === -1) return columns[nonEmpty[0]][0];

  if (dir === 'up' || dir === 'down') {
    const next = Math.max(0, Math.min(list.length - 1, i + (dir === 'down' ? step : -step)));
    return list[next];
  }
  // Left/right: nearest non-empty column, keeping roughly the same row.
  let c = BOARD_STAGES.indexOf(col!);
  do {
    c += dir === 'right' ? 1 : -1;
  } while (c >= 0 && c < BOARD_STAGES.length && !columns[BOARD_STAGES[c]].length);
  if (c < 0 || c >= BOARD_STAGES.length) return cur;
  const target = columns[BOARD_STAGES[c]];
  return target[Math.min(i, target.length - 1)];
}

export function columnEdge(s: PipelineState, edge: 'first' | 'last'): string | null {
  const cur = s.focusId;
  const col = cur ? columnOf(s, cur) : undefined;
  const list = col ? getBoard(s).columns[col] : undefined;
  if (!list?.length) return null;
  return edge === 'first' ? list[0] : list[list.length - 1];
}
