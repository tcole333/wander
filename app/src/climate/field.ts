// The look's climate field (streaming.md 3.5): one per look, the only writer of its
// lookClimateField. A story's climate (story/effects/climate.ts) and Explore's (clock.ts) each ask
// it for a blend of two months; it remembers which months of which files it holds, and rewrites
// and uploads the field only when asked for another. So a Tambora dive after Explore redraws its
// month instead of keeping Explore's, and a blend asked for again costs nothing.
import { DataUtils } from 'three';
import { blendMonths, type ClimateFile, type Month, type MonthBlend } from '../data/climate';
import type { ModeraRelease } from '../data/release';
import { CLIMATE_GRID, type ClimateUniforms } from '../look/climateHook';
import type { MemoryAccount } from '../perf/memory';

const HALF_ONE = DataUtils.toHalfFloat(1);

/** A blend's weight closer than this to the one held draws the same field. */
const SAME_W = 1e-4;

/** What the field holds: month `blend.from` of `from` blended toward month `blend.to` of `to`. */
interface Held {
  from: ClimateFile;
  to: ClimateFile;
  blend: MonthBlend;
}

const sameMonth = (a: Month, b: Month) => a.year === b.year && a.month === b.month;

export class ClimateField {
  readonly #uniforms: ClimateUniforms;
  /** The blend in K per cell, before it is packed into the texture's half floats. */
  readonly #scratch = new Float32Array(CLIMATE_GRID.nlat * CLIMATE_GRID.nlon);
  #held: Held | null = null;

  constructor(uniforms: ClimateUniforms) {
    this.#uniforms = uniforms;
  }

  /** Lays the field on the release's grid: its first column, column step and Gaussian rows. */
  useGrid({ lat, lon0, dlon }: ModeraRelease): void {
    const [north = 90, south = -90] = [lat[0], lat[lat.length - 1]];
    const step = (north - south) / Math.max(1, lat.length - 1);
    this.#uniforms.lookClimateGrid.value.set(lon0, dlon, north, step);
  }

  /** Whether the field holds `blend` of `from` and `to`. */
  holds(from: ClimateFile, to: ClimateFile, blend: MonthBlend): boolean {
    const held = this.#held;
    return (
      held !== null &&
      held.from === from &&
      held.to === to &&
      sameMonth(held.blend.from, blend.from) &&
      sameMonth(held.blend.to, blend.to) &&
      Math.abs(held.blend.w - blend.w) < SAME_W
    );
  }

  /**
   * Makes the field hold `blend` of month `blend.from.month` of `from` and `blend.to.month` of
   * `to` (on the field's grid), uploading it unless it already does; true when it rewrote.
   */
  draw(from: ClimateFile, to: ClimateFile, blend: MonthBlend): boolean {
    if (this.holds(from, to, blend)) return false;
    const field = this.#scratch;
    blendMonths(from, blend.from.month, to, blend.to.month, blend.w, field);
    const texture = this.#uniforms.lookClimateField.value;
    const data = texture.image.data as Uint16Array;
    for (let i = 0; i < field.length; i += 1) {
      const k = field[i] ?? NaN;
      const present = !Number.isNaN(k);
      data[2 * i] = present ? DataUtils.toHalfFloat(k) : 0;
      data[2 * i + 1] = present ? HALF_ONE : 0;
    }
    texture.needsUpdate = true;
    this.#held = { from, to, blend };
    return true;
  }

  /** How strongly the look draws the field, 0 to 1: 0 leaves the look as it is. */
  set strength(value: number) {
    this.#uniforms.lookClimateStrength.value = value;
  }

  inspectMemory(account: MemoryAccount): void {
    account.array('climate.blendScratch', this.#scratch);
  }
}

const fields = new WeakMap<ClimateUniforms, ClimateField>();

/** The one field of a look's climate uniforms (look/climateHook.ts climateUniformsOf). */
export function climateFieldOf(uniforms: ClimateUniforms | undefined): ClimateField | undefined {
  if (!uniforms) return undefined;
  let field = fields.get(uniforms);
  if (!field) {
    field = new ClimateField(uniforms);
    fields.set(uniforms, field);
  }
  return field;
}
