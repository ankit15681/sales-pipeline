import type { ChangeKind, DealMutation, DealPart, MutationResult, ServerEvent } from '../shared/api';
import { OWNER_BY_ID, OWNERS } from '../shared/owners';
import { randomCompany } from './seed';
import {
  adjacentStage,
  cleanClose,
  closeProblem,
  DAY,
  fieldKeys,
  isClosed,
  LOST_REASONS,
  type CloseDetails,
  type Deal,
  type FieldKey,
  type StageId,
} from '../shared/domain';

/**
 * In-memory "backend". It owns the source of truth and knows nothing about
 * latency or failures (that lives in transport.ts). The request and result
 * shapes are the shared contract in shared/api.ts.
 *
 * Every change is compare-and-set on exactly the parts it touches:
 *  - a stage move says which stage the client saw (`move.from`);
 *  - a field edit says which value the client saw for each field (`edit.expect`).
 * If a teammate changed one of those parts first, the server refuses the whole
 * mutation and says which parts were stale, instead of silently overwriting.
 * Parts the mutation does not touch are not compared, so reassigning a deal
 * never clashes with a teammate moving it.
 *
 * Every mutation carries a mutationId (idempotency key). Replaying the same id
 * returns the original result, so a client retry after a lost reply can never
 * apply a change twice.
 */
type Listener = (events: ServerEvent[]) => void;

export class FakeServer {
  private db = new Map<string, Deal>();
  private ids: string[] = [];
  private seq = 0;
  private processed = new Map<string, MutationResult>();
  private listeners = new Set<Listener>();
  private nextNumber: number;

  constructor(
    deals: Deal[],
    private rand: () => number = Math.random,
  ) {
    for (const d of deals) {
      this.db.set(d.id, d);
      this.ids.push(d.id);
    }
    this.nextNumber = deals.length + 1;
  }

  get size() {
    return this.db.size;
  }

  /** Records are immutable, so handing out the same objects is safe. */
  snapshot(): Deal[] {
    return Array.from(this.db.values());
  }

  get(id: string) {
    return this.db.get(id);
  }

  randomId(rand: () => number) {
    return this.ids[Math.floor(rand() * this.ids.length)];
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save(mutations: DealMutation[], actor: string, now = Date.now()): MutationResult[] {
    const results: MutationResult[] = [];
    const events: ServerEvent[] = [];
    for (const m of mutations) {
      const cached = this.processed.get(m.mutationId);
      if (cached) {
        // Replay of a request we already applied: same answer, no second write.
        // Return the latest record so the client does not regress its copy.
        const current = this.db.get(m.dealId);
        results.push(cached.ok && current ? { ...cached, deal: current } : cached);
        continue;
      }
      const result = this.apply(m, actor, now, events);
      this.processed.set(m.mutationId, result);
      results.push(result);
    }
    this.emit(events);
    return results;
  }

  private apply(m: DealMutation, actor: string, now: number, events: ServerEvent[]): MutationResult {
    const base = { mutationId: m.mutationId, dealId: m.dealId };
    const deal = this.db.get(m.dealId);
    if (!deal) return { ...base, ok: false, reason: 'not_found' };

    const patch: Partial<Deal> = {};
    const stale: DealPart[] = [];
    let change: ChangeKind | null = null;

    if (m.move) {
      const { from, to, close } = m.move;
      const problem = closeProblem(to, close);
      if (problem) return { ...base, ok: false, reason: 'invalid', message: problem };
      if (deal.stage === to) {
        // Already there (a teammate made the same move). Their close details stand.
      } else if (deal.stage !== from) {
        stale.push('stage');
      } else {
        Object.assign(patch, {
          stage: to,
          stageEnteredAt: now,
          lastActivityAt: now,
          close: isClosed(to) ? cleanClose(close) : undefined,
        });
        change = 'stage';
      }
    }

    if (m.edit) {
      for (const k of fieldKeys(m.edit.set)) {
        const want = m.edit.set[k]!;
        const problem = fieldProblem(k, want);
        if (problem) return { ...base, ok: false, reason: 'invalid', message: problem };
        if (deal[k] === want) continue; // already the value the client wants
        if (deal[k] !== m.edit.expect[k]) stale.push(k);
        else {
          (patch as Record<FieldKey, unknown>)[k] = want;
          change ??= k === 'ownerId' ? 'owner' : 'closeDate';
        }
      }
    }

    // All or nothing: a mutation is one user intent, so half-applying it would leave
    // a state nobody asked for.
    if (stale.length) return { ...base, ok: false, reason: 'conflict', deal, stale };
    if (!change) return { ...base, ok: true, deal };
    const next = this.write(deal, patch, actor, now);
    events.push({ seq: ++this.seq, deal: next, actor, change, mutationId: m.mutationId });
    return { ...base, ok: true, deal: next };
  }

  // ---- Teammate activity (used by the simulator and the "force conflict" switch) ----

  teammateMove(dealId: string, actor: string, to?: StageId, now = Date.now()): Deal | null {
    const deal = this.db.get(dealId);
    if (!deal) return null;
    const target = to ?? adjacentStage(deal.stage, 1);
    if (!target || target === deal.stage) return null;
    const next = this.write(
      deal,
      { stage: target, stageEnteredAt: now, lastActivityAt: now, close: isClosed(target) ? this.randomClose(target) : undefined },
      actor,
      now,
    );
    this.emit([{ seq: ++this.seq, deal: next, actor, change: 'stage' }]);
    return next;
  }

  teammateSetCloseDate(dealId: string, actor: string, closeDate: number, now = Date.now()) {
    const deal = this.db.get(dealId);
    if (!deal || deal.closeDate === closeDate) return null;
    const next = this.write(deal, { closeDate }, actor, now);
    this.emit([{ seq: ++this.seq, deal: next, actor, change: 'closeDate' }]);
    return next;
  }

  /** Teammates follow the same rule as everyone else: Lost always has a reason. */
  randomClose(stage: StageId): CloseDetails | undefined {
    if (stage === 'won') return this.rand() < 0.3 ? { note: pickNote(this.rand, WON_NOTES) } : undefined;
    const reason = LOST_REASONS[Math.floor(this.rand() * LOST_REASONS.length)].id;
    return reason === 'other' ? { reason, note: pickNote(this.rand, OTHER_NOTES) } : { reason };
  }

  teammateEditValue(dealId: string, actor: string, factor: number, now = Date.now()) {
    const deal = this.db.get(dealId);
    if (!deal) return null;
    const licences = Math.max(1, Math.round(deal.licences * factor));
    const value = Math.round((deal.value / deal.licences) * licences);
    const next = this.write(deal, { licences, value, lastActivityAt: now }, actor, now);
    this.emit([{ seq: ++this.seq, deal: next, actor, change: 'value' }]);
    return next;
  }

  teammateReassign(dealId: string, actor: string, ownerId: string, now = Date.now()) {
    const deal = this.db.get(dealId);
    if (!deal || deal.ownerId === ownerId) return null;
    const next = this.write(deal, { ownerId, lastActivityAt: now }, actor, now);
    this.emit([{ seq: ++this.seq, deal: next, actor, change: 'owner' }]);
    return next;
  }

  teammateLogActivity(dealId: string, actor: string, now = Date.now()) {
    const deal = this.db.get(dealId);
    if (!deal) return null;
    const next = this.write(deal, { lastActivityAt: now }, actor, now);
    this.emit([{ seq: ++this.seq, deal: next, actor, change: 'activity' }]);
    return next;
  }

  teammateCreate(actor: string, rand: () => number, now = Date.now()): Deal {
    const n = this.nextNumber++;
    const licences = Math.max(5, Math.round(Math.pow(rand(), 2.2) * 600));
    const deal: Deal = {
      id: `d${n}`,
      ref: `D-${10000 + n}`,
      company: randomCompany(rand),
      licences,
      value: licences * Math.round(4 + rand() * 16) * 1000,
      ownerId: actor,
      stage: 'new',
      stageEnteredAt: now,
      lastActivityAt: now,
      closeDate: now + Math.round(30 + rand() * 90) * 86_400_000,
      version: 1,
      updatedAt: now,
      updatedBy: actor,
    };
    this.db.set(deal.id, deal);
    this.ids.push(deal.id);
    this.emit([{ seq: ++this.seq, deal, actor, change: 'created' }]);
    return deal;
  }

  randomTeammate(rand: () => number, exclude?: string) {
    let o = OWNERS[1 + Math.floor(rand() * (OWNERS.length - 1))];
    if (o.id === exclude) o = OWNERS[1 + ((OWNERS.indexOf(o) + 1) % (OWNERS.length - 1))];
    return o.id;
  }

  private write(deal: Deal, patch: Partial<Deal>, actor: string, now: number): Deal {
    const next: Deal = { ...deal, ...patch, version: deal.version + 1, updatedAt: now, updatedBy: actor };
    this.db.set(deal.id, next);
    return next;
  }

  private emit(events: ServerEvent[]) {
    if (!events.length) return;
    for (const l of this.listeners) l(events);
  }
}

function fieldProblem(k: FieldKey, v: unknown): string | null {
  if (k === 'ownerId') return typeof v === 'string' && v in OWNER_BY_ID ? null : 'Unknown owner';
  // Close dates within ±5 years: catches unit mistakes (seconds vs ms) and typos.
  if (k === 'closeDate')
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v - Date.now()) < 5 * 365 * DAY
      ? null
      : 'Close date out of range';
  return 'Unknown field';
}

const WON_NOTES = [
  'Annual plan, paid upfront',
  'Expansion likely in Q3',
  'Champion: head of ops',
  'Beat the incumbent on support',
];
const OTHER_NOTES = ['Company acquired', 'Project cancelled', 'Duplicate of another deal', 'Merged into parent account'];
const pickNote = (rand: () => number, list: string[]) => list[Math.floor(rand() * list.length)];
