// What the lobby dives into: a story, or Explore's free time and events. The boot runs one mode at a
// time (walk/boot.ts), calling its hooks at fixed points of the frame: before the camera moves,
// after the camera and the globe frame are placed, after the scene is drawn for its DOM, and for
// its sound. The lobby starts a mode in the press that chooses its plaque, waits for it to land,
// and on the way back has it leave, then ends it once the return has landed.
import type { MemoryAccount } from '../perf/memory';
import type { FrameContext } from '../scene/frameContext';
import type { WalkState } from '../story/contract';
import type { Precision } from '../story/dates';
import type { Story } from '../story/story';
import type { ViewState } from '../view/viewState';

/** A plaque's choice. */
export type Choice = { kind: 'story'; story: Story } | { kind: 'explore' };

export type Unsubscribe = () => void;

/** What the mode's sound follows this frame: a story's walk, the free clock, or nothing. */
export type ModeAudio =
  | { state: WalkState; unit: Precision }
  | { clock: { day: number; unit: Precision; yearStep: number }; flying: boolean }
  | null;

export interface Mode {
  /** Calls `cb` when the dive into the mode has landed. */
  landed(cb: () => void): Unsubscribe;
  /** How far right what the mode stands at the left shifts the lens, in CSS px, measured now. */
  lensShift(): number;
  /** Every frame, before the view control steps: the mode's own clock and flights. */
  beforeCamera(nowMs: number, dtS: number): void;
  /** Every frame, once the camera and the globe frame are placed, before the look updates. */
  afterPlace(frame: FrameContext, nowMs: number): void;
  /** Every frame, after the scene is drawn: the mode's DOM, given the view drawn. */
  ui(drawn: ViewState, nowMs: number): void;
  audio(): ModeAudio;
  /** The lobby takes the view back: inputs and queries stop, and the sound fades to the room. */
  leave(): void;
  /** The return has landed: releases everything the mode made. */
  end(): void;
  inspectMemory(account: MemoryAccount): void;
}
