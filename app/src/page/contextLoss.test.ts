import { describe, expect, it } from 'vitest';
import { afterContextLoss, LOSS_WINDOW_MS } from './contextLoss';

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value),
  };
}

describe('afterContextLoss', () => {
  it('reloads once, then rests when the context is lost again within the window', () => {
    const store = memory();
    expect(afterContextLoss(() => store, 1_000)).toBe('reload');
    expect(afterContextLoss(() => store, 1_000 + LOSS_WINDOW_MS / 2)).toBe('rest');
    expect(afterContextLoss(() => store, 1_000 + 2 * LOSS_WINDOW_MS)).toBe('reload');
  });

  it('rests when the browser refuses session storage', () => {
    const refused = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(afterContextLoss(refused, 1_000)).toBe('rest');
  });
});
