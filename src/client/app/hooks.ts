import { useMemo } from 'react';
import { useStore } from 'zustand';
import { ME } from '../../shared/owners';
import { needsAttention } from '../lib/priority';
import { STAGES, STAGE_BY_ID, type StageId } from '../../shared/domain';
import { PENDING_STATUSES, type Pipeline } from '../store/types';
import { pipeline, sim, type SimConfig } from './instance';

export const usePipeline = <T>(selector: (s: Pipeline) => T): T => useStore(pipeline, selector);
export const useSim = <T>(selector: (s: SimConfig) => T): T => useStore(sim, selector);
export const actions = () => pipeline.getState();

export interface StageStats {
  count: Record<StageId, number>;
  value: Record<StageId, number>;
  openCount: number;
  openValue: number;
  focusCount: number;
}

/** Live per-stage totals. One pass over 50k records (~1–2 ms), only when data changes. */
export function useStageStats(): StageStats {
  const dataRev = usePipeline((s) => s.dataRev);
  return useMemo(() => {
    const display = pipeline.getState().display;
    const count = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
    const value = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<StageId, number>;
    let openCount = 0;
    let openValue = 0;
    let focusCount = 0;
    const now = Date.now();
    for (const d of display.values()) {
      count[d.stage]++;
      value[d.stage] += d.value;
      if (STAGE_BY_ID[d.stage].open) {
        openCount++;
        openValue += d.value;
        if (d.ownerId === ME.id && needsAttention(d, now)) focusCount++;
      }
    }
    return { count, value, openCount, openValue, focusCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRev]);
}

export interface SyncSummary {
  pending: number;
  retrying: number;
  waiting: number;
  failed: number;
  conflicts: number;
}

export function useSyncSummary(): SyncSummary {
  const syncRev = usePipeline((s) => s.syncRev);
  return useMemo(() => {
    const out: SyncSummary = { pending: 0, retrying: 0, waiting: 0, failed: 0, conflicts: 0 };
    for (const e of pipeline.getState().entries.values()) {
      if (PENDING_STATUSES.has(e.status)) out.pending++;
      if (e.status === 'retrying') out.retrying++;
      else if (e.status === 'waiting') out.waiting++;
      else if (e.status === 'failed') out.failed++;
      else if (e.status === 'conflict') out.conflicts++;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRev]);
}
