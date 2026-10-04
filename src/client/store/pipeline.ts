import { createStore } from 'zustand/vanilla';
import { ApiError, type DealPart, type MutationResult, type PipelineApi, type ServerEvent } from '../../shared/api';
import { formatCount } from '../lib/format';
import { ME, ownerFirstName } from '../../shared/owners';
import { uid } from '../../shared/random';
import {
  adjacentStage,
  cleanClose,
  closeProblem,
  fieldKeys,
  isClosed,
  LOST_REASON_BY_ID,
  STAGES,
  stageLabel,
  type CloseDetails,
  type Deal,
  type FieldKey,
  type FieldValues,
  type StageId,
} from '../../shared/domain';
import { capitalize, closeDateFor, describeEntry, editSpecText, pickFields, plural, put, theirsText } from './describe';
import { computeIds, DEFAULT_QUERY, insertionIndex, matches, sameQuery, type Query, type Tab } from './query';
import {
  PENDING_STATUSES,
  type Job,
  type MoveIntent,
  type PendingRequest,
  type Pipeline,
  type PipelineState,
  type SyncEntry,
  type Toast,
  type UndoItem,
  type ViewState,
} from './types';

export interface PipelineOptions {
  /** Read live from the simulation panel. */
  autoRetry?: () => boolean;
  maxAutoRetries?: number;
  backoffMs?: (attempt: number) => number;
  interactiveChunk?: number;
  bulkChunk?: number;
  maxInFlight?: number;
  maxBulkInFlight?: number;
  /** Moves of more than this many deals ask for confirmation. */
  confirmThreshold?: number;
  /** Moves of more than this many deals run as a background job in the bulk lane. */
  bulkLaneThreshold?: number;
  /** Teammates' changes are applied in batches every N ms. */
  remoteFlushMs?: number;
  offlineProbeMs?: number;
}

const TABS: Tab[] = ['focus', 'open', ...STAGES.map((s) => s.id)];

const emptyView = (query: Query = DEFAULT_QUERY): ViewState => ({
  query,
  ids: [],
  index: new Map(),
  departed: new Map(),
  pendingNew: new Set(),
  heldStage: new Map(),
  computedAt: 0,
});

const buildIndex = (ids: string[]) => {
  const m = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) m.set(ids[i], i);
  return m;
};

/** One user change to one deal: a stage move, field values, or both. */
interface Intent {
  id: string;
  to?: StageId;
  close?: CloseDetails;
  set?: FieldValues;
}

// ---------- entries: pure helpers ----------

/** True when this copy of the deal already has everything the entry wants. */
export const isSatisfied = (e: SyncEntry, d: Deal) =>
  (!e.move || d.stage === e.move.to) && fieldKeys(e.edit?.set).every((k) => d[k] === e.edit!.set[k]);

/** Parts a teammate changed to something that is neither what we saw nor what we want. */
const staleParts = (e: SyncEntry, d: Deal): DealPart[] => {
  const out: DealPart[] = [];
  if (e.move && d.stage !== e.move.to && d.stage !== e.move.from) out.push('stage');
  for (const k of fieldKeys(e.edit?.set)) if (d[k] !== e.edit!.set[k] && d[k] !== e.edit!.expect[k]) out.push(k);
  return out;
};

const theirsOf = (d: Deal, stale: DealPart[]): NonNullable<SyncEntry['theirs']> => {
  const keys = stale.filter((p): p is FieldKey => p !== 'stage');
  return {
    by: d.updatedBy,
    at: d.updatedAt,
    stage: stale.includes('stage') ? d.stage : undefined,
    fields: keys.length ? pickFields(d, keys) : undefined,
  };
};

/**
 * Restate whatever is still missing against a copy of the deal: the new request
 * expects exactly what that copy has. Returns null when nothing is missing.
 */
const rebase = (e: SyncEntry, d: Deal): SyncEntry | null => {
  const move = e.move && d.stage !== e.move.to ? { ...e.move, from: d.stage } : undefined;
  let edit: SyncEntry['edit'];
  for (const k of fieldKeys(e.edit?.set)) {
    if (d[k] === e.edit!.set[k]) continue;
    edit ??= { expect: {}, set: {} };
    put(edit.expect, k, d[k]);
    put(edit.set, k, e.edit!.set[k]);
  }
  if (!move && !edit) return null;
  return { ...e, move, edit, req: null, status: 'queued', attempts: 0, error: undefined, rejected: undefined, theirs: undefined };
};

/**
 * Drop parts that no longer change anything (the user changed their mind before
 * it was sent). Not while a request is outstanding: it may already have applied,
 * and the follow-up has to put things back.
 */
const normalize = (e: SyncEntry): SyncEntry | null => {
  if (e.req || e.status === 'saving') return e;
  const move = e.move && e.move.from !== e.move.to ? e.move : undefined;
  let edit: SyncEntry['edit'];
  for (const k of fieldKeys(e.edit?.set)) {
    if (e.edit!.set[k] === e.edit!.expect[k]) continue;
    edit ??= { expect: {}, set: {} };
    put(edit.expect, k, e.edit!.expect[k]);
    put(edit.set, k, e.edit!.set[k]);
  }
  if (!move && !edit) return null;
  return { ...e, move, edit };
};

const buildRequest = (e: SyncEntry): PendingRequest => ({
  mutationId: uid('mut'),
  ...(e.move && e.move.from !== e.move.to ? { move: e.move } : {}),
  ...(e.edit && fieldKeys(e.edit.set).length ? { edit: e.edit } : {}),
});

/**
 * Fold a new intent into the deal's entry. Latest intent wins per part; each part
 * keeps the precondition from when the user first changed it.
 */
const mergeIntent = (
  prev: SyncEntry | undefined,
  truth: Deal,
  it: Intent,
  lane: SyncEntry['lane'],
  jobId: string | null,
  now: number,
): SyncEntry | null => {
  // A deal whose last change failed or clashed shows the server's copy, so a new
  // action on it starts from that copy and replaces the unsaved change.
  const fresh = !prev || prev.status === 'failed' || prev.status === 'conflict';
  const base: SyncEntry = fresh
    ? { dealId: it.id, status: 'queued', req: null, attempts: 0, retryAt: 0, lane, jobId, changedAt: now }
    : { ...prev, changedAt: now, lane: lane === 'bulk' ? 'bulk' : prev.lane, jobId: jobId ?? prev.jobId };
  let { move, edit } = base;
  if (it.to) move = { from: move?.from ?? truth.stage, to: it.to, ...(isClosed(it.to) && it.close ? { close: it.close } : {}) };
  if (it.set) {
    const expect = { ...edit?.expect };
    const set = { ...edit?.set };
    for (const k of fieldKeys(it.set)) {
      if (!(k in expect)) put(expect, k, truth[k]);
      put(set, k, it.set[k]);
    }
    edit = { expect, set };
  }
  return normalize({ ...base, move, edit });
};

export function createPipelineStore(api: PipelineApi, options: PipelineOptions = {}) {
  const opt = {
    autoRetry: () => true,
    maxAutoRetries: 2,
    backoffMs: (attempt: number) => 600 * 2 ** (attempt - 1) + Math.random() * 300,
    interactiveChunk: 50,
    bulkChunk: 500,
    maxInFlight: 4,
    maxBulkInFlight: 3,
    confirmThreshold: 20,
    bulkLaneThreshold: 50,
    remoteFlushMs: 200,
    offlineProbeMs: 2000,
    ...options,
  };

  // ---- engine-private state (not rendered) ----
  let inFlight = 0;
  let inFlightBulk = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeAt = Infinity;
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  let remoteBuffer: ServerEvent[] = [];
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;
  let visibleIds: string[] = [];
  let announceSeq = 0;
  // Counts at the last settle(): a failure/conflict toast re-appears only when these grow.
  let lastFailed = 0;
  let lastConflicts = 0;
  let disposed = false;

  const store = createStore<Pipeline>()((set, get) => {
    // ---------- helpers ----------
    const bump = (extra: Partial<PipelineState> = {}) =>
      set((s) => ({ dataRev: s.dataRev + 1, syncRev: s.syncRev + 1, ...extra }));

    const announce = (text: string, urgent = false) => ({ announcement: { text, id: ++announceSeq, urgent } });

    const upsertToast = (toasts: Toast[], t: Omit<Toast, 'createdAt'>): Toast[] => {
      const next = { ...t, createdAt: Date.now() };
      const i = toasts.findIndex((x) => x.id === t.id);
      if (i === -1) return [...toasts.slice(-4), next];
      if (toasts[i].title === t.title && toasts[i].detail === t.detail && t.id !== 'move') return toasts;
      const copy = toasts.slice();
      copy[i] = next;
      return copy;
    };
    const removeToast = (toasts: Toast[], id: string) =>
      toasts.some((t) => t.id === id) ? toasts.filter((t) => t.id !== id) : toasts;

    const company = (id: string) => get().display.get(id)?.company ?? id;

    /** Recompute what the UI shows for these deals (server truth + optimistic overlay). */
    const refreshDisplay = (ids: Iterable<string>) => {
      const { server, display, entries } = get();
      for (const id of ids) {
        const s = server.get(id);
        if (!s) {
          display.delete(id);
          continue;
        }
        const e = entries.get(id);
        if (!e || !PENDING_STATUSES.has(e.status)) {
          display.set(id, s);
          continue;
        }
        let d = s;
        if (e.move && e.move.to !== s.stage) {
          d = {
            ...s,
            stage: e.move.to,
            close: isClosed(e.move.to) ? cleanClose(e.move.close) : undefined,
            stageEnteredAt: e.changedAt,
            lastActivityAt: Math.max(s.lastActivityAt, e.changedAt),
          };
        }
        for (const k of fieldKeys(e.edit?.set)) {
          if (d[k] === e.edit!.set[k]) continue;
          if (d === s) d = { ...s };
          put(d, k, e.edit!.set[k]);
        }
        display.set(id, d);
      }
    };

    /**
     * Keep the visible list stable.
     *  - local (my own action / its rollback): rows leave or re-enter immediately; that is feedback.
     *  - remote (teammates): never reorder or remove. Rows that stop matching are greyed
     *    out in place; newly matching deals wait behind the "N updates" pill.
     */
    const reconcileView = (
      changed: string[],
      origin: 'local' | 'remote',
      prevStage?: Map<string, StageId>,
    ): Partial<PipelineState> => {
      if (!changed.length) return {};
      const s = get();
      const v = s.view;
      const q = v.query;
      const now = Date.now();
      let departed = v.departed;
      let pendingNew = v.pendingNew;
      let heldStage = v.heldStage;
      let removed: Set<string> | null = null;
      const inserts: string[] = [];
      const cowDeparted = () => (departed === v.departed ? (departed = new Map(departed)) : departed);
      const cowPending = () => (pendingNew === v.pendingNew ? (pendingNew = new Set(pendingNew)) : pendingNew);
      const cowHeld = () => (heldStage === v.heldStage ? (heldStage = new Map(heldStage)) : heldStage);

      for (const id of changed) {
        const d = s.display.get(id);
        const m = !!d && matches(d, q, now);
        const inList = v.index.has(id);
        if (origin === 'local') {
          if (inList && !m) (removed ??= new Set()).add(id);
          else if (!inList && m) inserts.push(id);
          if (departed.has(id)) cowDeparted().delete(id);
          if (pendingNew.has(id)) cowPending().delete(id);
          if (heldStage.has(id)) cowHeld().delete(id); // my own move: the card goes where I put it
          continue;
        }
        // Teammate moved a card I can see: keep it in its old board column until refresh.
        const prev = prevStage?.get(id);
        if (inList && d && prev && prev !== d.stage) {
          if (!heldStage.has(id)) cowHeld().set(id, prev);
          else if (heldStage.get(id) === d.stage) cowHeld().delete(id);
        }
        if (inList && !m) {
          if (!departed.has(id)) cowDeparted().set(id, { by: d?.updatedBy ?? '', at: now });
        } else if (inList && m) {
          if (departed.has(id)) cowDeparted().delete(id);
        } else if (m) {
          if (!pendingNew.has(id)) cowPending().add(id);
        } else if (pendingNew.has(id)) {
          cowPending().delete(id);
        }
      }

      if (!removed && !inserts.length) {
        return departed !== v.departed || pendingNew !== v.pendingNew || heldStage !== v.heldStage
          ? { view: { ...v, departed, pendingNew, heldStage } }
          : {};
      }

      const ids = removed ? v.ids.filter((id) => !removed!.has(id)) : v.ids.slice();
      for (const id of inserts) {
        const d = s.display.get(id)!;
        ids.splice(
          insertionIndex(ids, d, (x) => s.display.get(x), q, now),
          0,
          id,
        );
      }
      const index = buildIndex(ids);

      // If the focused row left, focus whatever slid into its place.
      let focusId = s.focusId;
      if (focusId && !index.has(focusId)) {
        const old = v.index.get(focusId) ?? 0;
        focusId = ids.length ? ids[Math.min(old, ids.length - 1)] : null;
      }
      let selection = s.selection;
      if (removed && [...selection].some((id) => removed!.has(id))) {
        selection = new Set([...selection].filter((id) => !removed!.has(id)));
      }
      return { view: { ...v, ids, index, departed, pendingNew, heldStage }, focusId, selection };
    };

    const jobSaved = (jobId: string | null) => {
      if (!jobId) return;
      const j = get().jobs.get(jobId);
      if (j) get().jobs.set(jobId, { ...j, saved: j.saved + 1 });
    };

    /** Finish jobs with nothing pending; keep failure/conflict toasts in sync with reality. */
    const settle = (toasts: Toast[]): { toasts: Toast[]; ann?: ReturnType<typeof announce> } => {
      const { entries, jobs } = get();
      let failed = 0;
      let conflicts = 0;
      let firstFailed: SyncEntry | null = null;
      let firstConflict: SyncEntry | null = null;
      const pendingByJob = new Map<string, number>();
      const failedByJob = new Map<string, number>();
      for (const e of entries.values()) {
        if (e.status === 'failed') {
          failed++;
          firstFailed ??= e;
        } else if (e.status === 'conflict') {
          conflicts++;
          firstConflict ??= e;
        }
        if (e.jobId) {
          if (PENDING_STATUSES.has(e.status)) pendingByJob.set(e.jobId, (pendingByJob.get(e.jobId) ?? 0) + 1);
          else failedByJob.set(e.jobId, (failedByJob.get(e.jobId) ?? 0) + 1);
        }
      }
      let ann: ReturnType<typeof announce> | undefined;
      for (const j of jobs.values()) {
        if (j.finishedAt || pendingByJob.get(j.id)) continue;
        jobs.set(j.id, { ...j, finishedAt: Date.now() });
        const notSaved = failedByJob.get(j.id) ?? 0;
        toasts = upsertToast(toasts, {
          id: `job-${j.id}`,
          kind: notSaved ? 'error' : 'success',
          title:
            notSaved || j.cancelled
              ? `${j.label}: ${formatCount(j.saved)} of ${formatCount(j.total)} saved`
              : `${j.label}. All saved.`,
          detail: notSaved
            ? `${plural(notSaved, 'deal')} not saved. They are back where they were.`
            : j.cancelled
              ? `${formatCount(j.cancelled)} cancelled and left where they were.`
              : undefined,
          actions: [
            ...(j.undoable && j.saved > 0 ? [{ label: 'Undo', run: 'undo' as const, key: 'Z' }] : []),
            ...(notSaved ? [{ label: 'Review', run: 'openAttention' as const, key: 'A' }] : []),
          ],
          sticky: notSaved > 0,
        });
        ann = announce(`${j.label}: ${j.saved} saved${notSaved ? `, ${notSaved} not saved` : ''}`, notSaved > 0);
        if (!notSaved) toasts = removeToast(toasts, 'move');
      }

      const hasToast = (id: string) => toasts.some((t) => t.id === id);
      const showFailed = failed > lastFailed || (failed > 0 && hasToast('failed'));
      const showConflict = conflicts > lastConflicts || (conflicts > 0 && hasToast('conflict'));
      lastFailed = failed;
      lastConflicts = conflicts;
      if (failed === 0) toasts = removeToast(toasts, 'failed');
      else if (showFailed) {
        const d = firstFailed ? get().server.get(firstFailed.dealId) : undefined;
        toasts = upsertToast(toasts, {
          id: 'failed',
          kind: 'error',
          title: failed === 1 && d ? `Couldn't save ${d.company}` : `${plural(failed, 'change')} not saved`,
          detail:
            failed === 1 && d && firstFailed
              ? firstFailed.rejected
                ? `${capitalize(describeEntry(firstFailed))} was refused: ${firstFailed.error}.`
                : `${capitalize(describeEntry(firstFailed))} failed.${firstFailed.move ? ` It's still in ${stageLabel(d.stage)}.` : ''}`
              : 'Those deals are shown as the server has them.',
          actions: [
            ...(failed === 1 && firstFailed?.rejected
              ? []
              : [{ label: failed === 1 ? 'Retry' : 'Retry all', run: 'retryFailed' as const, key: '⇧R' }]),
            { label: 'Review', run: 'openAttention', key: 'A' },
          ],
          sticky: true,
        });
      }
      if (conflicts === 0) toasts = removeToast(toasts, 'conflict');
      else if (showConflict) {
        const e = firstConflict!;
        toasts = upsertToast(toasts, {
          id: 'conflict',
          kind: 'conflict',
          title:
            conflicts === 1 && e.theirs
              ? `${ownerFirstName(e.theirs.by)} ${theirsText(e.theirs, company(e.dealId))} first`
              : `${plural(conflicts, 'change')} clashed with teammates' changes`,
          detail:
            conflicts === 1
              ? e.move && !e.edit
                ? `Your ${describeEntry(e)} was not applied.`
                : `Your change (${describeEntry(e)}) was not applied.`
              : 'Nothing was overwritten. Pick what to keep.',
          actions: [{ label: 'Resolve', run: 'openAttention', key: 'A' }],
          sticky: true,
        });
      }
      return { toasts, ann };
    };

    // ---------- sync engine ----------
    const scheduleFlush = (delay = 0) => {
      if (disposed || flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, delay);
    };

    const scheduleWake = (at: number) => {
      if (at >= wakeAt) return;
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeAt = at;
      wakeTimer = setTimeout(
        () => {
          wakeTimer = null;
          wakeAt = Infinity;
          flush();
        },
        Math.max(0, at - Date.now()),
      );
    };

    const flush = () => {
      if (disposed || paused || get().status !== 'ready') return;
      const now = Date.now();
      const interactive: SyncEntry[] = [];
      const bulk: SyncEntry[] = [];
      let nextRetry = Infinity;
      for (const e of get().entries.values()) {
        if (e.status === 'queued' || (e.status === 'retrying' && e.retryAt <= now)) {
          (e.lane === 'bulk' ? bulk : interactive).push(e);
        } else if (e.status === 'retrying') nextRetry = Math.min(nextRetry, e.retryAt);
      }
      // Interactive lane first: a single move never waits behind a 10k-deal job.
      while (inFlight < opt.maxInFlight && interactive.length) send(interactive.splice(0, opt.interactiveChunk), 'interactive');
      while (inFlight < opt.maxInFlight && inFlightBulk < opt.maxBulkInFlight && bulk.length)
        send(bulk.splice(0, opt.bulkChunk), 'bulk');
      if (nextRetry < Infinity) scheduleWake(nextRetry);
    };

    const send = (chunk: SyncEntry[], lane: 'interactive' | 'bulk') => {
      const { entries } = get();
      const sent = chunk.map((e) => {
        const req = e.req ?? buildRequest(e);
        const next: SyncEntry = { ...e, req, status: 'saving' };
        entries.set(e.dealId, next);
        return next;
      });
      inFlight++;
      if (lane === 'bulk') inFlightBulk++;
      set((s) => ({ syncRev: s.syncRev + 1 }));
      api
        .saveDeals(sent.map((e) => ({ ...e.req!, dealId: e.dealId })))
        .then(
          (results) => onResults(results),
          (err) => onError(sent, err),
        )
        .finally(() => {
          inFlight--;
          if (lane === 'bulk') inFlightBulk--;
          scheduleFlush();
        })
        .catch((err) => console.error('[sync] unexpected error while applying results', err));
    };

    const acceptServerDeal = (deal: Deal) => {
      const { server } = get();
      const cur = server.get(deal.id);
      if (!cur || deal.version > cur.version) server.set(deal.id, deal);
    };

    const onResults = (results: MutationResult[]) => {
      if (disposed) return;
      const { entries } = get();
      const changed: string[] = [];
      let saved = 0;
      let lastSavedId: string | null = null;
      let refused = 0;
      for (const r of results) {
        if (r.ok || r.reason === 'conflict') acceptServerDeal(r.deal);
        changed.push(r.dealId);
        const e = entries.get(r.dealId);
        if (!e || e.req?.mutationId !== r.mutationId) continue; // superseded
        if (r.ok) {
          // Judge against what *our* request left behind, not a newer teammate copy:
          // a follow-up then expects that state, so it clashes instead of overwriting them.
          if (isSatisfied(e, r.deal)) {
            entries.delete(r.dealId);
            jobSaved(e.jobId);
            saved++;
            lastSavedId = r.dealId;
          } else {
            // User changed their mind while this was in flight: send the follow-up.
            const next = rebase(e, r.deal);
            if (next) entries.set(r.dealId, next);
            else entries.delete(r.dealId);
          }
        } else if (r.reason === 'conflict') {
          refused++;
          entries.set(r.dealId, { ...e, req: null, status: 'conflict', theirs: theirsOf(r.deal, r.stale) });
        } else if (r.reason === 'invalid') {
          // The server refused the request itself. Resending it can't help, so no retries.
          refused++;
          entries.set(r.dealId, { ...e, req: null, status: 'failed', error: r.message, rejected: true });
        } else {
          entries.delete(r.dealId);
        }
      }
      refreshDisplay(changed);
      const viewPatch = reconcileView(changed, 'local');
      // The optimistic "Moved X → Y · Undo" toast is no longer true; the conflict/failure toast replaces it.
      const { toasts, ann } = settle(refused ? removeToast(get().toasts, 'move') : get().toasts);
      const single = results.length === 1 && saved === 1 && lastSavedId;
      bump({
        ...viewPatch,
        toasts,
        ...(ann ?? (single ? announce(`${company(lastSavedId!)} saved`) : {})),
      });
    };

    const onError = (sent: SyncEntry[], err: unknown) => {
      if (disposed) return;
      const offline = err instanceof ApiError && err.kind === 'offline';
      const message = err instanceof Error ? err.message : 'Save failed';
      const { entries } = get();
      const now = Date.now();
      const rolledBack: string[] = [];
      for (const s of sent) {
        const e = entries.get(s.dealId);
        if (!e || e.req?.mutationId !== s.req!.mutationId) continue;
        if (offline) {
          entries.set(e.dealId, { ...e, status: 'waiting' });
          continue;
        }
        const attempts = e.attempts + 1;
        if (opt.autoRetry() && attempts <= opt.maxAutoRetries) {
          entries.set(e.dealId, { ...e, attempts, status: 'retrying', retryAt: now + opt.backoffMs(attempts), error: message });
        } else {
          entries.set(e.dealId, { ...e, attempts, status: 'failed', error: message });
          rolledBack.push(e.dealId);
        }
      }
      if (offline) goOffline();
      refreshDisplay(rolledBack);
      const viewPatch = reconcileView(rolledBack, 'local');
      const { toasts, ann } = settle(rolledBack.length ? removeToast(get().toasts, 'move') : get().toasts);
      bump({
        ...viewPatch,
        toasts,
        ...(ann ??
          (rolledBack.length
            ? announce(
                rolledBack.length === 1
                  ? `Couldn't save ${company(rolledBack[0])}. It is back in ${stageLabel(get().display.get(rolledBack[0])!.stage)}.`
                  : `${rolledBack.length} changes were not saved`,
                true,
              )
            : {})),
      });
      scheduleFlush();
    };

    const goOffline = () => {
      if (paused) return;
      paused = true;
      set({ online: false, ...announce('Connection lost. Changes will be saved when it is back.', true) });
      probeTimer = setInterval(() => {
        api.ping().then(goOnline, () => {});
      }, opt.offlineProbeMs);
    };

    const goOnline = () => {
      if (!paused) return;
      paused = false;
      if (probeTimer) clearInterval(probeTimer);
      probeTimer = null;
      const { entries } = get();
      for (const e of entries.values()) if (e.status === 'waiting') entries.set(e.dealId, { ...e, status: 'queued' });
      bump({ online: true, ...announce('Back online. Saving your changes.') });
      scheduleFlush();
    };

    // ---------- teammates' changes ----------
    const onEvents = (events: ServerEvent[]) => {
      remoteBuffer.push(...events);
      if (!remoteTimer) remoteTimer = setTimeout(applyRemote, opt.remoteFlushMs);
    };

    const applyRemote = () => {
      remoteTimer = null;
      if (disposed || get().status !== 'ready') return; // load() drains the buffer
      const events = remoteBuffer;
      remoteBuffer = [];
      const { server, entries, remoteMarks } = get();
      const now = Date.now();
      const changed: string[] = [];
      const prevStage = new Map<string, StageId>();
      const { display } = get();
      for (const ev of events) {
        const cur = server.get(ev.deal.id);
        if (cur && ev.deal.version <= cur.version) continue; // echo of our own save, or out of order
        const shown = display.get(ev.deal.id);
        if (shown && !prevStage.has(ev.deal.id)) prevStage.set(ev.deal.id, shown.stage);
        server.set(ev.deal.id, ev.deal);
        changed.push(ev.deal.id);
        if (ev.actor !== ME.id) remoteMarks.set(ev.deal.id, { by: ev.actor, at: now, change: ev.change });
        const e = entries.get(ev.deal.id);
        if (e && e.status !== 'saving') {
          if (isSatisfied(e, ev.deal)) {
            // Already what we wanted (a teammate made the same change, or our "lost reply" save landed).
            entries.delete(e.dealId);
            jobSaved(e.jobId);
          } else if (e.status === 'conflict') {
            const stale = staleParts(e, ev.deal);
            if (stale.length) entries.set(e.dealId, { ...e, theirs: theirsOf(ev.deal, stale) });
          }
        }
      }
      if (!changed.length) return;
      if (remoteMarks.size > 5000) {
        // Marks only drive a few seconds of highlight; drop old ones so the map stays small.
        for (const [id, m] of remoteMarks) if (now - m.at > 30_000) remoteMarks.delete(id);
      }
      refreshDisplay(changed);
      const viewPatch = reconcileView(changed, 'remote', prevStage);
      const { toasts, ann } = settle(get().toasts);
      bump({ ...viewPatch, toasts, ...(ann ?? {}) });
    };

    const unsubscribe = api.subscribe(onEvents);

    // ---------- moves ----------
    const resolveTargets = (): string[] => {
      const s = get();
      if (s.selection.size) return [...s.selection];
      return s.focusId ? [s.focusId] : [];
    };

    const buildConfirm = (moves: MoveIntent[], label: string, to: StageId | null, skippedChanged: number) => {
      const { display } = get();
      let value = 0;
      const byStage: Partial<Record<StageId, number>> = {};
      for (const m of moves) {
        const d = display.get(m.id);
        if (!d) continue;
        value += d.value;
        byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
      }
      // UI moves have one closing destination at most (a single target, or "next stage" → Won).
      const closingMoves = moves.filter((m) => isClosed(m.to));
      const closing = (closingMoves[0]?.to ?? null) as 'won' | 'lost' | null;
      return { moves, label, to, value, byStage, skippedChanged, closing, closingCount: closingMoves.length };
    };

    /**
     * Drop deals a teammate changed after the user picked them: greyed rows (no longer
     * match) and board cards held in a column they have already left.
     */
    const withoutDeparted = (ids: string[]) => {
      const { view, display } = get();
      if (!view.departed.size && !view.heldStage.size) return { ids, skipped: 0 };
      const kept = ids.filter((id) => {
        if (view.departed.has(id)) return false;
        const held = view.heldStage.get(id);
        return !held || held === display.get(id)?.stage;
      });
      return { ids: kept, skipped: ids.length - kept.length };
    };

    const skippedToast = (skipped: number, verb: 'moved' | 'changed') =>
      set((st) => ({
        toasts: upsertToast(st.toasts, {
          id: 'skipped',
          kind: 'info',
          title:
            skipped === 1
              ? 'A teammate changed this deal after you loaded it'
              : 'Teammates changed these deals after you loaded them',
          detail: `Nothing was ${verb}. Refresh to see where they are now, then try again.`,
          actions: [{ label: 'Refresh', run: 'refresh', key: 'U' }],
        }),
        ...announce('Those deals were changed by teammates. Refresh the view first.'),
      }));

    /**
     * Every change goes through here: moves, close details, field edits, undo.
     * It updates entries (optimistically), the stable list, the undo stack and the toast.
     */
    const startChanges = (intents: Intent[], label: string, record = true) => {
      const s = get();
      const { display, server, entries } = s;
      const now = Date.now();
      const isBulk = intents.length > opt.bulkLaneThreshold;
      const jobId = isBulk ? uid('job') : null;
      const lane = isBulk ? 'bulk' : 'interactive';
      const changed: string[] = [];
      const undoItems: UndoItem[] = [];
      let nothingToSend = 0; // reverted before it was sent: done already
      for (const it of intents) {
        const shown = display.get(it.id);
        const truth = server.get(it.id);
        if (!shown || !truth) continue;
        // Only what differs from what the user sees counts as a change.
        const to = it.to && it.to !== shown.stage ? it.to : undefined;
        let values: FieldValues | undefined;
        for (const k of fieldKeys(it.set)) if (shown[k] !== it.set![k]) put((values ??= {}), k, it.set![k]);
        if (!to && !values) continue;
        const item: UndoItem = { dealId: it.id };
        if (to) item.move = { from: shown.stage, to, fromClose: shown.close };
        if (values) item.edit = { before: pickFields(shown, fieldKeys(values)), after: values };
        undoItems.push(item);
        changed.push(it.id);
        const next = mergeIntent(entries.get(it.id), truth, { id: it.id, to, close: it.close, set: values }, lane, jobId, now);
        if (next) entries.set(it.id, next);
        else {
          entries.delete(it.id);
          nothingToSend++;
        }
      }
      if (!changed.length) {
        set(announce('Nothing to change'));
        return;
      }
      if (jobId) {
        const job: Job = {
          id: jobId,
          label,
          total: changed.length,
          saved: nothingToSend,
          cancelled: 0,
          startedAt: now,
          undoable: record,
        };
        s.jobs.set(jobId, job);
      }
      refreshDisplay(changed);
      const viewPatch = reconcileView(changed, 'local');
      const first = changed.length === 1 ? display.get(changed[0]) : undefined;
      const one = first ? undoItems[0] : undefined;
      const oneText = one
        ? describeEntry({
            move: one.move && { from: one.move.from, to: one.move.to, close: first!.close },
            edit: one.edit && { expect: one.edit.before, set: one.edit.after },
          })
        : '';
      const title = first
        ? one!.move && !one!.edit
          ? `${first.company} → ${stageLabel(first.stage)}${first.close?.reason ? ` · ${LOST_REASON_BY_ID[first.close.reason].short}` : ''}`
          : `${first.company}: ${oneText}`
        : isBulk
          ? label.replace(/^Moved/, 'Moving').replace(/^Updated/, 'Updating')
          : label;
      const recordLabel = first ? `${oneText} on ${first.company}` : label;
      const toasts = upsertToast(s.toasts, {
        id: 'move',
        kind: 'info',
        title,
        detail: isBulk ? 'Saving in the background. You can keep working.' : undefined,
        actions: [
          ...(record ? [{ label: 'Undo', run: 'undo' as const, key: 'Z' }] : []),
          ...(jobId ? [{ label: 'Stop', run: 'cancelJob' as const, arg: jobId }] : []),
        ],
      });
      bump({
        ...viewPatch,
        selection: new Set(),
        anchorId: null,
        toasts,
        undoStack: record ? [...s.undoStack.slice(-19), { label: recordLabel, items: undoItems }] : s.undoStack,
        ...announce(first ? `${capitalize(oneText)} on ${first.company}. Saving.` : `${label}. Saving.`),
      });
      scheduleFlush();
    };

    const describeMove = (count: number, to: StageId | null) =>
      to ? `Move ${plural(count, 'deal')} to ${stageLabel(to)}` : `Move ${plural(count, 'deal')} forward`;

    const proposeMoves = (moves: MoveIntent[], to: StageId | null, skipped: number) => {
      if (!moves.length) {
        if (skipped) skippedToast(skipped, 'moved');
        else set(announce('Nothing to move'));
        return;
      }
      const label = describeMove(moves.length, to).replace(/^Move/, 'Moved');
      // Closing a deal always goes through the dialog: Lost needs a reason, Won offers a note.
      if (moves.length > opt.confirmThreshold || moves.some((m) => isClosed(m.to))) {
        set({ confirm: buildConfirm(moves, label, to, skipped), panel: null });
      } else {
        startChanges(moves, label);
      }
    };

    // ---------- the store ----------
    return {
      status: 'idle',
      server: new Map(),
      display: new Map(),
      entries: new Map(),
      jobs: new Map(),
      remoteMarks: new Map(),
      dataRev: 0,
      syncRev: 0,
      online: true,
      view: emptyView(),
      selection: new Set(),
      anchorId: null,
      focusId: null,
      toasts: [],
      announcement: { text: '', id: 0, urgent: false },
      undoStack: [],
      confirm: null,
      editing: null,
      panel: null,
      layout: 'table',

      async load() {
        set({ status: 'loading', loadError: undefined });
        try {
          const deals = await api.fetchDeals();
          const { server, display } = get();
          for (const d of deals) {
            acceptServerDeal(d);
          }
          for (const [id, d] of server) display.set(id, d);
          const now = Date.now();
          const q = get().view.query;
          const ids = computeIds(display.values(), q, now);
          set((st) => ({
            status: 'ready',
            dataRev: st.dataRev + 1,
            view: { ...emptyView(q), ids, index: buildIndex(ids), computedAt: now },
            focusId: ids[0] ?? null,
          }));
          if (remoteBuffer.length) applyRemote();
        } catch (err) {
          set({ status: 'error', loadError: err instanceof Error ? err.message : 'Could not load deals' });
        }
      },

      dispose() {
        disposed = true;
        unsubscribe();
        for (const t of [flushTimer, wakeTimer, remoteTimer]) if (t) clearTimeout(t);
        if (probeTimer) clearInterval(probeTimer);
      },

      // ----- view -----
      setQuery(patch) {
        const s = get();
        const q = { ...s.view.query, ...patch };
        if (sameQuery(q, s.view.query)) return;
        const now = Date.now();
        const ids = computeIds(s.display.values(), q, now);
        const index = buildIndex(ids);
        const tabChanged = q.tab !== s.view.query.tab;
        set({
          view: { ...emptyView(q), ids, index, computedAt: now },
          selection: new Set(),
          anchorId: null,
          focusId: !tabChanged && s.focusId && index.has(s.focusId) ? s.focusId : (ids[0] ?? null),
        });
      },
      setTab(tab) {
        get().setQuery({ tab });
      },
      cycleTab(dir) {
        const i = TABS.indexOf(get().view.query.tab);
        get().setTab(TABS[(i + dir + TABS.length) % TABS.length]);
      },
      toggleSort(key) {
        const { sort } = get().view.query;
        const dir =
          sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'company' || key === 'owner' ? 'asc' : 'desc';
        get().setQuery({ sort: { key, dir } });
      },
      refreshView() {
        const s = get();
        const now = Date.now();
        const ids = computeIds(s.display.values(), s.view.query, now);
        const index = buildIndex(ids);
        let focusId = s.focusId;
        if (focusId && !index.has(focusId)) {
          const old = s.view.index.get(focusId) ?? 0;
          focusId = ids[Math.min(old, ids.length - 1)] ?? null;
        }
        const selection = new Set([...s.selection].filter((id) => index.has(id)));
        set({
          view: { ...emptyView(s.view.query), ids, index, computedAt: now },
          focusId,
          selection,
          ...announce(`View refreshed. ${plural(ids.length, 'deal')}.`),
        });
      },

      // ----- focus & selection -----
      setFocus(id) {
        set({ focusId: id });
      },
      moveFocus(delta, extend = false) {
        const s = get();
        const { ids, index } = s.view;
        if (!ids.length) return;
        const cur = s.focusId ? (index.get(s.focusId) ?? 0) : -1;
        const nextIdx = Math.max(0, Math.min(ids.length - 1, cur + delta));
        const focusId = ids[nextIdx];
        if (!extend) {
          set({ focusId });
          return;
        }
        // Shift+arrow: add every row we pass over (and the starting one) to the selection.
        const sel = new Set(s.selection);
        const from = Math.max(0, Math.min(cur, nextIdx));
        const to = Math.max(cur, nextIdx);
        for (let i = from; i <= to; i++) sel.add(ids[i]);
        set({ focusId, selection: sel, anchorId: s.anchorId ?? s.focusId });
      },
      focusEdge(edge) {
        const { ids } = get().view;
        set({ focusId: (edge === 'first' ? ids[0] : ids[ids.length - 1]) ?? null });
      },
      toggleSelect(id) {
        const s = get();
        const target = id ?? s.focusId;
        if (!target) return;
        const sel = new Set(s.selection);
        if (sel.has(target)) sel.delete(target);
        else sel.add(target);
        set({ selection: sel, anchorId: target });
      },
      selectRange(toId) {
        const s = get();
        const { ids, index } = s.view;
        const anchor = s.anchorId ?? s.focusId ?? toId;
        const a = index.get(anchor) ?? 0;
        const b = index.get(toId) ?? 0;
        const sel = new Set(s.selection);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(ids[i]);
        set({ selection: sel, focusId: toId });
      },
      selectAll() {
        const s = get();
        const ids = s.view.ids.filter((id) => !s.view.departed.has(id));
        set({ selection: new Set(ids), ...announce(`Selected all ${plural(ids.length, 'deal')} in this view`) });
      },
      setSelection(ids) {
        set({ selection: new Set(ids) });
      },
      setLayout(layout) {
        const s = get();
        if (s.layout === layout) return;
        // The board shows stages as columns, so a single-stage tab becomes "All open".
        if (layout === 'board' && s.view.query.tab !== 'focus' && s.view.query.tab !== 'open') {
          const keep = s.focusId;
          s.setQuery({ tab: 'open' });
          if (keep && get().view.index.has(keep)) set({ focusId: keep });
        }
        set({ layout, panel: null, ...announce(layout === 'board' ? 'Board view' : 'Table view') });
      },
      clearSelection() {
        if (get().selection.size) set({ selection: new Set(), anchorId: null, ...announce('Selection cleared') });
      },

      // ----- moves -----
      requestMove(to, explicit) {
        const { ids, skipped } = withoutDeparted(explicit ?? resolveTargets());
        const display = get().display;
        const moves = ids.filter((id) => display.get(id)?.stage !== to).map((id) => ({ id, to }));
        proposeMoves(moves, to, skipped);
      },
      requestAdjacentMove(dir, explicit) {
        const { ids, skipped } = withoutDeparted(explicit ?? resolveTargets());
        const display = get().display;
        const moves: MoveIntent[] = [];
        for (const id of ids) {
          const d = display.get(id);
          const to = d && adjacentStage(d.stage, dir);
          if (to) moves.push({ id, to });
        }
        const single = moves.length && moves.every((m) => m.to === moves[0].to) ? moves[0].to : null;
        proposeMoves(moves, single, skipped);
      },
      moveDeals(moves, label) {
        startChanges(moves, label ?? describeMove(moves.length, null).replace(/^Move/, 'Moved'));
      },
      confirmMove(close) {
        const c = get().confirm;
        if (!c) return null;
        const problem = c.closing ? closeProblem(c.closing, close) : null;
        if (problem) {
          set(announce(problem, true));
          return problem;
        }
        const details = c.closing ? cleanClose(close) : undefined;
        const why = details?.reason ? ` (${LOST_REASON_BY_ID[details.reason].short})` : '';
        set({ confirm: null });
        startChanges(
          c.moves.map((m) => (m.to === c.closing ? { ...m, close: details } : m)),
          `${c.label}${why}`,
        );
        return null;
      },
      cancelConfirm() {
        set({ confirm: null, ...announce('Move cancelled') });
      },
      openEdit(explicit) {
        const { ids, skipped } = withoutDeparted(explicit ?? resolveTargets());
        if (!ids.length) {
          if (skipped) skippedToast(skipped, 'changed');
          else set(announce('Nothing to edit'));
          return;
        }
        set({ editing: { ids, skippedChanged: skipped }, panel: null });
      },
      applyEdit(spec) {
        const ed = get().editing;
        if (!ed) return;
        const { display } = get();
        const now = Date.now();
        const edits: Intent[] = [];
        for (const id of ed.ids) {
          const d = display.get(id);
          if (!d) continue;
          const values: FieldValues = {};
          if (spec.ownerId) values.ownerId = spec.ownerId;
          // A shift is per deal: each keeps its own date, moved by the same number of days.
          if (spec.closeDate) values.closeDate = closeDateFor(spec.closeDate, d.closeDate, now);
          edits.push({ id, set: values });
        }
        set({ editing: null });
        const what = editSpecText(spec, now);
        if (!what) {
          set(announce('Nothing to change'));
          return;
        }
        startChanges(edits, `Updated ${plural(edits.length, 'deal')}: ${what}`);
      },
      cancelEdit() {
        set({ editing: null, ...announce('Edit cancelled') });
      },
      editDeals(edits, label) {
        startChanges(edits, label ?? `Updated ${plural(edits.length, 'deal')}`);
      },
      undo() {
        const s = get();
        const rec = s.undoStack[s.undoStack.length - 1];
        if (!rec) {
          set(announce('Nothing to undo'));
          return;
        }
        set({ undoStack: s.undoStack.slice(0, -1) });
        // Only put back what is still ours: a teammate may have changed it since.
        const intents: Intent[] = [];
        for (const it of rec.items) {
          const d = s.display.get(it.dealId);
          if (!d) continue;
          const back: Intent = { id: it.dealId };
          if (it.move && d.stage === it.move.to) {
            back.to = it.move.from;
            back.close = it.move.fromClose; // a Lost deal gets its old reason back
          }
          for (const k of fieldKeys(it.edit?.after))
            if (d[k] === it.edit!.after[k]) put((back.set ??= {}), k, it.edit!.before[k]);
          if (back.to || back.set) intents.push(back);
        }
        startChanges(intents, `Undo: ${rec.label}`, false);
      },
      retry(id) {
        const { entries } = get();
        const e = entries.get(id);
        if (!e || e.status !== 'failed') return;
        if (e.rejected) {
          set(announce(`Can't retry: ${e.error}. Make the change again or discard it.`, true));
          return;
        }
        entries.set(id, { ...e, status: 'queued', attempts: 0, error: undefined, changedAt: Date.now() });
        refreshDisplay([id]);
        const viewPatch = reconcileView([id], 'local');
        bump({ ...viewPatch, toasts: settle(get().toasts).toasts, ...announce(`Retrying ${company(id)}`) });
        scheduleFlush();
      },
      retryAllFailed() {
        const { entries } = get();
        const ids: string[] = [];
        for (const e of entries.values())
          if (e.status === 'failed' && !e.rejected) {
            entries.set(e.dealId, { ...e, status: 'queued', attempts: 0, error: undefined });
            ids.push(e.dealId);
          }
        if (!ids.length) return;
        refreshDisplay(ids);
        const viewPatch = reconcileView(ids, 'local');
        bump({ ...viewPatch, toasts: settle(get().toasts).toasts, ...announce(`Retrying ${plural(ids.length, 'change')}`) });
        scheduleFlush();
      },
      discard(id) {
        const { entries } = get();
        const e = entries.get(id);
        if (!e || (e.status !== 'failed' && e.status !== 'conflict')) return;
        entries.delete(id);
        refreshDisplay([id]);
        bump({ toasts: settle(get().toasts).toasts, ...announce(`Discarded change to ${company(id)}`) });
      },
      discardAllFailed() {
        const { entries } = get();
        const ids = [...entries.values()].filter((e) => e.status === 'failed').map((e) => e.dealId);
        ids.forEach((id) => entries.delete(id));
        refreshDisplay(ids);
        bump({ toasts: settle(get().toasts).toasts, ...announce(`Discarded ${plural(ids.length, 'change')}`) });
      },
      resolveConflict(id, choice) {
        const { entries, server } = get();
        const e = entries.get(id);
        const truth = server.get(id);
        if (!e || e.status !== 'conflict' || !truth) return;
        // "Mine anyway" restates the change against what the server has now.
        const next = choice === 'mine' ? rebase(e, truth) : null;
        if (next) entries.set(id, { ...next, changedAt: Date.now() });
        else entries.delete(id);
        refreshDisplay([id]);
        const viewPatch = reconcileView([id], 'local');
        bump({
          ...viewPatch,
          toasts: settle(get().toasts).toasts,
          ...announce(choice === 'mine' ? `Applying your change to ${company(id)}` : `Kept teammate's change to ${company(id)}`),
        });
        scheduleFlush();
      },
      resolveAllConflicts(choice) {
        const ids = [...get().entries.values()].filter((e) => e.status === 'conflict').map((e) => e.dealId);
        ids.forEach((id) => get().resolveConflict(id, choice));
      },
      cancelJob(jobId) {
        const { entries, jobs } = get();
        const job = jobs.get(jobId);
        if (!job || job.finishedAt) return;
        const ids: string[] = [];
        for (const e of entries.values()) {
          if (e.jobId === jobId && e.status !== 'saving') {
            entries.delete(e.dealId);
            ids.push(e.dealId);
          }
        }
        jobs.set(jobId, { ...job, cancelled: job.cancelled + ids.length });
        refreshDisplay(ids);
        const viewPatch = reconcileView(ids, 'local');
        const { toasts, ann } = settle(removeToast(get().toasts, 'move'));
        bump({
          ...viewPatch,
          toasts,
          ...(ann ?? announce(`Stopped. ${plural(ids.length, 'deal')} left where they were.`)),
        });
      },

      // ----- ui -----
      openPanel(panel) {
        set({ panel });
      },
      togglePanel(panel) {
        set((s) => ({ panel: s.panel === panel ? null : panel }));
      },
      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      runToastAction(run, arg) {
        const s = get();
        if (run === 'undo') s.undo();
        else if (run === 'retryFailed') s.retryAllFailed();
        else if (run === 'openAttention') s.openPanel('attention');
        else if (run === 'cancelJob' && arg) s.cancelJob(arg);
        else if (run === 'refresh') {
          s.refreshView();
          s.dismissToast('skipped');
        }
      },

      setVisibleIds(ids) {
        visibleIds = ids;
      },
      getVisibleIds() {
        return visibleIds;
      },
      hasUnsaved() {
        // Pending, failed and conflicted changes all live only in this tab.
        return get().entries.size > 0;
      },
    };
  });

  return store;
}

export type PipelineStore = ReturnType<typeof createPipelineStore>;
