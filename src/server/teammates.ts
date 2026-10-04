import { ME, OWNERS } from '../shared/owners';
import { DAY, STAGE_BY_ID } from '../shared/domain';
import type { FakeServer } from './db';
import type { SimConfig } from './simConfig';

/**
 * Simulates 19 teammates working on the same pipeline.
 *
 * `getHotIds` returns the deals currently on the user's screen; with
 * probability `hotspot` an edit lands on one of them so that live updates
 * and conflicts are actually visible during a demo.
 */
export function startTeammates(
  server: FakeServer,
  getConfig: () => SimConfig,
  getHotIds: () => string[],
  rand: () => number = Math.random,
) {
  const TICK = 100;
  let budget = 0;
  const timer = setInterval(() => {
    const { teammateRate, hotspot } = getConfig();
    budget += (teammateRate * TICK) / 1000;
    while (budget >= 1) {
      budget -= 1;
      editOnce(rand() < hotspot);
    }
    // Fractional rates: fire probabilistically so 0.3/s still produces edits.
    if (budget > 0 && rand() < budget) {
      budget = 0;
      editOnce(rand() < hotspot);
    }
  }, TICK);

  function editOnce(hot: boolean) {
    const hotIds = hot ? getHotIds() : [];
    const id = hotIds.length ? hotIds[Math.floor(rand() * hotIds.length)] : server.randomId(rand);
    const deal = server.get(id);
    if (!deal) return;
    const actor = deal.ownerId !== ME.id ? deal.ownerId : server.randomTeammate(rand);
    const r = rand();
    const open = STAGE_BY_ID[deal.stage].open;
    if (r < 0.5 && open) {
      // Mostly forward moves; sometimes a deal is lost.
      server.teammateMove(id, actor, rand() < 0.12 ? 'lost' : undefined);
    } else if (r < 0.72) {
      server.teammateEditValue(id, actor, 0.7 + rand() * 0.6);
    } else if (r < 0.8) {
      const owner = OWNERS[Math.floor(rand() * OWNERS.length)];
      server.teammateReassign(id, actor, owner.id);
    } else if (r < 0.86 && open) {
      server.teammateSetCloseDate(id, actor, deal.closeDate + Math.round(7 + rand() * 21) * DAY);
    } else if (r < 0.95) {
      server.teammateLogActivity(id, actor);
    } else {
      server.teammateCreate(server.randomTeammate(rand), rand);
    }
  }

  return () => clearInterval(timer);
}
