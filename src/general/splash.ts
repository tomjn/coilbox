import { useSetting } from "@picoframe/frame";
import { getProfile } from "../profile/profile";

/**
 * User preference to silence the distribution profile's startup splash. Default on
 * (unset === shown); only an explicit `false` suppresses it. Boot-time application
 * (deciding whether to render the splash at all) lives in `main.tsx`, which reads
 * this key straight from the settings cache — see {@link SPLASH_ENABLED_KEY}.
 */
export const SPLASH_ENABLED_KEY = "splash.enabled";

/** `[enabled, setEnabled]` for the "show startup splash" toggle. Defaults to on. */
export function useSplashSetting() {
  return useSetting<boolean>(SPLASH_ENABLED_KEY, true);
}

/** Whether the active profile ships a splash — gates showing the toggle at all. */
export function hasProfileSplash(): boolean {
  return getProfile().splash != null;
}
