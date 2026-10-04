import type { ChangeKind, DealMutation } from '../../shared/api';
import type { CloseDetails, Deal, FieldValues, StageId } from '../../shared/domain';
import type { Query, Tab } from './query';

/**
 * Lifecycle of one deal's unsaved change:
 *
 *   queued ──send──▶ saving ──ok──▶ (entry removed: saved)
 *                      │  └─conflict──▶ conflict   (server kept teammate's change)
 *                      └─network error─▶ retrying ──(backoff)──▶ saving …
 *                                         └─ out of retries ──▶ failed
 *   offline at any point ─▶ waiting ──(back online)──▶ queued
 *
 * While queued/saving/retrying/waiting the UI shows the user's target stage
 * (optimistic). failed/conflict show the server's truth plus a badge, so the
 * screen never claims something is saved when it is not.
 */
export type SyncStatus = 'queued' | 'saving' | 'retrying' | 'waiting' | 'failed' | 'conflict';

export const PENDING_STATUSES: ReadonlySet<SyncStatus> = new Set(['queued', 'saving', 'retrying', 'waiting']);

/** A request whose outcome is unknown. Retries resend it unchanged, with the same idempotency key. */
export type PendingRequest = Omit<DealMutation, 'dealId'>;

/**
 * One deal's unsaved change. A deal has at most one entry: a stage move and a
 * field edit made before the first one saved are merged into it, and the latest
 * intent for each part wins.
 */
export interface SyncEntry {
  dealId: string;
  /** Stage change: the stage the server had when the user made it (the precondition) and where they want it. */
  move?: { from: StageId; to: StageId; close?: CloseDetails };
  /** Field edits: per field, the value the user saw (the precondition) and the one they want. */
  edit?: { expect: FieldValues; set: FieldValues };
  status: SyncStatus;
  req: PendingRequest | null;
  attempts: number;
  retryAt: number;
  lane: 'interactive' | 'bulk';
  jobId: string | null;
  error?: string;
  /** The server refused the request itself (e.g. Lost without a reason): retrying can't help. */
  rejected?: boolean;
  /** Conflict only: what the teammate changed first. */
  theirs?: { by: string; at: number; stage?: StageId; fields?: FieldValues };
  changedAt: number;
}

export interface Job {
  id: string;
  label: string;
  total: number;
  saved: number;
  cancelled: number;
  startedAt: number;
  finishedAt?: number;
  undoable: boolean;
}

export interface RemoteMark {
  by: string;
  at: number;
  change: ChangeKind;
}

export interface Departed {
  by: string;
  at: number;
}

export interface ViewState {
  query: Query;
  ids: string[];
  index: Map<string, number>;
  /** Rows still shown but no longer matching because a teammate changed them. */
  departed: Map<string, Departed>;
  /** Deals that now match the view but are held back so rows do not jump. */
  pendingNew: Set<string>;
  /**
   * Board only: the column a card was in before a teammate moved it. The card stays
   * there (greyed, "Moved to Won by Rahul") until the user refreshes, so cards never
   * jump between columns because of someone else.
   */
  heldStage: Map<string, StageId>;
  computedAt: number;
}

export type ToastActionId = 'undo' | 'retryFailed' | 'openAttention' | 'cancelJob' | 'refresh';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'conflict';
  title: string;
  detail?: string;
  actions?: { label: string; run: ToastActionId; arg?: string; key?: string }[];
  sticky?: boolean;
  createdAt: number;
}

export interface MoveIntent {
  id: string;
  to: StageId;
  /** Lost reason / Won note. Required when `to` is Lost. */
  close?: CloseDetails;
}

export interface EditIntent {
  id: string;
  set: FieldValues;
}

/** How to change the close date of every picked deal. */
export type CloseDateChange = { mode: 'set'; at: number } | { mode: 'shift'; days: number } | { mode: 'quarterEnd' };

export interface EditSpec {
  ownerId?: string;
  closeDate?: CloseDateChange;
}

/** Enough to put a deal back: only parts that are still what we set get reverted. */
export interface UndoItem {
  dealId: string;
  move?: { from: StageId; to: StageId; fromClose?: CloseDetails };
  edit?: { before: FieldValues; after: FieldValues };
}

export interface UndoRecord {
  label: string;
  items: UndoItem[];
}

export interface PendingConfirm {
  moves: MoveIntent[];
  label: string;
  /** Single destination, or null when each deal moves to its own next stage. */
  to: StageId | null;
  value: number;
  byStage: Partial<Record<StageId, number>>;
  skippedChanged: number;
  /** Some moves land in Won or Lost: the dialog asks for the reason / note before anything is saved. */
  closing: 'won' | 'lost' | null;
  /** How many of the moves land in `closing` (a forward move can take only some deals into Won). */
  closingCount: number;
}

/** The bulk edit dialog: which deals it will change. */
export interface PendingEdit {
  ids: string[];
  skippedChanged: number;
}

export type Panel = 'moveMenu' | 'attention' | 'help' | 'sim';

export interface PipelineState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError?: string;
  /** Server truth as last seen. Mutable map of immutable records. */
  server: Map<string, Deal>;
  /** What the UI shows: server truth + pending optimistic changes. */
  display: Map<string, Deal>;
  entries: Map<string, SyncEntry>;
  jobs: Map<string, Job>;
  remoteMarks: Map<string, RemoteMark>;
  /** Bumped whenever the mutable maps above change. */
  dataRev: number;
  syncRev: number;
  online: boolean;
  view: ViewState;
  selection: ReadonlySet<string>;
  anchorId: string | null;
  focusId: string | null;
  toasts: Toast[];
  announcement: { text: string; id: number; urgent: boolean };
  undoStack: UndoRecord[];
  confirm: PendingConfirm | null;
  editing: PendingEdit | null;
  panel: Panel | null;
  /** Same data, same sync engine, two renderers. */
  layout: Layout;
}

export type Layout = 'table' | 'board';

export interface PipelineActions {
  load(): Promise<void>;
  dispose(): void;

  setQuery(patch: Partial<Query>): void;
  setTab(tab: Tab): void;
  cycleTab(dir: 1 | -1): void;
  toggleSort(key: Query['sort']['key']): void;
  refreshView(): void;

  setFocus(id: string | null): void;
  moveFocus(delta: number, extend?: boolean): void;
  focusEdge(edge: 'first' | 'last'): void;
  toggleSelect(id?: string): void;
  selectRange(toId: string): void;
  selectAll(): void;
  setSelection(ids: Iterable<string>): void;
  clearSelection(): void;

  /** Moves the given deals, or the selection, or the focused deal. Asks to confirm big moves. */
  requestMove(to: StageId, ids?: string[]): void;
  requestAdjacentMove(dir: 1 | -1, ids?: string[]): void;
  setLayout(layout: Layout): void;
  moveDeals(moves: MoveIntent[], label?: string): void;
  /** Starts the confirmed move. Close details are applied to the moves into Won/Lost; returns an error if they're invalid. */
  confirmMove(close?: CloseDetails): string | null;
  cancelConfirm(): void;
  /** Opens the edit dialog for the selection or the focused deal. */
  openEdit(ids?: string[]): void;
  applyEdit(spec: EditSpec): void;
  cancelEdit(): void;
  /** Lower-level: set exact field values per deal (tests, scripts). */
  editDeals(edits: EditIntent[], label?: string): void;
  undo(): void;
  retry(id: string): void;
  retryAllFailed(): void;
  discard(id: string): void;
  discardAllFailed(): void;
  resolveConflict(id: string, choice: 'mine' | 'theirs'): void;
  resolveAllConflicts(choice: 'mine' | 'theirs'): void;
  cancelJob(jobId: string): void;

  openPanel(panel: Panel | null): void;
  togglePanel(panel: Panel): void;
  dismissToast(id: string): void;
  runToastAction(run: ToastActionId, arg?: string): void;

  /** Rows currently rendered; the teammate simulator uses this as its hotspot. */
  setVisibleIds(ids: string[]): void;
  getVisibleIds(): string[];
  hasUnsaved(): boolean;
}

export type Pipeline = PipelineState & PipelineActions;
