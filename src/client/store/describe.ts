import { formatDate, formatCount } from '../lib/format';
import { ownerFirstName } from '../../shared/owners';
import {
  DAY,
  FIELD_LABEL,
  fieldKeys,
  LOST_REASON_BY_ID,
  stageLabel,
  type CloseDetails,
  type Deal,
  type FieldKey,
  type FieldValues,
} from '../../shared/domain';
import type { CloseDateChange, EditSpec, SyncEntry } from './types';

/** Plain-language text for changes, shared by toasts, the attention drawer and row badges. */

export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

export const fieldValueText = (k: FieldKey, v: string | number) =>
  k === 'ownerId' ? ownerFirstName(v as string) : formatDate(v as number);

/** "Price", "Other: company acquired", or a Won note. */
export function closeText(c: CloseDetails | undefined): string {
  if (!c) return '';
  const reason = c.reason ? LOST_REASON_BY_ID[c.reason].short : '';
  if (reason && c.note) return `${reason}: ${c.note}`;
  return reason || c.note || '';
}

/** "move to Lost (Price) + owner → Rahul" */
export function describeEntry(e: Pick<SyncEntry, 'move' | 'edit'>): string {
  const parts: string[] = [];
  if (e.move) {
    const why = e.move.close?.reason ? ` (${LOST_REASON_BY_ID[e.move.close.reason].short})` : '';
    parts.push(`move to ${stageLabel(e.move.to)}${why}`);
  }
  for (const k of fieldKeys(e.edit?.set)) parts.push(`${FIELD_LABEL[k]} → ${fieldValueText(k, e.edit!.set[k]!)}`);
  return parts.join(' + ');
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the teammate did first: "moved it to Won", "changed the owner to Rahul". */
export function theirsText(theirs: NonNullable<SyncEntry['theirs']>, subject = 'it'): string {
  const parts: string[] = [];
  if (theirs.stage) parts.push(`moved ${subject} to ${stageLabel(theirs.stage)}`);
  const keys = fieldKeys(theirs.fields);
  if (keys.length === 1) {
    const k = keys[0];
    parts.push(
      `changed the ${FIELD_LABEL[k]}${subject === 'it' ? '' : ` of ${subject}`} to ${fieldValueText(k, theirs.fields![k]!)}`,
    );
  } else if (keys.length) {
    parts.push(`changed the ${keys.map((k) => FIELD_LABEL[k]).join(' and ')}${subject === 'it' ? '' : ` of ${subject}`}`);
  }
  return parts.join(' and ') || `changed ${subject}`;
}

export function keepTheirsLabel(e: SyncEntry): string {
  const t = e.theirs;
  if (t?.stage && !fieldKeys(t.fields).length) return `Keep ${stageLabel(t.stage)}`;
  const keys = fieldKeys(t?.fields);
  if (!t?.stage && keys.length === 1) return `Keep theirs (${fieldValueText(keys[0], t!.fields![keys[0]]!)})`;
  return 'Keep theirs';
}

export function applyMineLabel(e: SyncEntry): string {
  if (e.move && !fieldKeys(e.edit?.set).length) return `Move to ${stageLabel(e.move.to)} anyway`;
  return 'Apply mine anyway';
}

// ---------- the bulk edit ----------

/** Last day of the quarter after the one `now` is in (Indian FY quarters line up with calendar ones). */
export function endOfNextQuarter(now: number): number {
  const d = new Date(now);
  const q = Math.floor(d.getMonth() / 3);
  // Day 0 of the month after the quarter = its last day. Noon keeps it clear of DST edges.
  return new Date(d.getFullYear(), (q + 2) * 3, 0, 12).getTime();
}

export function closeDateFor(change: CloseDateChange, current: number, now: number): number {
  if (change.mode === 'set') return change.at;
  if (change.mode === 'shift') return current + change.days * DAY;
  return endOfNextQuarter(now);
}

export function closeDateChangeText(change: CloseDateChange, now: number): string {
  if (change.mode === 'set') return `close date → ${formatDate(change.at)}`;
  if (change.mode === 'shift') return `close date ${change.days >= 0 ? '+' : '−'}${Math.abs(change.days)}d`;
  return `close date → end of next quarter (${formatDate(endOfNextQuarter(now))})`;
}

export function editSpecText(spec: EditSpec, now: number): string {
  const parts: string[] = [];
  if (spec.ownerId) parts.push(`owner → ${ownerFirstName(spec.ownerId)}`);
  if (spec.closeDate) parts.push(closeDateChangeText(spec.closeDate, now));
  return parts.join(', ');
}

/** Values that were different before, for undo. */
export function pickFields(d: Deal, keys: readonly FieldKey[]): FieldValues {
  const out: FieldValues = {};
  for (const k of keys) put(out, k, d[k]);
  return out;
}

export function put(o: FieldValues, k: FieldKey, v: unknown) {
  (o as Record<FieldKey, unknown>)[k] = v;
}
