// A flight no story directs: the lobby's way back to its home view, and Explore's dive onto its
// opening. It takes the walk's flight path and easing (story/flight.ts), so it moves as a beat's
// flight does, and its caller jumps the view to each step.
import { flightEase, flightPath, flightSeconds, type FlightPath } from '../story/flight';
import type { ViewState } from './viewState';

export class FreeFlight {
  /** How long the flight takes, s. */
  readonly seconds: number;
  readonly #path: FlightPath;
  #elapsed = 0;

  constructor(from: ViewState, to: ViewState) {
    this.#path = flightPath(from, to);
    this.seconds = flightSeconds(this.#path.length);
  }

  /** Moves on by `dtS` seconds and gives the view there. */
  step(dtS: number): ViewState {
    this.#elapsed = Math.min(this.seconds, this.#elapsed + dtS);
    return this.#path.at(flightEase(this.#elapsed / this.seconds));
  }

  get done(): boolean {
    return this.#elapsed >= this.seconds;
  }
}
