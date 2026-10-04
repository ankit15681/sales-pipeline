import { ApiError, type DealMutation, type PipelineApi, type ServerEvent } from '../shared/api';
import { DAY, type Deal } from '../shared/domain';
import { ME, OWNERS } from '../shared/owners';
import type { FakeServer } from './db';
import type { SimConfig } from './simConfig';

/**
 * The fake network between the client and the fake server: latency, failed
 * saves, "saved but the reply was lost", offline, and a push channel. It
 * implements the same PipelineApi a real REST + WebSocket client would.
 */

interface ConfigSource {
  getState(): SimConfig;
  setState(patch: Partial<SimConfig>): void;
  subscribe(fn: (s: SimConfig, prev: SimConfig) => void): () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createFakeApi(server: FakeServer, config: ConfigSource, rand: () => number = Math.random): PipelineApi {
  const latency = () => {
    const { latencyMin, latencyMax } = config.getState();
    const lo = Math.max(0, Math.min(latencyMin, latencyMax));
    const hi = Math.max(latencyMin, latencyMax);
    return lo + rand() * (hi - lo);
  };

  const assertOnline = () => {
    if (config.getState().offline) throw new ApiError('offline', 'No connection');
  };

  return {
    async fetchDeals() {
      assertOnline();
      await sleep(latency());
      assertOnline();
      return server.snapshot();
    },

    async ping() {
      assertOnline();
      await sleep(Math.min(200, latency()));
      assertOnline();
    },

    async saveDeals(mutations) {
      assertOnline();
      const cfg = config.getState();
      if (cfg.forceConflictNext && mutations.length) {
        // A teammate changes the same part of the deal while our request is on the wire.
        config.setState({ forceConflictNext: false });
        forceConflict(server, mutations[0], rand);
      }
      await sleep(latency());
      assertOnline();
      const { failureRate, lostReplyRate } = config.getState();
      if (rand() < failureRate) {
        if (rand() < lostReplyRate) {
          // Server applied it, but the reply never made it back.
          server.save(mutations, ME.id);
        }
        throw new ApiError('network', 'Save failed (simulated 503)');
      }
      return server.save(mutations, ME.id);
    },

    subscribe(fn) {
      // Deliver pushes with a small delay; hold them while offline and
      // flush on reconnect (a real socket would resume from the last seq).
      let held: ServerEvent[] = [];
      const deliver = (events: ServerEvent[]) => {
        if (config.getState().offline) {
          held.push(...events);
          return;
        }
        setTimeout(() => fn(events), 50 + rand() * 200);
      };
      const unsubServer = server.subscribe(deliver);
      const unsubConfig = config.subscribe((s, prev) => {
        if (prev.offline && !s.offline && held.length) {
          const batch = held;
          held = [];
          setTimeout(() => fn(batch), 100);
        }
      });
      return () => {
        unsubServer();
        unsubConfig();
      };
    },
  };
}

function pickOtherStage(current: Deal['stage'], to: Deal['stage']): Deal['stage'] | null {
  const options: Deal['stage'][] = ['won', 'negotiation', 'proposal', 'lost', 'demo'];
  return options.find((s) => s !== current && s !== to) ?? null;
}

function forceConflict(server: FakeServer, m: DealMutation, rand: () => number) {
  const current = server.get(m.dealId);
  if (!current) return;
  const actor = server.randomTeammate(rand);
  if (m.move) {
    const alt = pickOtherStage(current.stage, m.move.to);
    if (alt) server.teammateMove(m.dealId, actor, alt);
  } else if (m.edit?.set.ownerId !== undefined) {
    // Someone else entirely, so the clash is easy to see.
    const other = OWNERS.find(
      (o) => o.id !== ME.id && o.id !== actor && o.id !== current.ownerId && o.id !== m.edit!.set.ownerId,
    )!;
    server.teammateReassign(m.dealId, actor, other.id);
  } else if (m.edit?.set.closeDate !== undefined) {
    server.teammateSetCloseDate(m.dealId, actor, current.closeDate + 14 * DAY);
  }
}
