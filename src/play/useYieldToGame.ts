import { useEffect, useState } from "react";
import { usePlay } from "./PlayProvider";

/** True when coilbox is minimised, covered, or not the focused window. */
function inBackground(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

/**
 * True while a game is running and coilbox is not in front, so a 3D map can
 * stop drawing and leave the GPU to the engine. Looking back at coilbox
 * mid-game shows the map again.
 */
export function useYieldToGame(): boolean {
  const { running } = usePlay();
  const [background, setBackground] = useState(inBackground);

  useEffect(() => {
    // Both checks are needed. `visibilityState` catches being minimised or
    // covered by another app in full screen, and stays "visible" for a window
    // that is merely not the focused one, which is the alt-tab case.
    const update = () => setBackground(inBackground());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  return running && background;
}
