import { describe, expect, it, vi, afterEach } from 'vitest';
import { createFakeApi, createSimStore, FakeServer, generateDeals, type SimConfig } from '../../server';
import { mulberry32 } from '../../shared/random';
import { DAY, type CloseDetails, type StageId } from '../../shared/domain';
import { createPipelineStore, type PipelineOptions } from './pipeline';

const small: Record<StageId, number> = { new: 60, contacted: 40, demo: 20, proposal: 20, negotiation: 20, won: 20, lost: 20 };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
});

async function setup(sim: Partial<SimConfig> = {}, opts: PipelineOptions = {}) {
  const server = new FakeServer(generateDeals(Date.now(), small));
  const simStore = createSimStore({ latencyMin: 5, latencyMax: 15, failureRate: 0, teammateRate: 0, autoRetry: false, ...sim });
  const api = createFakeApi(server, simStore, mulberry32(7));
  const store = createPipelineStore(api, {
    autoRetry: () => simStore.getState().autoRetry,
    backoffMs: () => 10,
    remoteFlushMs: 5,
    offlineProbeMs: 20,
    ...opts,
  });
  cleanups.push(() => store.getState().dispose());
  await store.getState().load();
  store.getState().setTab('new');
  const s = () => store.getState();
  const firstNewDeal = () => s().view.ids[0];
  return { server, sim: simStore, store, s, firstNewDeal };
}

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 3000, interval: 5 });
const PRICE: CloseDetails = { reason: 'price' };

describe('optimistic single move', () => {
  it('shows the move immediately and confirms it with the server', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().setFocus(id);
    s().requestMove('contacted');

    expect(s().display.get(id)!.stage).toBe('contacted'); // optimistic
    expect(s().entries.get(id)?.status).toMatch(/queued|saving/);
    expect(s().view.index.has(id)).toBe(false); // left the "New Lead" list right away

    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('contacted');
    expect(s().server.get(id)!.version).toBe(2);
  });

  it('moves focus to the row that slid into place', async () => {
    const { s } = await setup();
    const [a, b] = s().view.ids;
    s().setFocus(a);
    s().requestMove('demo');
    expect(s().focusId).toBe(b);
  });

  it('coalesces rapid changes: latest intent wins', async () => {
    const { s, server, firstNewDeal } = await setup({ latencyMin: 40, latencyMax: 40 });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    s().moveDeals([{ id, to: 'demo' }]);
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('demo');
    expect(s().display.get(id)!.stage).toBe('demo');
  });
});

describe('failed saves', () => {
  it('rolls back, keeps the failure visible, and can be retried', async () => {
    const { s, sim, server, firstNewDeal } = await setup({ failureRate: 1, autoRetry: false });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'proposal' }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('failed'));

    expect(s().display.get(id)!.stage).toBe('new'); // shows server truth, not a fake success
    expect(s().view.index.has(id)).toBe(true); // reappears in New Lead
    expect(s().toasts.some((t) => t.id === 'failed' && t.sticky)).toBe(true);
    expect(server.get(id)!.stage).toBe('new');

    sim.setState({ failureRate: 0 });
    s().retry(id);
    expect(s().display.get(id)!.stage).toBe('proposal');
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('proposal');
    expect(s().toasts.some((t) => t.id === 'failed')).toBe(false);
  });

  it('auto-retries transient failures before giving up', async () => {
    const { s, sim, server, firstNewDeal } = await setup({ failureRate: 1, autoRetry: true });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('retrying'));
    expect(s().display.get(id)!.stage).toBe('contacted'); // still optimistic while retrying
    sim.setState({ failureRate: 0 });
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('contacted');
  });

  it('rolls back to the latest server state, not the stale snapshot', async () => {
    const { s, server, firstNewDeal } = await setup({ failureRate: 1, latencyMin: 30, latencyMax: 30 });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    server.teammateMove(id, 'u2', 'won'); // teammate acts while our save is in flight
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('failed'));
    await waitFor(() => expect(s().display.get(id)!.stage).toBe('won'));
  });

  it('never applies a change twice when the reply is lost (idempotency key)', async () => {
    const { s, sim, server, firstNewDeal } = await setup({ failureRate: 1, lostReplyRate: 1, autoRetry: true });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'demo' }]);
    await waitFor(() => expect(server.get(id)!.stage).toBe('demo')); // server applied it, client was told "failed"
    sim.setState({ failureRate: 0 });
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.version).toBe(2); // exactly one write
    expect(s().display.get(id)!.stage).toBe('demo');
  });
});

describe('offline', () => {
  it('queues while offline and saves on reconnect', async () => {
    const { s, sim, server, firstNewDeal } = await setup();
    sim.setState({ offline: true });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('waiting'));
    expect(s().online).toBe(false);
    expect(s().display.get(id)!.stage).toBe('contacted');
    expect(s().hasUnsaved()).toBe(true);
    sim.setState({ offline: false });
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('contacted');
    expect(s().online).toBe(true);
  });
});

describe('conflicts with teammates', () => {
  it('does not overwrite a teammate; asks the user instead', async () => {
    const { s, sim, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    sim.setState({ forceConflictNext: true });
    s().moveDeals([{ id, to: 'lost', close: PRICE }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('conflict'));
    const theirs = server.get(id)!.stage;
    expect(theirs).not.toBe('lost');
    expect(s().display.get(id)!.stage).toBe(theirs);
    expect(s().entries.get(id)!.theirs?.stage).toBe(theirs);
    expect(s().toasts.some((t) => t.id === 'conflict')).toBe(true);
  });

  it('"apply mine" re-sends against the new state', async () => {
    const { s, sim, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    sim.setState({ forceConflictNext: true });
    s().moveDeals([{ id, to: 'lost', close: PRICE }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('conflict'));
    s().resolveConflict(id, 'mine');
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('lost');
  });

  it('"keep theirs" drops our change', async () => {
    const { s, sim, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    sim.setState({ forceConflictNext: true });
    s().moveDeals([{ id, to: 'lost', close: PRICE }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('conflict'));
    const theirs = server.get(id)!.stage;
    s().resolveConflict(id, 'theirs');
    expect(s().entries.has(id)).toBe(false);
    expect(s().display.get(id)!.stage).toBe(theirs);
    expect(s().toasts.some((t) => t.id === 'conflict')).toBe(false);
  });
});

describe('stable view under teammates’ changes', () => {
  it('keeps rows in place and holds new deals behind the updates pill', async () => {
    const { s, server } = await setup();
    const before = s().view.ids.slice();
    const moved = before[3];
    server.teammateMove(moved, 'u5', 'demo');
    const created = server.teammateCreate('u6', mulberry32(3));
    await waitFor(() => expect(s().view.departed.has(moved)).toBe(true));
    await waitFor(() => expect(s().view.pendingNew.has(created.id)).toBe(true));

    expect(s().view.ids).toEqual(before); // nothing jumped
    expect(s().display.get(moved)!.stage).toBe('demo'); // but the row shows the truth

    s().refreshView();
    expect(s().view.index.has(moved)).toBe(false);
    expect(s().view.index.has(created.id)).toBe(true);
    expect(s().view.departed.size).toBe(0);
    expect(s().view.pendingNew.size).toBe(0);
  });

  it('ignores the echo of our own save', async () => {
    const { s, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    await new Promise((r) => setTimeout(r, 300)); // let the push arrive
    expect(s().remoteMarks.has(id)).toBe(false);
  });
});

describe('bulk moves', () => {
  it('asks for confirmation, runs as a job, and reports partial failures honestly', async () => {
    const { s, server } = await setup(
      { failureRate: 0.5, autoRetry: false },
      { confirmThreshold: 10, bulkLaneThreshold: 10, bulkChunk: 6 },
    );
    s().selectAll();
    const selected = [...s().selection];
    expect(selected.length).toBe(60);
    s().requestMove('lost');
    expect(s().confirm?.moves.length).toBe(60);
    expect(s().confirm?.closing).toBe('lost');
    expect(s().confirmMove()).toBe('Pick a reason'); // Lost needs a reason; nothing moves yet
    expect(s().confirm).not.toBeNull();
    expect(s().confirmMove({ reason: 'no_decision' })).toBeNull();
    expect(selected.every((id) => s().display.get(id)!.stage === 'lost')).toBe(true);

    const job = [...s().jobs.values()][0];
    await waitFor(() => expect(s().jobs.get(job.id)!.finishedAt).toBeDefined());
    const failed = [...s().entries.values()].filter((e) => e.status === 'failed').length;
    const saved = s().jobs.get(job.id)!.saved;
    expect(saved + failed).toBe(60);
    expect(failed).toBeGreaterThan(0);
    const onServer = selected.filter((id) => server.get(id)!.stage === 'lost').length;
    expect(onServer).toBe(saved);
    expect(selected.filter((id) => server.get(id)!.close?.reason === 'no_decision').length).toBe(saved);
    // Every failed deal is shown where the server has it.
    for (const e of s().entries.values()) expect(s().display.get(e.dealId)!.stage).toBe('new');
  });

  it('skips deals a teammate changed after selection', async () => {
    const { s, server } = await setup({}, { confirmThreshold: 10 });
    s().selectAll();
    const victim = s().view.ids[0];
    server.teammateMove(victim, 'u3', 'won');
    await waitFor(() => expect(s().view.departed.has(victim)).toBe(true));
    s().requestMove('lost');
    expect(s().confirm?.skippedChanged).toBe(1);
    expect(s().confirm?.moves.some((m) => m.id === victim)).toBe(false);
  });

  it('keeps a lane free so single moves do not wait behind a big job', async () => {
    const { s, server } = await setup(
      { latencyMin: 40, latencyMax: 40 },
      { confirmThreshold: 1000, bulkLaneThreshold: 10, bulkChunk: 5, maxInFlight: 2, maxBulkInFlight: 1 },
    );
    const bulkIds = s().view.ids.slice(0, 50);
    s().moveDeals(bulkIds.map((id) => ({ id, to: 'lost', close: PRICE })));
    s().setTab('contacted');
    const single = s().view.ids[0];
    const t0 = Date.now();
    s().moveDeals([{ id: single, to: 'demo' }]);
    await waitFor(() => expect(server.get(single)!.stage).toBe('demo'));
    const singleTime = Date.now() - t0;
    const pendingBulk = bulkIds.filter((id) => server.get(id)!.stage !== 'lost').length;
    expect(pendingBulk).toBeGreaterThan(0); // the job is still running
    expect(singleTime).toBeLessThan(200);
  });

  it('can be cancelled; unsent deals stay where they were', async () => {
    const { s, server } = await setup(
      { latencyMin: 30, latencyMax: 30 },
      { confirmThreshold: 1000, bulkLaneThreshold: 10, bulkChunk: 5, maxBulkInFlight: 1 },
    );
    const ids = s().view.ids.slice(0, 40);
    s().moveDeals(ids.map((id) => ({ id, to: 'lost', close: PRICE })));
    const job = [...s().jobs.values()][0];
    await waitFor(() => expect(s().jobs.get(job.id)!.saved).toBeGreaterThan(0));
    s().cancelJob(job.id);
    await waitFor(() => expect(s().jobs.get(job.id)!.finishedAt).toBeDefined());
    const j = s().jobs.get(job.id)!;
    expect(j.saved + j.cancelled).toBe(40);
    const onServer = ids.filter((id) => server.get(id)!.stage === 'lost').length;
    expect(onServer).toBe(j.saved);
    expect(ids.filter((id) => s().display.get(id)!.stage === 'new').length).toBe(j.cancelled);
  });
});

describe('undo', () => {
  it('moves deals back to where they were', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'negotiation' }]);
    await waitFor(() => expect(server.get(id)!.stage).toBe('negotiation'));
    s().undo();
    expect(s().display.get(id)!.stage).toBe('new');
    await waitFor(() => expect(server.get(id)!.stage).toBe('new'));
  });
});

describe('closing deals: lost reason and won note', () => {
  it('a move to Lost without a reason is refused by the server and not retried', async () => {
    const { s, server, firstNewDeal } = await setup({ autoRetry: true });
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'lost' }]); // skips the dialog, like an old client or a script would
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('failed'));
    const e = s().entries.get(id)!;
    expect(e.rejected).toBe(true);
    expect(e.error).toBe('Pick a reason');
    expect(e.attempts).toBe(0); // refused, not a network error: no automatic retries
    expect(server.get(id)!.stage).toBe('new');
    expect(s().display.get(id)!.stage).toBe('new');
    const toast = s().toasts.find((t) => t.id === 'failed')!;
    expect(toast.actions?.some((a) => a.run === 'retryFailed')).toBe(false);
    s().retryAllFailed(); // resending can't fix it
    expect(s().entries.get(id)?.status).toBe('failed');
  });

  it('every close goes through the dialog, even for one deal', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().setFocus(id);
    s().requestMove('won');
    expect(s().confirm?.closing).toBe('won');
    expect(s().display.get(id)!.stage).toBe('new'); // nothing happens until confirmed
    expect(s().confirmMove({ note: '  Paid upfront ' })).toBeNull();
    expect(s().display.get(id)!.close).toEqual({ note: 'Paid upfront' }); // optimistic, trimmed
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('won');
    expect(server.get(id)!.close).toEqual({ note: 'Paid upfront' });
  });

  it('"Other" needs a note; the reason is stored with the deal', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().setFocus(id);
    s().requestMove('lost');
    expect(s().confirmMove({ reason: 'other' })).toBe('Add a note for "Other"');
    expect(s().confirmMove({ reason: 'other', note: 'Company acquired' })).toBeNull();
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.close).toEqual({ reason: 'other', note: 'Company acquired' });
  });

  it('reopening a deal clears its close details', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'lost', close: PRICE }]);
    await waitFor(() => expect(server.get(id)!.stage).toBe('lost'));
    s().moveDeals([{ id, to: 'negotiation' }]);
    expect(s().display.get(id)!.close).toBeUndefined();
    await waitFor(() => expect(server.get(id)!.stage).toBe('negotiation'));
    expect(server.get(id)!.close).toBeUndefined();
  });

  it('undo puts a Lost deal back with its original reason', async () => {
    const { s, server } = await setup();
    s().setTab('lost');
    const id = s().view.ids[0];
    const original = server.get(id)!.close;
    expect(original?.reason).toBeDefined(); // seeded Lost deals all have a reason
    s().moveDeals([{ id, to: 'won', close: { note: 'Turned it around' } }]);
    await waitFor(() => expect(server.get(id)!.stage).toBe('won'));
    s().undo();
    await waitFor(() => expect(server.get(id)!.stage).toBe('lost'));
    expect(server.get(id)!.close).toEqual(original);
  });
});

describe('bulk edit of fields', () => {
  it('reassigns many deals, then undo gives each its own owner back', async () => {
    const { s, server } = await setup({}, { bulkLaneThreshold: 10, bulkChunk: 7 });
    const ids = s().view.ids.slice(0, 30);
    const before = new Map(ids.map((id) => [id, server.get(id)!.ownerId]));
    s().setSelection(ids);
    s().openEdit();
    expect(s().editing?.ids.length).toBe(30);
    s().applyEdit({ ownerId: 'u7' });
    expect(s().editing).toBeNull();
    expect(ids.every((id) => s().display.get(id)!.ownerId === 'u7')).toBe(true); // optimistic
    await waitFor(() => expect(s().entries.size).toBe(0));
    expect(ids.every((id) => server.get(id)!.ownerId === 'u7')).toBe(true);
    expect(ids.every((id) => server.get(id)!.stage === 'new')).toBe(true); // stage untouched

    s().undo();
    await waitFor(() => expect(s().entries.size).toBe(0));
    // Deals that were already u7's had nothing to change, so nothing to undo either.
    expect(ids.every((id) => server.get(id)!.ownerId === before.get(id))).toBe(true);
  });

  it('shifts each close date by the same number of days', async () => {
    const { s, server } = await setup();
    const ids = s().view.ids.slice(0, 5);
    const before = ids.map((id) => server.get(id)!.closeDate);
    s().openEdit(ids);
    s().applyEdit({ closeDate: { mode: 'shift', days: 30 } });
    await waitFor(() => expect(s().entries.size).toBe(0));
    ids.forEach((id, i) => expect(server.get(id)!.closeDate).toBe(before[i] + 30 * DAY));
  });

  it('a teammate changing the same field first is a conflict; "apply mine" wins after asking', async () => {
    const { s, sim, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    sim.setState({ forceConflictNext: true }); // a teammate reassigns it while our request is on the wire
    s().editDeals([{ id, set: { ownerId: 'u9' } }]);
    await waitFor(() => expect(s().entries.get(id)?.status).toBe('conflict'));
    const e = s().entries.get(id)!;
    const theirs = server.get(id)!.ownerId;
    expect(theirs).not.toBe('u9');
    expect(e.theirs?.fields).toEqual({ ownerId: theirs });
    expect(e.theirs?.stage).toBeUndefined();
    expect(s().display.get(id)!.ownerId).toBe(theirs); // shows the truth until resolved
    s().resolveConflict(id, 'mine');
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.ownerId).toBe('u9');
  });

  it('editing a field never clashes with a teammate moving the deal', async () => {
    const { s, server, firstNewDeal } = await setup({ latencyMin: 30, latencyMax: 30 });
    const id = firstNewDeal();
    s().editDeals([{ id, set: { ownerId: 'u4' } }]);
    server.teammateMove(id, 'u3', 'demo'); // lands before our request does
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('demo');
    expect(server.get(id)!.ownerId).toBe('u4');
  });

  it('a move and an edit made before the first save go out as one request', async () => {
    const { s, server, firstNewDeal } = await setup();
    const id = firstNewDeal();
    s().moveDeals([{ id, to: 'contacted' }]);
    s().editDeals([{ id, set: { ownerId: 'u5' } }]);
    const e = s().entries.get(id)!;
    expect(e.move?.to).toBe('contacted');
    expect(e.edit?.set).toEqual({ ownerId: 'u5' });
    await waitFor(() => expect(s().entries.has(id)).toBe(false));
    expect(server.get(id)!.stage).toBe('contacted');
    expect(server.get(id)!.ownerId).toBe('u5');
    expect(server.get(id)!.version).toBe(2); // one write
  });
});
