import { OWNERS } from '../shared/owners';
import { between, mulberry32, pick } from '../shared/random';
import { DAY, LOST_REASONS, type CloseDetails, type Deal, type StageId } from '../shared/domain';

const PREFIX = [
  'Acme',
  'Zenith',
  'Nimbus',
  'Vertex',
  'Lotus',
  'Saffron',
  'Indigo',
  'Banyan',
  'Crimson',
  'Orbit',
  'Pinnacle',
  'Quantum',
  'Monsoon',
  'Himalaya',
  'Ganga',
  'Peacock',
  'Teak',
  'Cobalt',
  'Silverline',
  'Bluestone',
  'Northwind',
  'Evergreen',
  'Lighthouse',
  'Riverstone',
  'Sunrise',
  'Polaris',
  'Nova',
  'Tandem',
  'Kestrel',
  'Falcon',
  'Granite',
  'Harbor',
  'Juniper',
  'Maple',
  'Onyx',
  'Prism',
  'Redwood',
  'Sterling',
  'Trident',
  'Vanguard',
];
const CORE = [
  'Analytics',
  'Logistics',
  'Health',
  'Finserv',
  'Retail',
  'Foods',
  'Motors',
  'Pharma',
  'Textiles',
  'Energy',
  'Infra',
  'Media',
  'Learning',
  'Realty',
  'Agro',
  'Steel',
  'Telecom',
  'Travel',
  'Insurance',
  'Cloud',
];
const SUFFIX = ['Pvt Ltd', 'Ltd', 'Corp', 'Industries', 'Group', 'Solutions', 'Labs', 'Systems', 'Ventures', 'Technologies'];

/** Stage sizes add up to 50,000; New Lead and Contacted are the 10k+ stages. */
export const DEFAULT_DISTRIBUTION: Record<StageId, number> = {
  new: 12000,
  contacted: 10000,
  demo: 7000,
  proposal: 5000,
  negotiation: 3000,
  won: 6000,
  lost: 7000,
};

export function generateDeals(now: number, distribution: Record<StageId, number> = DEFAULT_DISTRIBUTION, seed = 42): Deal[] {
  const rand = mulberry32(seed);
  // Separate stream so adding close details didn't change any other generated value.
  const closeRand = mulberry32(seed + 1);
  const deals: Deal[] = [];
  let n = 0;
  for (const stage of Object.keys(distribution) as StageId[]) {
    const count = distribution[stage];
    const open = stage !== 'won' && stage !== 'lost';
    for (let i = 0; i < count; i++) {
      n++;
      const owner = pick(rand, OWNERS);
      // Licences are skewed: most deals are small, a few are big.
      const licences = Math.max(5, Math.round(Math.pow(rand(), 2.2) * 600));
      const pricePerLicence = Math.round(between(rand, 4, 20)) * 1000;
      const value = licences * pricePerLicence;

      // Activity recency: most deals are being worked on, a long tail is stale.
      const r = rand();
      const daysSinceActivity = r < 0.55 ? between(rand, 0, 7) : r < 0.85 ? between(rand, 7, 30) : between(rand, 30, 240);
      const daysInStage = daysSinceActivity + between(rand, 0, 40);
      const lastActivityAt = Math.round(now - daysSinceActivity * DAY);
      const stageEnteredAt = Math.round(now - daysInStage * DAY);
      // Reps mostly keep close dates current; a few slip past due.
      const closeDate = open
        ? Math.round(now + (rand() < 0.06 ? -between(rand, 1, 30) : between(rand, 0, 120)) * DAY)
        : Math.round(now - between(rand, 0, 180) * DAY);

      deals.push({
        id: `d${n}`,
        ref: `D-${10000 + n}`,
        company: `${pick(rand, PREFIX)} ${pick(rand, CORE)} ${pick(rand, SUFFIX)}`,
        licences,
        value,
        ownerId: owner.id,
        stage,
        stageEnteredAt,
        lastActivityAt,
        closeDate,
        close: open ? undefined : seedClose(stage, closeRand),
        version: 1,
        updatedAt: lastActivityAt,
        updatedBy: owner.id,
      });
    }
  }
  // Shuffle so ids are not grouped by stage (closer to a real dataset).
  for (let i = deals.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deals[i], deals[j]] = [deals[j], deals[i]];
  }
  return deals;
}

// Roughly how deals are lost in B2B SaaS: no decision and price lead.
const LOST_WEIGHTS = [0.22, 0.17, 0.14, 0.26, 0.1, 0.07, 0.04];
const OTHER_NOTES = ['Company acquired', 'Project cancelled', 'Duplicate deal', 'Moved to a reseller'];
const WON_NOTES = [
  'Annual plan, paid upfront',
  'Champion: head of ops',
  'Expansion likely next year',
  'Beat the incumbent on support',
];

function seedClose(stage: StageId, rand: () => number): CloseDetails | undefined {
  if (stage === 'won') return rand() < 0.25 ? { note: pick(rand, WON_NOTES) } : undefined;
  let r = rand();
  let i = 0;
  while (i < LOST_WEIGHTS.length - 1 && r >= LOST_WEIGHTS[i]) r -= LOST_WEIGHTS[i++];
  const reason = LOST_REASONS[i].id;
  return reason === 'other' ? { reason, note: pick(rand, OTHER_NOTES) } : { reason };
}

export function randomCompany(rand: () => number) {
  return `${pick(rand, PREFIX)} ${pick(rand, CORE)} ${pick(rand, SUFFIX)}`;
}
