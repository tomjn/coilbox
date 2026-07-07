import { useSetting } from "@picoframe/frame";
import { useEffect, useState } from "react";

/**
 * User display preferences shared by every animated surface — the conquest
 * galaxy, the campaign panorama/flourishes and the 3D map previews. All three
 * live in the frame settings store (General settings → Display) so readers
 * and the settings toggles can't drift.
 */

export type ReduceMotionSetting = "system" | "on" | "off";

const REDUCE_MOTION_KEY = "display.reduceMotion";
const EFFECTS_KEY = "display.effects";
const PERFORMANCE_KEY = "display.performanceMode";

/** `[value, setValue]` for the reduce-motion tri-state toggle. */
export function useReduceMotionSetting() {
  return useSetting<ReduceMotionSetting>(REDUCE_MOTION_KEY, "system");
}

/** `[enabled, setEnabled]` for ambient effects (twinkle, scroll, flourishes). */
export function useEffectsSetting() {
  return useSetting<boolean>(EFFECTS_KEY, true);
}

/** `[enabled, setEnabled]` for performance mode (lower res, fewer particles). */
export function usePerformanceModeSetting() {
  return useSetting<boolean>(PERFORMANCE_KEY, false);
}

/** Live `prefers-reduced-motion` media query as React state. */
function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Should motion be reduced? The user setting wins ("on"/"off"); "system"
 * (default) follows the OS `prefers-reduced-motion` preference live.
 */
export function useReduceMotion(): boolean {
  const [setting] = useReduceMotionSetting();
  const system = useSystemReducedMotion();
  if (setting === "on") return true;
  if (setting === "off") return false;
  return system;
}

/** Are ambient effects enabled? */
export function useEffectsEnabled(): boolean {
  return useEffectsSetting()[0];
}

/** Is performance mode on? */
export function usePerformanceMode(): boolean {
  return usePerformanceModeSetting()[0];
}

/** One flag for "skip decorative animation": reduce-motion or effects-off. */
export function useStillUi(): boolean {
  const reduce = useReduceMotion();
  const effects = useEffectsEnabled();
  return reduce || !effects;
}
