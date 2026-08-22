/**
 * The UI zoom setting, and the keyboard shortcuts that reach it.
 *
 * Zoom is reachable two ways, General settings and the usual zoom keys, and
 * both flip the one settings key so they cannot drift. That is the shape
 * `./fullscreen` already uses for F11 and its toggle. Boot-time application
 * lives in `main.tsx`, so a zoomed session does not draw one frame at 100% and
 * then jump.
 *
 * The maths and the webview call are in `../lib/uiZoom`, which the 3D canvas
 * hook reads too and which must not pull React in with it.
 */

import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect } from "react";
import {
  applyUiZoom,
  DEFAULT_UI_ZOOM,
  stepUiZoom,
  UI_ZOOM_KEY,
} from "../lib/uiZoom";
import { CloseDrawerOnNavigate } from "./drawer";

/** `[zoom, setZoom]` for the UI zoom level, as a scale factor where 1 is 100%. */
export function useUiZoomSetting() {
  return useSetting<number>(UI_ZOOM_KEY, DEFAULT_UI_ZOOM);
}

/**
 * The general plugin's Provider: keeps the webview at the stored zoom, listens
 * for the zoom keys, and closes the drawer on a navigation.
 *
 * Composed here rather than in `index.ts` because that file has no JSX, and
 * because both halves are the same kind of thing: app-wide behaviour with no UI
 * of its own.
 */
export function GeneralProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useUiZoomSetting();

  // Keep the webview at whatever the setting says, whichever surface changed it.
  useEffect(() => {
    applyUiZoom(zoom);
  }, [zoom]);

  // Cmd/Ctrl with plus, minus or zero, which is what anybody tries first. A
  // plain keydown listener for the same reason F11 uses one: there is no
  // global-shortcut plugin, and the webview's own zoom hotkeys are off (Tauri
  // leaves `zoomHotkeysEnabled` unset), so nothing else is claiming these.
  //
  // Zero is the way back. It is reachable at any zoom, including one big enough
  // to have pushed the settings screen off the edge of the window.
  //
  // `zoom` is a dep so the handler always steps from the current value: the
  // store's setter takes a value rather than an updater.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // `=` and `_` are the unshifted keys people reach for `+` and `-` with,
      // and the numpad sends `Add`/`Subtract` through as `+` and `-` already.
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom(stepUiZoom(zoom, 1));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom(stepUiZoom(zoom, -1));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(DEFAULT_UI_ZOOM);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, setZoom]);

  return <CloseDrawerOnNavigate>{children}</CloseDrawerOnNavigate>;
}
