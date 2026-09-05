import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { clampFrame, frameAt, type ScriptTimeline } from "../../scriptPlayback";
import {
  applyAnimation,
  applyTimeline,
  applyTimelineFrame,
  restoreFromPlayback,
} from "./animationPlayback";
import { disposeBaked, showBaked } from "./bakedPlayback";
import { attachGizmo } from "./gizmoCommit";
import { type SceneState, syncScene } from "./sceneState";

export interface ScriptFrameSteppingDeps {
  playing: boolean;
  reduceMotion: boolean;
  selectedIds: string[];
  scriptPaused: boolean;
  scriptTimeline: ScriptTimeline | null;
  scriptFrame: number;
  packRef: RefObject<LoadedPack>;
  rawRef: RefObject<RawGeometry | null>;
  projectRef: RefObject<LegoProject>;
  scriptTimelineRef: RefObject<ScriptTimeline | null>;
  scriptPausedRef: RefObject<boolean>;
  scriptFrameRef: RefObject<number>;
  onScriptFrameRef: RefObject<((frame: number) => void) | undefined>;
  placingAnchorRef: RefObject<boolean>;
}

/**
 * Run the applied presets or the unit's own script while playing, and paint a
 * paused run's scrubbed or stepped frame.
 *
 * The two stay together because both are "script frame stepping": one drives
 * the running clock, the other paints the one frame a paused run is held on.
 */
export function useScriptFrameStepping(
  sceneRef: RefObject<SceneState | null>,
  {
    playing,
    reduceMotion,
    selectedIds,
    scriptPaused,
    scriptTimeline,
    scriptFrame,
    packRef,
    rawRef,
    projectRef,
    scriptTimelineRef,
    scriptPausedRef,
    scriptFrameRef,
    onScriptFrameRef,
    placingAnchorRef,
  }: ScriptFrameSteppingDeps,
) {
  // Playback. The gizmo comes off first: it would be dragging a transform that
  // is overwritten on the next frame. Stopping puts the scene back from the
  // document, which is the rest pose by definition.
  //
  // Pausing a script run does not stop this effect: it keeps ticking so it can
  // notice a resume, it just skips posing and rendering while paused, holding
  // whatever the last unpaused tick drew. Read through refs rather than a
  // dependency, so pausing, scrubbing and stepping never tear the bake down.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !playing || reduceMotion) return;

    state.gizmo.detach();
    showBaked(state, packRef.current, rawRef.current, projectRef.current);
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    let wasPaused = false;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (scriptPausedRef.current) {
        wasPaused = true;
      } else {
        const timeline = scriptTimelineRef.current;
        if (timeline) {
          // Resuming picks the clock back up from wherever a pause or a scrub
          // while paused left the frame, rather than from where it froze.
          if (wasPaused) {
            elapsed =
              clampFrame(timeline, scriptFrameRef.current) / timeline.fps;
            wasPaused = false;
          }
          elapsed += dt;
          applyTimeline(state, projectRef.current, timeline, elapsed);
          onScriptFrameRef.current?.(frameAt(timeline, elapsed));
        } else {
          elapsed += dt;
          applyAnimation(state, projectRef.current, elapsed);
        }
        state.render();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      const current = sceneRef.current;
      if (!current) return;
      restoreFromPlayback(current);
      disposeBaked(current);
      syncScene(current, packRef.current, rawRef.current, projectRef.current);
      attachGizmo(
        current,
        projectRef.current,
        selectedIds,
        placingAnchorRef.current,
      );
      current.render();
    };
  }, [
    sceneRef,
    playing,
    reduceMotion,
    selectedIds,
    packRef,
    rawRef,
    projectRef,
    scriptPausedRef,
    scriptTimelineRef,
    scriptFrameRef,
    onScriptFrameRef,
    placingAnchorRef,
  ]);

  // Scrubbing or stepping a paused script run. The tick above paints every
  // frame while it is not paused, and leaves the frozen frame alone otherwise,
  // so this is what paints the frame it froze on.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !playing || !scriptPaused || !scriptTimeline) return;
    applyTimelineFrame(
      state,
      projectRef.current,
      scriptTimeline,
      clampFrame(scriptTimeline, scriptFrame),
    );
    state.render();
  }, [
    sceneRef,
    playing,
    scriptPaused,
    scriptTimeline,
    scriptFrame,
    projectRef,
  ]);
}
