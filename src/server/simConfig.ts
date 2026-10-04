import { createStore } from 'zustand/vanilla';

/**
 * Knobs for the fake backend. Reviewers can change them live from the
 * Simulation panel, or up front with URL params, e.g.
 *   ?latency=300-1500&fail=0.1&teammates=2&hotspot=0.3
 */
export interface SimConfig {
  latencyMin: number; // ms
  latencyMax: number; // ms
  /** Share of save requests that fail (0..1). */
  failureRate: number;
  /** Of the failed requests, the share where the server DID save but the reply was lost. */
  lostReplyRate: number;
  /** Teammate edits per second across the whole pipeline. */
  teammateRate: number;
  /** Chance that a teammate edit lands on a deal you currently have on screen. */
  hotspot: number;
  offline: boolean;
  autoRetry: boolean;
  /** One-shot: a teammate moves the deal just before your next save reaches the server. */
  forceConflictNext: boolean;
}

export const DEFAULT_SIM: SimConfig = {
  latencyMin: 300,
  latencyMax: 1500,
  failureRate: 0.1,
  lostReplyRate: 0,
  teammateRate: 1,
  hotspot: 0.25,
  offline: false,
  autoRetry: true,
  forceConflictNext: false,
};

const STORAGE_KEY = 'pipeline.sim.v1';

function fromUrl(search: string): Partial<SimConfig> {
  const p = new URLSearchParams(search);
  const out: Partial<SimConfig> = {};
  const num = (k: string) => {
    const v = p.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const latency = p.get('latency');
  if (latency) {
    const [a, b] = latency.split('-').map(Number);
    if (Number.isFinite(a)) out.latencyMin = a;
    out.latencyMax = Number.isFinite(b) ? b : out.latencyMin;
  }
  const fail = num('fail');
  if (fail !== undefined) out.failureRate = clamp01(fail);
  const lost = num('lost');
  if (lost !== undefined) out.lostReplyRate = clamp01(lost);
  const t = num('teammates');
  if (t !== undefined) out.teammateRate = Math.max(0, t);
  const h = num('hotspot');
  if (h !== undefined) out.hotspot = clamp01(h);
  if (p.has('offline')) out.offline = p.get('offline') !== '0';
  if (p.has('retry')) out.autoRetry = p.get('retry') !== '0';
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function loadInitial(): SimConfig {
  let saved: Partial<SimConfig> = {};
  let url: Partial<SimConfig> = {};
  if (typeof window !== 'undefined') {
    try {
      saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    url = fromUrl(window.location.search);
  }
  // URL wins over saved settings, so a shared link always reproduces the same setup.
  return { ...DEFAULT_SIM, ...saved, ...url, offline: url.offline ?? false, forceConflictNext: false };
}

export type SimStore = ReturnType<typeof createSimStore>;

export function createSimStore(initial?: Partial<SimConfig>) {
  const store = createStore<SimConfig>(() => ({ ...(initial ? { ...DEFAULT_SIM, ...initial } : loadInitial()) }));
  if (!initial && typeof window !== 'undefined') {
    store.subscribe((s) => {
      try {
        const { offline: _o, forceConflictNext: _f, ...persist } = s;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
      } catch {
        /* storage unavailable: settings just won't persist */
      }
    });
  }
  return store;
}
