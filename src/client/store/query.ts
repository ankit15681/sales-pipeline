import { OWNER_BY_ID, ME } from '../../shared/owners';
import { needsAttention, priorityScore } from '../lib/priority';
import { DAY, STAGE_BY_ID, STAGE_INDEX, type Deal, type StageId } from '../../shared/domain';

export type Tab = 'focus' | 'open' | StageId;
export type SortKey = 'priority' | 'value' | 'company' | 'lastActivity' | 'closeDate' | 'stageAge' | 'owner' | 'stage';
export type CloseFilter = 'any' | 'overdue' | 'next30';

export interface Query {
  tab: Tab;
  search: string;
  /** 'all' or an owner id. Ignored on the focus tab (always "mine"). */
  owner: string;
  /** Only deals with no activity for at least N days. 0 = any. */
  idleDays: number;
  close: CloseFilter;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
}

export const DEFAULT_QUERY: Query = {
  tab: 'focus',
  search: '',
  owner: 'all',
  idleDays: 0,
  close: 'any',
  sort: { key: 'priority', dir: 'desc' },
};

const searchKeys = new WeakMap<Deal, string>();
const searchKey = (d: Deal) => {
  let k = searchKeys.get(d);
  if (k === undefined) {
    k = `${d.company} ${d.ref}`.toLowerCase();
    searchKeys.set(d, k);
  }
  return k;
};

export function matches(d: Deal, q: Query, now: number): boolean {
  if (q.tab === 'focus') {
    if (d.ownerId !== ME.id || !needsAttention(d, now)) return false;
  } else if (q.tab === 'open') {
    if (!STAGE_BY_ID[d.stage].open) return false;
  } else if (d.stage !== q.tab) {
    return false;
  }
  if (q.tab !== 'focus' && q.owner !== 'all' && d.ownerId !== q.owner) return false;
  if (q.idleDays > 0 && now - d.lastActivityAt < q.idleDays * DAY) return false;
  if (q.close === 'overdue' && !(d.closeDate < now && STAGE_BY_ID[d.stage].open)) return false;
  if (q.close === 'next30' && !(d.closeDate >= now && d.closeDate <= now + 30 * DAY)) return false;
  if (q.search) {
    const s = q.search.trim().toLowerCase();
    if (s && !searchKey(d).includes(s)) return false;
  }
  return true;
}

// Records are immutable, so per-record caches can't go stale. Priority depends on
// time too, so it is cached per minute.
const priorityCache = new WeakMap<Deal, { minute: number; score: number }>();
const cachedPriority = (d: Deal, now: number) => {
  const minute = Math.floor(now / 60_000);
  const hit = priorityCache.get(d);
  if (hit && hit.minute === minute) return hit.score;
  const score = priorityScore(d, minute * 60_000);
  priorityCache.set(d, { minute, score });
  return score;
};
const companyKeys = new WeakMap<Deal, string>();
const companyKey = (d: Deal) => {
  let k = companyKeys.get(d);
  if (k === undefined) companyKeys.set(d, (k = d.company.toLowerCase()));
  return k;
};

function sortValue(d: Deal, key: SortKey, now: number): number | string {
  switch (key) {
    case 'priority':
      return cachedPriority(d, now);
    case 'value':
      return d.value;
    case 'company':
      return companyKey(d);
    case 'lastActivity':
      return d.lastActivityAt;
    case 'closeDate':
      return d.closeDate;
    case 'stageAge':
      return -d.stageEnteredAt; // older entry = longer in stage
    case 'owner':
      return (OWNER_BY_ID[d.ownerId]?.name ?? '').toLowerCase();
    case 'stage':
      return STAGE_INDEX[d.stage];
  }
}

const cmp = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0);

export function makeComparator(q: Query, now: number) {
  const sign = q.sort.dir === 'asc' ? 1 : -1;
  return (a: Deal, b: Deal) => sign * cmp(sortValue(a, q.sort.key, now), sortValue(b, q.sort.key, now)) || cmp(a.id, b.id);
}

/** Filter + sort the whole dataset. Decorate-sort-undecorate keeps it ~10–30 ms for 50k. */
export function computeIds(deals: Iterable<Deal>, q: Query, now: number): string[] {
  const ids: string[] = [];
  const keys: (number | string)[] = [];
  for (const d of deals) {
    if (matches(d, q, now)) {
      ids.push(d.id);
      keys.push(sortValue(d, q.sort.key, now));
    }
  }
  // Sort an index array instead of objects; numeric keys get a monomorphic comparator.
  const order = new Uint32Array(ids.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const sign = q.sort.dir === 'asc' ? 1 : -1;
  if (keys.length && typeof keys[0] === 'number') {
    const nk = Float64Array.from(keys as number[]);
    order.sort((a, b) => sign * (nk[a] - nk[b]) || a - b);
  } else {
    order.sort((a, b) => sign * cmp(keys[a], keys[b]) || a - b);
  }
  const out = new Array<string>(ids.length);
  for (let i = 0; i < order.length; i++) out[i] = ids[order[i]];
  return out;
}

/** Binary-search insert position (the list may hold a few stale rows; close enough). */
export function insertionIndex(ids: string[], deal: Deal, get: (id: string) => Deal | undefined, q: Query, now: number) {
  const compare = makeComparator(q, now);
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const other = get(ids[mid]);
    if (other && compare(other, deal) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const sameQuery = (a: Query, b: Query) =>
  a.tab === b.tab &&
  a.search === b.search &&
  a.owner === b.owner &&
  a.idleDays === b.idleDays &&
  a.close === b.close &&
  a.sort.key === b.sort.key &&
  a.sort.dir === b.sort.dir;
