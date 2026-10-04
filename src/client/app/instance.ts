import { createFakeBackend } from '../../server';
import { createPipelineStore } from '../store/pipeline';

/**
 * The composition root: the only client file that imports from server/.
 * It starts the fake backend and hands its PipelineApi to the store. With a
 * real backend, `api` would be a fetch + WebSocket client and nothing else
 * in client/ would change.
 */
const backend = createFakeBackend();

export const { sim, server, api } = backend;
export const pipeline = createPipelineStore(api, { autoRetry: () => sim.getState().autoRetry });

backend.startTeammates(() => pipeline.getState().getVisibleIds());

// The Simulation panel is a dev tool for the fake backend; it gets what it needs from here.
export { DEFAULT_SIM, type SimConfig } from '../../server';

// Handy for poking at things from the console and for the e2e test.
Object.assign(window as unknown as Record<string, unknown>, { __pipeline: pipeline, __sim: sim, __server: server });

// The fake server lives in memory; hot-swapping this module would fork it, so reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
