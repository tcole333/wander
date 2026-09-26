// The instrument's fades: a part is whole far from the camera and gone close to it, and the whole
// instrument is gone near the globe's surface.
import { describe, expect, test } from 'vitest';
import { instrumentOpacity, partOpacity } from './fade';

describe('partOpacity', () => {
  test('a part far from the camera shows whole', () => {
    expect(partOpacity(2, 0.25, 0.8)).toBe(1);
  });

  test('a part the camera is passing through is gone', () => {
    expect(partOpacity(0.1, 0.25, 0.8)).toBe(0);
  });

  test('a part fades more as the camera nears it', () => {
    expect(partOpacity(0.4, 0.25, 0.8)).toBeLessThan(partOpacity(0.6, 0.25, 0.8));
  });
});

describe('instrumentOpacity', () => {
  test('the instrument shows whole in the world view', () => {
    expect(instrumentOpacity(5.9, 0.3)).toBe(1);
  });

  test('the instrument is gone within the hide altitude', () => {
    expect(instrumentOpacity(0.29, 0.3)).toBe(0);
  });
});
