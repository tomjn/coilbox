import { Button, useSetting } from "@picoframe/frame";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect } from "react";
import { getProfile } from "../profile/profile";

/**
 * Fullscreen mode is reachable three ways — F11, a top-bar button, and the
 * General-settings toggle — but they all flip a single settings key so they
 * can't drift. One effect (in `FullscreenControls`) applies the key to the OS
 * window, mirroring the `advanced.enabled` single-source-of-truth shape in
 * `./advanced`. Boot-time application (to avoid a windowed flash before the
 * effect mounts) lives in `main.tsx`.
 */
const FULLSCREEN_KEY = "window.fullscreen";

/**
 * `[enabled, setEnabled]` for the fullscreen toggle. The default seeds from the
 * distribution profile (`profile.fullscreen`) so a branded build can open
 * fullscreen; a user's persisted toggle shadows it thereafter.
 */
export function useFullscreenSetting() {
  return useSetting<boolean>(FULLSCREEN_KEY, getProfile().fullscreen ?? false);
}

/**
 * Kiosk lock from the distribution profile: fullscreen is forced and the toggle
 * controls (button, settings switch, F11) are removed. Consulted by the controls
 * and the boot-apply so the lock knowledge lives in one place.
 */
export function isFullscreenLocked(): boolean {
  return getProfile().fullscreenLocked === true;
}

/**
 * Distribution profile opt-out of the fullscreen affordance (`layout.fullscreenButton:
 * false`): hides the top-bar button and makes F11 inert, without forcing fullscreen
 * on (that's {@link isFullscreenLocked}). Independent of the lock, so a windowed
 * build can simply drop the button.
 */
function isFullscreenButtonHidden(): boolean {
  return getProfile().layout?.fullscreenButton === false;
}

/** Best-effort: push the setting to the OS window; must not throw. */
export function applyFullscreen(enabled: boolean): void {
  getCurrentWindow()
    .setFullscreen(enabled)
    .catch((e) => console.warn("fullscreen: setFullscreen failed", e));
}

/**
 * Top-bar control (contributed to the `topbar.right` slot). Owns the effect that
 * keeps the OS window in sync with the setting from any trigger, and the F11
 * keydown listener. Renders a toggle button whose icon reflects current state.
 */
export function FullscreenControls() {
  const locked = isFullscreenLocked();
  const [fs, setFs] = useFullscreenSetting();
  // A kiosk lock or a profile that hides the fullscreen button both remove the
  // affordance: no button, no F11. The lock additionally forces fullscreen on.
  const hidden = locked || isFullscreenButtonHidden();

  // Keep the OS window in sync with the setting, whichever surface changed it.
  // A locked (kiosk) build forces fullscreen and ignores the stored setting.
  useEffect(() => {
    applyFullscreen(locked || fs);
  }, [locked, fs]);

  // F11 toggles the setting. No global-shortcut plugin exists, so a plain DOM
  // keydown listener is the lightest route. `fs` is a dep so the handler always
  // toggles against the current value (the store's setter takes a value, not an
  // updater function). Inert when the affordance is hidden (kiosk or profile).
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        setFs(!fs);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, fs, setFs]);

  // No toggle button when the affordance is hidden (locked kiosk or profile opt-out).
  if (hidden) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => setFs(!fs)}
    >
      {fs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </Button>
  );
}
