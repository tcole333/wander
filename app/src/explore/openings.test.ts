import { describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { dayFromIso } from '../story/dates';
import {
  openingForDive,
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
      precision: 'day',
      at: [4.41222, 50.67806],
    });
  });

  it('carry no Meanwhile date label, which would print Hastings as 20 October 1066', () => {
    const hastings = openings.find((opening) => opening.qid === 'Q83224');
    expect(hastings).not.toHaveProperty('dateLabel');
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
  it('opens a dive on the pinned opening on this machine, and on any other elsewhere', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const pinned = { hostname: '127.0.0.1', search: '?opening=Q83224' };
    expect(openingForDive(pinned).name).toBe('Battle of Hastings');
    const elsewhere = { hostname: 'wander.traviscole.xyz', search: '?opening=Q83224' };
    const picks = Array.from({ length: tunables.openingsRecent }, () => openingForDive(elsewhere));
    // Hastings was seen last, so none of the next few opens on it.
    expect(picks.map((opening) => opening.qid)).not.toContain('Q83224');
    vi.unstubAllGlobals();
  });

  it('pins an opening on a page served from this machine only', () => {
    expect(
      openingRequested({ hostname: '127.0.0.1', search: '?data=fixture&opening=Q48314' }),
    ).toBe('Q48314');
    expect(openingRequested({ hostname: 'localhost', search: '?data=fixture' })).toBeNull();
    expect(
      openingRequested({ hostname: 'wander.traviscole.xyz', search: '?opening=Q48314' }),
    ).toBeNull();
  });

  it('passes a malformed pin on as given, so the pick throws on it', () => {
    for (const typed of ['waterloo', 'q48314', 'Q048314', '']) {
      const pinned = openingRequested({ hostname: 'localhost', search: `?opening=${typed}` });
      expect(() => pickOpening(openings, { pinned, storage: memoryStorage })).toThrow(
        `no opening '${typed}'`,
      );
    }
  });

  it('reads a pin without the spaces around it', () => {
    expect(openingRequested({ hostname: 'localhost', search: '?opening=%20Q48314%20' })).toBe(
      'Q48314',
    );
  });
});
