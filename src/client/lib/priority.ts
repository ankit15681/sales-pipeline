import { DAY, STAGE_BY_ID, type Deal } from '../../shared/domain';

/**
 * "Which deals should I work on today?"
 *
 * Each open deal gets a few plain-language signals and a score.
 * The score is deliberately simple and explainable (a rep should be able to
 * guess why a deal is at the top), not a black-box model.
 */
export type SignalKind = 'overdue' | 'closingSoon' | 'stale' | 'stuck' | 'bigDeal';

export interface Signal {
  kind: SignalKind;
  label: string;
}

export const STALE_DAYS = 14;
export const STUCK_DAYS = 30;
export const CLOSING_SOON_DAYS = 7;
export const BIG_DEAL_VALUE = 50_00_000; // ₹50 L

export function signalsFor(deal: Deal, now: number): Signal[] {
  if (!STAGE_BY_ID[deal.stage].open) return [];
  const out: Signal[] = [];
  const toClose = Math.floor((deal.closeDate - now) / DAY);
  if (toClose < 0) out.push({ kind: 'overdue', label: `Close date passed ${-toClose}d ago` });
  else if (toClose <= CLOSING_SOON_DAYS)
    out.push({ kind: 'closingSoon', label: toClose === 0 ? 'Closes today' : `Closes in ${toClose}d` });
  const idle = Math.floor((now - deal.lastActivityAt) / DAY);
  if (idle >= STALE_DAYS) out.push({ kind: 'stale', label: `No activity ${idle}d` });
  const inStage = Math.floor((now - deal.stageEnteredAt) / DAY);
  if (inStage >= STUCK_DAYS) out.push({ kind: 'stuck', label: `In stage ${inStage}d` });
  if (deal.value >= BIG_DEAL_VALUE) out.push({ kind: 'bigDeal', label: 'High value' });
  return out;
}

/** Higher = work on it sooner. Closed deals score 0. */
export function priorityScore(deal: Deal, now: number): number {
  const stage = STAGE_BY_ID[deal.stage];
  if (!stage.open) return 0;
  const expected = deal.value * stage.probability;
  let score = Math.log10(expected + 1) * 5; // roughly 20–40
  const toClose = (deal.closeDate - now) / DAY;
  if (toClose < 0) score += 40 + Math.min(-toClose, 30);
  else if (toClose <= CLOSING_SOON_DAYS) score += 30 - toClose * 2;
  const idle = (now - deal.lastActivityAt) / DAY;
  if (idle >= STALE_DAYS) score += 10 + Math.min(idle - STALE_DAYS, 30);
  if ((now - deal.stageEnteredAt) / DAY >= STUCK_DAYS) score += 8;
  if (deal.value >= BIG_DEAL_VALUE) score += 10;
  return score;
}

/**
 * "My focus" is a short list, not every deal with a chip:
 *  - close date passed or within a week, or
 *  - late-stage or high-value deals that have gone quiet.
 * Idle early-stage leads are a clean-up job (All open + "No activity" filter), not today's work.
 */
export function needsAttention(deal: Deal, now: number): boolean {
  if (!STAGE_BY_ID[deal.stage].open) return false;
  const toClose = (deal.closeDate - now) / DAY;
  if (toClose <= CLOSING_SOON_DAYS) return true;
  const idle = (now - deal.lastActivityAt) / DAY;
  const lateStage = deal.stage === 'proposal' || deal.stage === 'negotiation';
  return idle >= STALE_DAYS && (lateStage || deal.value >= BIG_DEAL_VALUE);
}
