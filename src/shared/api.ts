import type { CloseDetails, Deal, FieldKey, FieldValues, StageId } from './domain';

/**
 * The contract between the client and the backend. Both sides import this file
 * and nothing else from each other, so the fake backend in server/ can be
 * swapped for a real one by writing a client that implements PipelineApi.
 *
 * Every change is compare-and-set on exactly the parts it touches: a stage
 * move says which stage the client saw (`move.from`), and a field edit says
 * which value it saw for each field it sets (`edit.expect`). Every mutation
 * carries a mutationId, the idempotency key for safe retries.
 */
export interface DealMutation {
  mutationId: string;
  dealId: string;
  /** Stage change. Moving into Lost needs `close.reason`; Won takes an optional note. */
  move?: { from: StageId; to: StageId; close?: CloseDetails };
  /** Field edits: `expect` holds what the client saw for each field it sets. */
  edit?: { expect: FieldValues; set: FieldValues };
}

/** A part of a deal that a mutation can find stale. */
export type DealPart = 'stage' | FieldKey;

export type MutationResult =
  | { mutationId: string; dealId: string; ok: true; deal: Deal }
  | { mutationId: string; dealId: string; ok: false; reason: 'conflict'; deal: Deal; stale: DealPart[] }
  /** The request itself is wrong (e.g. Lost without a reason). Retrying the same request can't help. */
  | { mutationId: string; dealId: string; ok: false; reason: 'invalid'; message: string }
  | { mutationId: string; dealId: string; ok: false; reason: 'not_found' };

export type ChangeKind = 'stage' | 'value' | 'owner' | 'closeDate' | 'activity' | 'created';

export interface ServerEvent {
  seq: number;
  deal: Deal;
  actor: string;
  change: ChangeKind;
  mutationId?: string;
}

/**
 * The client only ever talks to this interface. A real REST + WebSocket client
 * would implement it too; the store and the UI would not change.
 */
export interface PipelineApi {
  fetchDeals(): Promise<Deal[]>;
  /** One endpoint for every deal change (moves, close details, field edits), batched. */
  saveDeals(mutations: DealMutation[]): Promise<MutationResult[]>;
  /** Cheap reachability check used while offline. */
  ping(): Promise<void>;
  /** Push channel for teammates' changes (think WebSocket). */
  subscribe(fn: (events: ServerEvent[]) => void): () => void;
}

export type ApiErrorKind = 'network' | 'offline';

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
  }
}
