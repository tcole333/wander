import { afterEach, expect, it, vi } from 'vitest';
import { ViewControl } from './viewControl';

const WORLD = { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 };

afterEach(() => vi.unstubAllGlobals());

it('drops a held key and drag when the return takes the camera, then accepts fresh input', () => {
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
    vi.stubGlobal(name, class {});
  }
  const canvas = Object.assign(new EventTarget(), { clientWidth: 1440, setPointerCapture() {} });
  const control = new ViewControl(WORLD);
  const detach = control.attach(canvas as unknown as HTMLElement);
  const key = () => events.dispatchEvent(Object.assign(new Event('keydown'), { key: '+' }));
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: 200,
        button: 0,
        pointerId: 1,
        shiftKey: false,
      }),
    );
  key();
  pointer('pointerdown', 200);
  control.enabled = false;
  control.enabled = true;
  pointer('pointermove', 600); // The old drag must not resume after the flight.
  control.step(100, 0.1);
  expect(control.current).toEqual(WORLD);
  key();
  control.step(200, 0.1);
  expect(control.current.viewKm).toBeLessThan(WORLD.viewKm);
  detach();
  control.go(WORLD, true);
  key();
  control.step(300, 0.1);
  expect(control.current).toEqual(WORLD);
});
