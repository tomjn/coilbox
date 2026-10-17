import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Measurement } from "../../measure";
import { isShortcut } from "../../shortcuts";
import type { Vec3 } from "../../snapping";
import { drawMeasurements } from "./measureLayer";
import type { SceneState } from "./sceneState";

/** Whether the key press was meant for a text field. */
function typing(event: KeyboardEvent): boolean {
  return (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  );
}

/**
 * The measure tool's state, and the drag readout's, wired to the scene.
 *
 * Measurements live here and nowhere else: they stay while the tool is left,
 * until cleared, and are never saved with the unit or exported.
 *
 * `scene` is only a dependency to pick up the fresh scene `useCanvas3D` builds
 * when it rebuilds, which would otherwise lose the lines and the callbacks.
 */
export function useMeasure(
  sceneRef: RefObject<SceneState | null>,
  scene: unknown,
) {
  const [active, setActive] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [start, setStart] = useState<Vec3 | null>(null);
  const [hover, setHover] = useState<Vec3 | null>(null);
  const [moved, setMoved] = useState<Vec3 | null>(null);
  // The click handler is registered once, so it reads the first point here.
  const startRef = useRef<Vec3 | null>(null);

  const clear = useCallback(() => {
    setMeasurements([]);
    startRef.current = null;
    setStart(null);
    setHover(null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scene is only here to rerun the effect on a rebuilt scene
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.measure.active = active;
    state.measure.onPick = (at) => {
      const from = startRef.current;
      if (!from) {
        startRef.current = at;
        setStart(at);
        return;
      }
      startRef.current = null;
      setStart(null);
      setHover(null);
      setMeasurements((all) => [
        ...all,
        { id: crypto.randomUUID(), from, to: at },
      ]);
    };
    // Only while a first point waits: nothing is drawn for a pointer alone.
    state.measure.onHover = (at) => {
      if (startRef.current) setHover(at);
    };
    state.measure.onDrag = (next) =>
      setMoved((prev) =>
        prev && next && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    if (!active) {
      startRef.current = null;
      setStart(null);
      setHover(null);
    }
  }, [sceneRef, scene, active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scene is only here to rerun the effect on a rebuilt scene
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    drawMeasurements(
      state,
      measurements,
      start ? { from: start, to: hover } : null,
    );
  }, [sceneRef, scene, measurements, start, hover]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if (isShortcut("measure", event)) setActive((on) => !on);
      else if (active && isShortcut("measure-stop", event)) setActive(false);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [active]);

  return { active, setActive, measurements, start, hover, moved, clear };
}
