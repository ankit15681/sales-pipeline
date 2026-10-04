export type StageId = 'new' | 'contacted' | 'demo' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface Stage {
  id: StageId;
  label: string;
  /** Keyboard shortcut (1–7). */
  key: string;
  open: boolean;
  /** Rough win probability, used for the focus score's expected value. */
  probability: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'new', label: 'New Lead', key: '1', open: true, probability: 0.05 },
  { id: 'contacted', label: 'Contacted', key: '2', open: true, probability: 0.1 },
  { id: 'demo', label: 'Demo Done', key: '3', open: true, probability: 0.25 },
  { id: 'proposal', label: 'Proposal Sent', key: '4', open: true, probability: 0.45 },
  { id: 'negotiation', label: 'Negotiation', key: '5', open: true, probability: 0.7 },
  { id: 'won', label: 'Won', key: '6', open: false, probability: 1 },
  { id: 'lost', label: 'Lost', key: '7', open: false, probability: 0 },
];

export const STAGE_BY_ID: Record<StageId, Stage> = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, Stage>;

export const STAGE_INDEX: Record<StageId, number> = Object.fromEntries(STAGES.map((s, i) => [s.id, i])) as Record<
  StageId,
  number
>;

export const stageLabel = (id: StageId) => STAGE_BY_ID[id].label;

/** Next/previous stage along the main path (Won/Lost are terminal). */
export function adjacentStage(id: StageId, dir: 1 | -1): StageId | null {
  const order: StageId[] = ['new', 'contacted', 'demo', 'proposal', 'negotiation', 'won'];
  if (id === 'lost') return dir === -1 ? 'negotiation' : null;
  const i = order.indexOf(id);
  const next = order[i + dir];
  return next ?? null;
}

export interface Owner {
  id: string;
  name: string;
  initials: string;
}

/**
 * Deal records are immutable: every change produces a new object.
 * That lets the UI compare by reference and lets the fake server
 * hand out records without defensive copies.
 */
export interface Deal {
  id: string;
  /** Short human reference, e.g. D-10423 */
  ref: string;
  company: string;
  licences: number;
  /** INR */
  value: number;
  ownerId: string;
  stage: StageId;
  stageEnteredAt: number;
  lastActivityAt: number;
  closeDate: number;
  /** Why it was lost / a note on the win. Present only while the deal is Won or Lost. */
  close?: CloseDetails;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export const DAY = 24 * 60 * 60 * 1000;

// ---------- closing a deal ----------

export type LostReason = 'price' | 'competitor' | 'budget' | 'no_decision' | 'timing' | 'fit' | 'other';

/** A short fixed list (keys 1–7 in the dialog) so reasons can be counted later; "Other" needs a note. */
export const LOST_REASONS: readonly { id: LostReason; label: string; short: string }[] = [
  { id: 'price', label: 'Price too high', short: 'Price' },
  { id: 'competitor', label: 'Chose a competitor', short: 'Competitor' },
  { id: 'budget', label: 'No budget', short: 'Budget' },
  { id: 'no_decision', label: 'No decision / went quiet', short: 'No decision' },
  { id: 'timing', label: 'Bad timing', short: 'Timing' },
  { id: 'fit', label: 'Not a fit', short: 'Not a fit' },
  { id: 'other', label: 'Other (add a note)', short: 'Other' },
];

export const LOST_REASON_BY_ID = Object.fromEntries(LOST_REASONS.map((r) => [r.id, r])) as Record<
  LostReason,
  (typeof LOST_REASONS)[number]
>;

export interface CloseDetails {
  /** Required for Lost, never set for Won. */
  reason?: LostReason;
  /** Optional for Won; required when the Lost reason is "Other". */
  note?: string;
}

export const NOTE_MAX = 280;

export const isClosed = (stage: StageId) => stage === 'won' || stage === 'lost';

/**
 * The one rule for close details. The dialog and the server both call it, so the
 * client can't send something the server will refuse, and a client that skips the
 * dialog (an old tab, a script) still can't save a Lost deal without a reason.
 */
export function closeProblem(to: StageId, close: CloseDetails | undefined): string | null {
  if (!isClosed(to)) return close ? 'Only Won and Lost deals take close details' : null;
  const note = close?.note?.trim() ?? '';
  if (note.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters`;
  if (to === 'won') return close?.reason ? "Won deals don't take a lost reason" : null;
  if (!close?.reason) return 'Pick a reason';
  if (!(close.reason in LOST_REASON_BY_ID)) return 'Unknown reason';
  if (close.reason === 'other' && !note) return 'Add a note for "Other"';
  return null;
}

/** Trimmed copy with empty notes dropped; undefined when there is nothing to store. */
export function cleanClose(close: CloseDetails | undefined): CloseDetails | undefined {
  if (!close) return undefined;
  const note = close.note?.trim();
  const out: CloseDetails = {};
  if (close.reason) out.reason = close.reason;
  if (note) out.note = note;
  return out.reason || out.note ? out : undefined;
}

// ---------- bulk-editable fields ----------

/** Fields a user can change on many deals at once. Each is compare-and-set on its own. */
export interface EditableFields {
  ownerId: string;
  closeDate: number;
}
export type FieldKey = keyof EditableFields;
export type FieldValues = Partial<EditableFields>;
export const FIELD_KEYS: readonly FieldKey[] = ['ownerId', 'closeDate'];
export const FIELD_LABEL: Record<FieldKey, string> = { ownerId: 'owner', closeDate: 'close date' };

export const fieldKeys = (v: FieldValues | undefined) => (v ? FIELD_KEYS.filter((k) => k in v) : []);
