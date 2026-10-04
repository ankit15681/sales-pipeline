/**
 * The fake backend's only entry point. The client never imports from server/
 * directly: the composition root (client/app/instance.ts) and tests use this
 * file, and everything else talks to the PipelineApi from shared/api.ts.
 *
 * To use a real backend, write a PipelineApi client (fetch + WebSocket), pass it
 * to createPipelineStore in instance.ts, and delete this folder.
 */
import type { PipelineApi } from '../shared/api';
import { FakeServer } from './db';
import { generateDeals } from './seed';
import { createSimStore, type SimStore } from './simConfig';
import { startTeammates } from './teammates';
import { createFakeApi } from './transport';

export { FakeServer } from './db';
export { generateDeals, DEFAULT_DISTRIBUTION } from './seed';
export { createSimStore, DEFAULT_SIM, type SimConfig, type SimStore } from './simConfig';
export { startTeammates } from './teammates';
export { createFakeApi } from './transport';

export interface FakeBackend {
  /** Simulation knobs (latency, failures, teammates, offline), shown in the Simulation panel. */
  sim: SimStore;
  /** The in-memory database. Exposed for the Simulation panel and the console, not for the store. */
  server: FakeServer;
  /** What the client uses: the fake network in front of the server. */
  api: PipelineApi;
  /** Start the simulated teammates. `getHotIds` returns the deals on screen, so edits land where you can see them. */
  startTeammates(getHotIds: () => string[]): () => void;
}

export function createFakeBackend(now = Date.now()): FakeBackend {
  const sim = createSimStore();
  const server = new FakeServer(generateDeals(now));
  const api = createFakeApi(server, sim);
  return {
    sim,
    server,
    api,
    startTeammates: (getHotIds) => startTeammates(server, () => sim.getState(), getHotIds),
  };
}
