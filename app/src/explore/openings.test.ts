import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { dayFromIso } from '../story/dates';
import {
  openingRequested,
  openings,
  openingsFromLock,
  pickOpening,
  RECENT_KEY,
  type LockedOpening,
  type Opening,
} from './openings';

const waterloo: LockedOpening = {
  qid: 'Q48314',
  label: 'Battle of Waterloo',
  date: '1815-06-18',
  precision: 'day',
  at: [4.41222, 50.67806],
  line: 'At Waterloo, Wellington and Blücher defeat Napoleon in his last battle',
  source: { title: 'Battle of Waterloo (Wikipedia)', url: 'https://example.org/waterloo' },
  class: 'battle',
};

/** Storage held in a Map, as a browser's localStorage behaves. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

function refusing(): Storage {
  const store = memoryStorage();
  store.getItem = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  store.setItem = () => {
    throw new DOMException('full', 'QuotaExceededError');
  };
  return store;
}

function listed(count: number): Opening[] {
  return openingsFromLock({
    table: '0'.repeat(64),
    openings: Array.from({ length: count }, (_, i) => ({ ...waterloo, qid: `Q${i + 1}` })),
  });
}

/** A seeded generator, so a run of picks is the same every time. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe('the openings', () => {
  it('read as Meanwhile’s entries, with the event’s name and class', () => {
    const [opening] = openingsFromLock({ table: '0'.repeat(64), openings: [waterloo] });
    expect(opening).toMatchObject({
      qid: 'Q48314',
      label: waterloo.line,
      name: 'Battle of Waterloo',
      class: 'battle',
      day: dayFromIso('1815-06-18'),
      at: [4.41222, 50.67806],
    });
  });

  it('bundled, include Waterloo, each with a line, an https source and a class, up to 2000', () => {
    expect(openings.map((opening) => opening.qid)).toContain('Q48314');
    expect(openings.length).toBeGreaterThan(tunables.openingsRecent);
    for (const opening of openings) {
      expect(opening.label).not.toBe(opening.name);
      expect(opening.source.url).toMatch(/^https:\/\//);
      expect(opening.class).not.toBe('');
      expect(opening.day).toBeLessThanOrEqual(dayFromIso('2000-12-31'));
    }
  });
});

describe('the pick', () => {
  it('never opens on one of the visitor’s last openingsRecent, and remembers only those', () => {
    const storage = memoryStorage();
    const random = seeded(7);
    const picked: string[] = [];
    for (let visit = 0; visit < 200; visit += 1) {
      const { qid } = pickOpening(openings, { storage: () => storage, random });
      expect(picked.slice(-tunables.openingsRecent)).not.toContain(qid);
      picked.push(qid);
    }
    const remembered: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]');
    expect(remembered).toEqual(picked.slice(-tunables.openingsRecent));
  });

  it('still opens when storage throws, whether reached or read', () => {
    const unreachable = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(pickOpening(openings, { storage: unreachable, random: () => 0 })).toBe(openings[0]);
    expect(pickOpening(openings, { storage: refusing, random: () => 0.999 })).toBe(openings.at(-1));
  });

  it('reads a stored list it does not recognise as none', () => {
    const storage = memoryStorage();
    storage.setItem(RECENT_KEY, '{"not": "a list"');
    const choices = listed(2);
    expect(pickOpening(choices, { storage: () => storage, random: () => 0 }).qid).toBe('Q1');
    storage.setItem(RECENT_KEY, JSON.stringify([42, 'Q1', 'Waterloo']));
    expect(pickOpening(choices, { storage: () => storage, random: () => 0 }).qid).toBe('Q2');
  });

  it('with too few openings to skip the recent ones, skips only the last', () => {
    const storage = memoryStorage();
    const choices = listed(3);
    storage.setItem(RECENT_KEY, JSON.stringify(['Q1', 'Q2', 'Q3']));
    expect(pickOpening(choices, { storage: () => storage, random: () => 0.999 }).qid).toBe('Q2');
    expect(pickOpening(listed(1), { storage: () => storage }).qid).toBe('Q1');
  });

  it('opens on a pinned opening and remembers it; a pin the list lacks throws', () => {
    const storage = memoryStorage();
    const pinned = pickOpening(openings, { pinned: 'Q48314', storage: () => storage });
    expect(pinned.name).toBe('Battle of Waterloo');
    expect(JSON.parse(storage.getItem(RECENT_KEY) ?? '[]')).toEqual(['Q48314']);
    expect(() => pickOpening(openings, { pinned: 'Q1', storage: () => storage })).toThrow(
      "no opening 'Q1'",
    );
  });
});

describe('?opening=', () => {
  it('pins an opening on a page served from this machine only', () => {
    expect(openingRequested({ hostname: '127.0.0.1', search: '?explore&opening=Q48314' })).toBe(
      'Q48314',
    );
    expect(openingRequested({ hostname: 'localhost', search: '?opening=waterloo' })).toBeNull();
    expect(openingRequested({ hostname: 'localhost', search: '?explore' })).toBeNull();
    expect(
      openingRequested({ hostname: 'wander.traviscole.xyz', search: '?opening=Q48314' }),
    ).toBeNull();
  });
});
