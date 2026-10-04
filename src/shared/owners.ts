import type { Owner } from './domain';

const NAMES = [
  'Priya Sharma',
  'Rahul Verma',
  'Ananya Iyer',
  'Vikram Singh',
  'Sneha Reddy',
  'Arjun Mehta',
  'Kavya Nair',
  'Rohan Gupta',
  'Ishita Bose',
  'Aditya Rao',
  'Meera Pillai',
  'Karan Malhotra',
  'Divya Menon',
  'Siddharth Jain',
  'Pooja Desai',
  'Nikhil Kulkarni',
  'Riya Kapoor',
  'Varun Chatterjee',
  'Neha Agarwal',
  'Amit Joshi',
];

export const OWNERS: readonly Owner[] = NAMES.map((name, i) => ({
  id: `u${i + 1}`,
  name,
  initials: name
    .split(' ')
    .map((p) => p[0])
    .join(''),
}));

export const OWNER_BY_ID: Record<string, Owner> = Object.fromEntries(OWNERS.map((o) => [o.id, o]));

/** The signed-in user. Login is out of scope, so we are always Priya. */
export const ME = OWNERS[0];

export const ownerName = (id: string) => (id === ME.id ? 'You' : (OWNER_BY_ID[id]?.name ?? 'Someone'));
export const ownerFirstName = (id: string) => (id === ME.id ? 'You' : (OWNER_BY_ID[id]?.name.split(' ')[0] ?? 'Someone'));
