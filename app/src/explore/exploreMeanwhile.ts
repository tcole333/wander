// Explore's Meanwhile (spec section 5; streaming.md 5.3): what else happens in the now window,
// elsewhere, in the story's panel (story/ui/meanwhile.ts, MeanwhileList). Each frame once the dive
// has landed it stands the event worker's Meanwhile question for the now window and the view, the
// events the globe draws and the focal one left out; the client asks it once the clock and view
// have rested for meanwhileRest. Each answer lists up to meanwhileCount events off the screen, each
// named as its plate names it (plateText.ts), dated as history writes it and sourced to its
// Wikipedia article; an entry whose dates the now window has left goes at once, before the next
// answer. Choosing one flies there (explore.ts), and the landing pins it. A keyboard visitor on an
// entry keeps their place as answers change the list; once none is left, the focus goes to `heir`
// (Explore's events listbox).
import { tunables } from '../config/tunables';
import type { MeanwhileEvent, MeanwhileQuery } from '../events/meanwhile';
import { eventViewOf, type ViewFrame } from '../events/view';
import type { MeanwhileEntry } from '../story/contract';
import type { LonLat } from '../story/story';
import { MeanwhileList } from '../story/ui/meanwhile';
import { nowWindow, type WorldTime } from '../time/worldClock';
import type { ViewState } from '../view/viewState';
import { inWindow, type FocalEvent } from './exploreEvents';
import { eventDate, eventName, sourceOf } from './plateText';

/** What Explore's Meanwhile needs of its events (exploreEvents.ts). */
export interface MeanwhileEvents {
  askMeanwhile(query: MeanwhileQuery): void;
  readonly meanwhile: readonly MeanwhileEvent[] | null;
  drawnQids(): number[];
  readonly focal: FocalEvent | null;
}

/** An event the worker picks, as Meanwhile's panel lists it. */
export function entryOf(event: MeanwhileEvent): MeanwhileEntry {
  return {
    label: eventName(event.label),
    day: event.t0,
    dateLabel: eventDate(event.t0, event.t1, event.prec),
    at: event.at,
    qid: `Q${event.qid}`,
    source: sourceOf(event.qid),
  };
}

export class ExploreMeanwhile {
  readonly #events: MeanwhileEvents;
  readonly #list: MeanwhileList;
  /** The answer last taken, and its events with their entries, by Q number (`Q…`). */
  #answer: readonly MeanwhileEvent[] | null = null;
  #listed = new Map<string, { entry: MeanwhileEntry; event: MeanwhileEvent }>();
  /** The Q numbers shown, to tell when they change. */
  #shown: string | null = null;

  /** `choose` flies to the event chosen; `heir` takes the focus from an emptied list. */
  constructor(
    events: MeanwhileEvents,
    choose: (event: MeanwhileEvent) => void,
    heir: () => HTMLElement | null = () => null,
  ) {
    this.#events = events;
    // By Q number: an answer naming the same events leaves their rows as they stand.
    this.#list = new MeanwhileList(
      (entry) => {
        const listed = entry.qid === undefined ? undefined : this.#listed.get(entry.qid);
        if (listed) choose(listed.event);
      },
      { heir },
    );
    this.#list.element.hidden = true;
  }

  get element(): HTMLElement {
    return this.#list.element;
  }

  /** Every frame, once the frame is placed: Meanwhile's question for the now window and view. */
  ask(frame: ViewFrame, time: WorldTime, [lon, lat]: LonLat): void {
    const window = nowWindow(time);
    const focal = this.#events.focal;
    this.#events.askMeanwhile({
      t0: window.start,
      t1: window.end,
      center: [lon, lat],
      view: eventViewOf(frame),
      count: tunables.meanwhileCount,
      exclude: this.#events.drawnQids(),
      focalQids: focal ? [focal.qid] : [],
    });
  }

  /** Every frame, after the draw: the last answer's entries still now, turned toward `view`. */
  update(view: ViewState, time: WorldTime): void {
    const answer = this.#events.meanwhile;
    if (answer !== this.#answer) {
      this.#answer = answer;
      this.#listed = new Map(
        (answer ?? []).map((event) => [`Q${event.qid}`, { entry: entryOf(event), event }]),
      );
    }
    const window = nowWindow(time);
    const now = [...this.#listed.values()].filter(({ event }) => inWindow(event, window));
    const shown = now.map(({ event }) => event.qid).join(' ');
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#list.show(now.map(({ entry }) => entry));
    }
    this.#list.update(view);
  }
}
