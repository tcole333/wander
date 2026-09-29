// What a plate says about one event (spec section 3): markers carry no text, so the labels ask the
// worker for the rows they show. Plain functions over the resident index, run in the worker.
import { labelAt } from './page';
import type { EventIndex, Ref } from './residency';

export interface EventDescription {
  /** Global row, the key the query's marks carry. */
  row: number;
  qid: number;
  /** The Wikidata label as the index holds it; the plate capitalises and trims it. */
  label: string;
  /** The display parent's label, when that parent is resident. */
  parent?: string;
  /** The row has a display parent that no resident page held: a later page may name it. */
  partial?: true;
  /** Inclusive day numbers covering the date's precision, as on the marks (3.4). */
  t0: number;
  t1: number;
  /** Wikidata precision, 0-14 (11 day, 10 month, 9 year). */
  prec: number;
}

/** The row's description, or undefined when no resident page holds it. */
export function describe(index: EventIndex, row: number): EventDescription | undefined {
  const ref = index.row(row);
  return ref && describeRef(index, ref);
}

export function describeRef(index: EventIndex, { page: p, i }: Ref): EventDescription {
  const parentRow = p.parent[i]!;
  const parent = parentRow === -1 ? undefined : index.row(parentRow);
  return {
    row: p.row[i]!,
    qid: p.qid[i]!,
    label: labelAt(p, i),
    ...(parent ? { parent: labelAt(parent.page, parent.i) } : {}),
    ...(parentRow !== -1 && !parent ? { partial: true as const } : {}),
    t0: p.t0[i]!,
    t1: p.t1[i]!,
    prec: p.prec[i]!,
  };
}
