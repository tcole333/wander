// The museum's lamp and lens, shared by the scene (museumScene.ts) and the DOM parts drawn to sit
// in its photograph (the walk's time ruler): the key lamp's color, and the finish pass's vignette,
// which darkens by smoothstep(from, to) of the distance from the view's center in view heights.
export const KEY_LAMP = 0xffd6a8;
export const LENS = { vignette: 0.72, from: 0.28, to: 1.05 } as const;

/** The key lamp as a CSS color. */
export const KEY_LAMP_CSS = `#${KEY_LAMP.toString(16).padStart(6, '0')}`;
