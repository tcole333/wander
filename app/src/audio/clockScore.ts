// Explore's sound (issue #79), in the walk's voices (walkAudio.ts) with no story to follow: the
// museum's room tone, coming in once the dive has landed, as a story's bed does, since the whir
// carries the dive (the lobby's own room tone when a museum bed plays it, else a new bed, whose
// noise builds between the dive's frames); the whir through every free flight
// (view/freeFlight.ts) at the camera's pace; and a detent for each mark the free ruler's playhead
// passes among those the ruler engraves at that moment: its days and months as a story's ruler
// does, or, coarser, each year it labels, every year or every labelled step of decades, centuries
// or millennia, walking from one labelled year to the next rather than day by day. The free ruler engraves history's calendar, Julian
// before the reform (story/dates.ts), and its detents fall where its marks do.
import { HISTORICAL, type Precision } from '../story/dates';
import { landBed, MUSEUM, museumBed, prepareBed, type Bed, type RoomBed } from './bed';
import type { SoundEngine } from './engine';
import { marksPassed } from './marks';
import { Detents, FlightWhir } from './voices';

/** The free clock as its sound hears it: its day, and what the ruler engraves around it. */
export interface ClockHeard {
  day: number;
  /** The finest unit the ruler engraves now. */
  unit: Precision;
  /** The years between the years it labels, where it labels years (TimeRuler.yearStep). */
  yearStep: number;
}

/** One frame of Explore, as its sound hears it. */
export interface ClockFrame {
  clock: ClockHeard;
  /** Whether a free flight has the camera: the dive, or a flight to a Meanwhile entry. */
  flying: boolean;
  /** The camera's pace, 0 (still) to 1 (a flight's usual peak). */
  pace: number;
  /** When the frame sounds on the audio clock, and the seconds since the last frame. */
  at: number;
  dt: number;
}

/**
 * The most marks a frame walks. A drag passes at most the ruler's width of its finest marks, a
 * few hundred days on the widest screens; a move past more (a flight along the overview, or Home
 * and End to history's ends) is one the pacer could sound only a few detents of, so it walks
 * coarser marks instead, and a leap across twelve thousand years costs no more than a drag.
 */
const MOST_MARKS = 400;

/** Explore's sound on an engine, from the clock's day when the sound began. */
export class ClockScore {
  readonly #engine: SoundEngine;
  readonly #detents: Detents;
  readonly #whir: FlightWhir;
  /** The museum's room tone, from the dive's landing. */
  #bed: Bed | null = null;
  /** The room left by a walk or an earlier Explore, reused or crossfaded at the landing. */
  #room: RoomBed | null;
  #day: number;

  constructor(engine: SoundEngine, day: number, room: RoomBed | null = null) {
    this.#engine = engine;
    this.#room = room;
    this.#detents = new Detents(engine);
    this.#whir = new FlightWhir(engine);
    this.#day = day;
    // The room tone's noise builds between the dive's frames, rather than in its landing's.
    prepareBed(engine, MUSEUM);
  }

  frame({ clock, flying, pace, at, dt }: ClockFrame): void {
    const engine = this.#engine;
    // The marks the playhead passed since the last frame, spread over that frame's time, though
    // never before the clock, as the walk's are.
    const from = this.#day;
    const to = clock.day;
    if (to !== from) {
      const passed = marksPassed(from, to, clock.unit, {
        calendar: HISTORICAL,
        yearStep: clock.yearStep,
        most: MOST_MARKS,
      });
      for (const mark of passed) {
        const when = at - dt + (dt * (mark.day - from)) / (to - from);
        this.#detents.play(mark.weight, Math.max(engine.ctx.currentTime, when));
      }
      this.#day = to;
    }
    this.#whir.frame(flying, pace, at);
    if (this.#bed || flying) return;
    this.#bed = landBed(this.#room, MUSEUM, () => museumBed(engine, to, at), at);
    this.#room = null;
  }

  /** The return: the whir stops, and the room tone plays on in the lobby for the next dive. */
  toRoom(at: number): RoomBed | null {
    this.#whir.stop(at);
    const room = this.#bed ? { bed: this.#bed, voice: MUSEUM } : this.#room;
    room?.bed.toRoom(at);
    this.#bed = null;
    this.#room = null;
    return room;
  }

  /** Fades everything Explore has playing. */
  stop(at: number): void {
    this.#whir.stop(at);
    this.#bed?.stop(at);
    this.#room?.bed.stop(at);
    this.#bed = null;
    this.#room = null;
  }
}
