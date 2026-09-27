// The walk's story effects (contract.ts WalkEffects): the ember, the plume, pulses, callout
// plaques, and the illustrative ash and veil, each a function of story time, so scrubbing backward
// shows the right state. The plume, ash and veil belong to the story: any beat that lists them
// turns them on for every beat, and story time alone shows or hides them, so they never vanish as
// a flight leaves the beat that lists them. Pulses and plaques come from the beat's effect list,
// and its layers switch the look's lines and bathymetry. `group` hangs from the museum's globeMount (the globe frame, radius 1).
import {
  Group,
  MathUtils,
  Matrix4,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type SpotLight,
} from 'three';
import { ashUniformsOf } from '../../look/ashHook';
import type { Params, ViewportCss } from '../../contract';
import type { CreateWalkEffects, WalkState } from '../contract';
import { dayFromIso } from '../dates';
import type { LonLat, Story, StoryBeat } from '../story';
import { Callouts } from './callouts';
import { Ember } from './ember';
import { dirOf, EARTH_KM, EARTH_M, tangents } from './geo';
import { Plume, VENT_M } from './plume';
import { PulseDisc } from './pulses';
import { emberHeat, plumeState, pulseState, type PlumeEffect, type PulseEffect } from './timeline';
import { Veil } from './veil';

/** The illustrative ashfall's extent: west, east, south, north (story: 105-125E, 12-2S). */
const ASH_BOX: [number, number, number, number] = [105, 125, -12, -2];
const ASH_ANCHOR = dayFromIso('1815-04-10');
/** Where the museum's key lamp stands, if the scene has no spot light to ask. */
const LAMP_FALLBACK = new Vector3(-4.2, 5.2, 9.5);

/** The beat's layers the look can switch, and the look param each one sets. */
const LAYERS: [layer: string, param: string, off: number | boolean][] = [
  ['graticule', 'graticule', 0],
  ['coastline', 'coastLine', 0],
  ['water', 'riverLine', 0],
  ['bathymetry', 'bathymetry', false],
];

function plumeOf(beat: StoryBeat): PlumeEffect | undefined {
  return beat.effects.find((e): e is PlumeEffect => e.kind === 'plume');
}

/** Whether any beat spreads `dataset`. */
function spreads(story: Story, dataset: string): boolean {
  return story.beats.some((beat) =>
    beat.effects.some((e) => e.kind === 'spread' && e.dataset === dataset),
  );
}

/**
 * Where the beat's ember glows, on the beats whose focal event is the eruption (a beat with a
 * plume, or one sharing its focal event with such a beat): the focal place if the beat names one,
 * else the vent, from the beat's plume or its focal event's.
 */
function emberPlace(story: Story, beat: StoryBeat): { at: LonLat; vent: boolean } | undefined {
  const own = plumeOf(beat);
  const kin = story.beats.find((b) => b.focal.qid === beat.focal.qid && plumeOf(b));
  const erupting = own ?? (kin ? plumeOf(kin) : undefined);
  if (!erupting) return undefined;
  if (beat.focal.at) return { at: beat.focal.at, vent: false };
  return { at: erupting.at, vent: true };
}

export const createWalkEffects: CreateWalkEffects = (story, look, labelRoot) => {
  const params: Params = { ember: 1, plume: 1, pulses: 1, labels: 1, ash: 1, veil: 1 };
  const group = new Group();
  group.name = 'walk-effects';
  const ember = new Ember();
  const veil = new Veil();
  group.add(ember.group, veil.mesh);
  const callouts = new Callouts(labelRoot);
  const ash = ashUniformsOf(look.material);
  const defaults = new Map(LAYERS.map(([, param]) => [param, look.params[param]]));

  const erupting = story.beats.map(plumeOf).find(Boolean);
  const plume = erupting && { effect: erupting, draw: new Plume(erupting) };
  if (plume) group.add(plume.draw.mesh);
  const ashOn = spreads(story, 'ash-1815');
  const veilOn = spreads(story, 'veil-1815');

  let shown = -1;
  let pulses: PulseDisc[] = [];
  let lamp: SpotLight | null | undefined;

  const camera = new Vector3();
  const lampLocal = new Vector3();
  const toView = new Matrix4();
  const place = new Vector3();

  const show = (beat: StoryBeat) => {
    for (const pulse of pulses) {
      group.remove(pulse.mesh);
      pulse.dispose();
    }
    pulses = beat.effects
      .filter((e): e is PulseEffect => e.kind === 'pulse')
      .map((e) => new PulseDisc(e));
    for (const pulse of pulses) group.add(pulse.mesh);
    callouts.set(beat.effects.flatMap((e) => (e.kind === 'callout' ? [e] : [])));
    for (const [layer, param, off] of LAYERS) {
      if (!(param in look.params)) continue;
      look.params[param] = beat.layers.includes(layer) ? (defaults.get(param) ?? off) : off;
    }
  };

  return {
    group,
    params,

    update(state: WalkState, cam: PerspectiveCamera, globe: Object3D, viewport: ViewportCss, t) {
      const beat = state.story.beats[state.beat];
      if (!beat) return;
      if (state.beat !== shown) {
        shown = state.beat;
        show(beat);
      }
      const day = state.day;
      const kLand = look.params.flatRelief === true ? 0 : Number(look.params.kLand);
      const strength = (name: string) => Math.max(0, Number(params[name]));

      // The camera and the lamp in the globe frame, and the globe frame as the camera sees it.
      globe.updateWorldMatrix(true, false);
      globe.worldToLocal(cam.getWorldPosition(camera));
      if (lamp === undefined) lamp = findSpotLight(globe);
      const lampWorld = lamp ? lamp.getWorldPosition(new Vector3()) : LAMP_FALLBACK.clone();
      lampLocal.copy(globe.worldToLocal(lampWorld)).normalize();
      toView.multiplyMatrices(cam.matrixWorldInverse, globe.matrixWorld);
      const tanHalf = Math.tan(MathUtils.degToRad(cam.fov) / 2);
      /** Globe units per CSS pixel, and the view's width in km, at a globe-frame point. */
      const pxWorld = (p: Vector3) => (2 * camera.distanceTo(p) * tanHalf) / viewport.height;
      const viewKmAt = (p: Vector3) => pxWorld(p) * viewport.width * EARTH_KM;

      // Ember.
      const where = emberPlace(story, beat);
      if (where) {
        const height = where.vent ? kLand * VENT_M : 0;
        dirOf(where.at, place).multiplyScalar(1 + height / EARTH_M);
        const toCamera = camera.distanceTo(place);
        const facing = (camera.dot(place) / place.length() - place.length()) / toCamera;
        const heat = emberHeat(erupting, day) * strength('ember');
        ember.update(place, heat, pxWorld(place), facing, t);
      } else {
        ember.update(place, 0, 1, 0, t);
      }

      // Plume.
      if (plume) {
        dirOf(plume.effect.at, place);
        plume.draw.update({
          state: plumeState(plume.effect, day),
          heat: emberHeat(plume.effect, day),
          kLand,
          viewKm: viewKmAt(place),
          camera,
          lamp: lampLocal,
          toView,
          strength: strength('plume'),
          elapsedS: t,
        });
      }

      // Pulses.
      for (const pulse of pulses) {
        dirOf(pulse.effect.at, place);
        pulse.update(pulseState(pulse.effect, day), kLand, viewKmAt(place), strength('pulses'), t);
      }

      // Ash, through the look.
      if (ash) {
        ash.lookAshStrength.value = ashOn ? strength('ash') : 0;
        if (ashOn) {
          const source = erupting ?? {
            at: [118, -8.25] as LonLat,
            peak: ASH_ANCHOR,
            drift: [-1, 1] as [number, number],
          };
          dirOf(source.at, ash.lookAshCenter.value);
          const { east, north } = tangents(source.at);
          ash.lookAshAxis.value
            .copy(east.multiplyScalar(source.drift[0]).addScaledVector(north, source.drift[1]))
            .normalize();
          ash.lookAshDay.value = day - source.peak;
          ash.lookAshBox.value.set(...ASH_BOX);
        }
      }

      // Veil, by the view's width under the camera.
      const altitude = Math.max(0, camera.length() - 1);
      const wideKm = 2 * altitude * tanHalf * cam.aspect * EARTH_KM;
      veil.update(day, kLand, wideKm, camera, lampLocal, veilOn ? strength('veil') : 0, t);

      callouts.update(state.flight === null, cam, camera, globe, viewport, strength('labels'));
    },

    dispose() {
      if (ash) ash.lookAshStrength.value = 0;
      for (const [param, value] of defaults) if (value !== undefined) look.params[param] = value;
      plume?.draw.dispose();
      for (const pulse of pulses) pulse.dispose();
      ember.dispose();
      veil.dispose();
      callouts.clear();
      group.removeFromParent();
    },
  };
};

function findSpotLight(from: Object3D): SpotLight | null {
  let root = from;
  while (root.parent) root = root.parent;
  return (root.getObjectByProperty('isSpotLight', true) as SpotLight | undefined) ?? null;
}
