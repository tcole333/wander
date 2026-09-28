import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalkAudio } from './walkAudio';

const sound = vi.hoisted(() => {
  const engine = {
    ctx: { state: 'running', resume: vi.fn(async () => {}), suspend: vi.fn(async () => {}) },
    setMuted: vi.fn(),
    fade: vi.fn(),
    soon: () => 1,
  };
  return { engine, live: false, unlock: vi.fn() };
});
vi.mock('./engine', () => ({
  unlockedSound: () => (sound.live ? sound.engine : undefined),
  unlockSound: (...args: unknown[]) => {
    sound.unlock(...args);
    sound.live = true;
    return sound.engine;
  },
}));

function page(remembered = '0') {
  const events = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  let value = remembered;
  const storage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => (value = next)),
  };
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
    vi.stubGlobal(name, class {});
  }
  const key = (repeat = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'm', repeat });
    events.dispatchEvent(event);
  };
  return { events, doc, storage, key };
}

beforeEach(() => {
  sound.live = false;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('one sound setting for the lobby and the walk', () => {
  it('shows and changes the remembered mute before any context is unlocked', () => {
    const p = page('1');
    const audio = createWalkAudio();
    expect(audio.muted).toBe(true);
    audio.toggle();
    expect(audio.muted).toBe(false);
    p.key();
    expect(audio.muted).toBe(true);
    p.events.dispatchEvent(new Event('pointerdown'));
    expect(sound.unlock).not.toHaveBeenCalled();
    audio.start(true); // The plaque's click, still in its gesture handler.
    expect(sound.unlock).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect(sound.engine.setMuted).toHaveBeenLastCalledWith(true);
    audio.dispose();
    const later = createWalkAudio();
    expect(later.muted).toBe(true);
    later.dispose();
  });

  it('keeps one M listener across ten trips and disarms gesture unlock on return', () => {
    const p = page();
    const audio = createWalkAudio();
    for (let i = 0; i < 10; i++) {
      audio.start(true);
      audio.leave();
    }
    p.key();
    expect(audio.muted).toBe(true);
    expect(p.storage.setItem).toHaveBeenCalledTimes(1);
    p.key(true);
    expect(p.storage.setItem).toHaveBeenCalledTimes(1);
    expect(sound.unlock).toHaveBeenCalledTimes(1);
    audio.dispose();
    p.key();
    expect(p.storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('holds the setting for this visit when storage is refused', () => {
    const p = page();
    p.storage.getItem.mockImplementation(() => {
      throw new Error('refused');
    });
    p.storage.setItem.mockImplementation(() => {
      throw new Error('refused');
    });
    const audio = createWalkAudio();
    p.key();
    audio.start(true);
    audio.leave();
    expect(audio.muted).toBe(true);
    expect(sound.engine.setMuted).toHaveBeenLastCalledWith(true);
    audio.dispose();
  });

  it('unlocks the direct dev walk on its first gesture, and still lets that knob mute', () => {
    const p = page();
    const audio = createWalkAudio();
    audio.start();
    expect(sound.unlock).not.toHaveBeenCalled();
    p.events.dispatchEvent(new Event('pointerdown'));
    audio.toggle();
    expect(audio.muted).toBe(true);
    expect(sound.engine.setMuted).toHaveBeenLastCalledWith(true);
    audio.dispose();
  });

  it('cancels a pending hidden-tab suspension when disposed', () => {
    vi.useFakeTimers();
    const p = page();
    const audio = createWalkAudio();
    audio.start(true);
    audio.leave();
    p.doc.hidden = true;
    p.doc.dispatchEvent(new Event('visibilitychange'));
    expect(sound.engine.fade).toHaveBeenCalledWith(false, expect.any(Number));
    audio.dispose();
    vi.runAllTimers();
    expect(sound.engine.ctx.suspend).not.toHaveBeenCalled();
  });
});
