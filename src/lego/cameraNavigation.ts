import { MOUSE } from "three";

/**
 * Which mouse buttons and modifier keys move the builder's camera. Coilbox is
 * the original scheme. Blender and 3ds Max copy those programs' scheme for
 * players who bring their habits from them.
 */
export type NavigationPreset = "coilbox" | "blender" | "3dsmax";

export const NAVIGATION_PRESETS: readonly NavigationPreset[] = [
  "coilbox",
  "blender",
  "3dsmax",
];

export const DEFAULT_NAVIGATION_PRESET: NavigationPreset = "coilbox";

export type CameraMove = "orbit" | "pan" | "zoom";

export type PointerModifiers = {
  /** 0 left, 1 middle, 2 right, as `PointerEvent.button`. */
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

export type MouseButtonMap = { LEFT: number; MIDDLE: number; RIGHT: number };

/** The buttons the preset has when no key is held. */
export function presetFromStored(
  value: string | null | undefined,
): NavigationPreset {
  return (
    NAVIGATION_PRESETS.find((p) => p === value) ?? DEFAULT_NAVIGATION_PRESET
  );
}

/**
 * What a drag moves, or null when the drag does not move the camera. Only the
 * Blender and 3ds Max presets are listed here: Coilbox is left to
 * OrbitControls' own defaults.
 *
 * Command counts as Control, so a Mac player can use either.
 */
export function moveFor(
  preset: Exclude<NavigationPreset, "coilbox">,
  m: PointerModifiers,
): CameraMove | null {
  if (m.button !== 1) return null;
  const ctrl = m.ctrl || m.meta;
  if (preset === "blender") {
    if (m.alt) return null;
    if (ctrl && m.shift) return null;
    if (ctrl) return "zoom";
    if (m.shift) return "pan";
    return "orbit";
  }
  if (m.shift) return null;
  if (m.alt) return ctrl ? "zoom" : "orbit";
  return ctrl ? null : "pan";
}

const NO_MOVE = -1;

/**
 * The `controls.mouseButtons` to hold for a drag that starts with these
 * modifiers. OrbitControls swaps rotate and pan when Ctrl, Command or Shift is
 * down, so the entry for a swapped move is the other one.
 */
export function mouseButtonsFor(
  preset: NavigationPreset,
  m: PointerModifiers,
): MouseButtonMap {
  if (preset === "coilbox") {
    return { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  }
  const move = moveFor(preset, m);
  const swapped = m.ctrl || m.meta || m.shift;
  let action = NO_MOVE;
  if (move === "zoom") action = MOUSE.DOLLY;
  else if (move === "orbit") action = swapped ? MOUSE.PAN : MOUSE.ROTATE;
  else if (move === "pan") action = swapped ? MOUSE.ROTATE : MOUSE.PAN;
  return { LEFT: NO_MOVE, MIDDLE: action, RIGHT: NO_MOVE };
}

/** The mouse controls a preset has, for the shortcut sheet. */
export type NavigationControl = {
  move: CameraMove;
  /** Modifier keys held, in the order they are named, then the button. */
  keys: ("ctrl" | "shift" | "alt")[];
  button: "left" | "middle" | "right" | "wheel";
};

export function navigationControls(
  preset: NavigationPreset,
): NavigationControl[] {
  if (preset === "blender") {
    return [
      { move: "orbit", keys: [], button: "middle" },
      { move: "pan", keys: ["shift"], button: "middle" },
      { move: "zoom", keys: ["ctrl"], button: "middle" },
      { move: "zoom", keys: [], button: "wheel" },
    ];
  }
  if (preset === "3dsmax") {
    return [
      { move: "pan", keys: [], button: "middle" },
      { move: "orbit", keys: ["alt"], button: "middle" },
      { move: "zoom", keys: ["ctrl", "alt"], button: "middle" },
      { move: "zoom", keys: [], button: "wheel" },
    ];
  }
  return [
    { move: "orbit", keys: [], button: "left" },
    { move: "zoom", keys: [], button: "middle" },
    { move: "pan", keys: [], button: "right" },
    { move: "zoom", keys: [], button: "wheel" },
  ];
}
