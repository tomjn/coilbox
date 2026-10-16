import { type RefObject, useEffect, useRef } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { clampFrame, frameAt, type ScriptTimeline } from "../../scriptPlayback";
import {
  applyTimeline,
  applyTimelineFrame,
  restoreFromPlayback,
} from "./animationPlayback";
import { disposeBaked, showBaked } from "./bakedPlayback";
import { followCamera, setDrive } from "./drivePlayback";
import { bakedVertices, placeEffects } from "./effectsPlayback";
import { attachGizmo } from "./gizmoCommit";
import { refreshSelection } from "./overlayFollow";
import { type SceneState, syncScene } from "./sceneState";
import { placeStandIn, type StandInPlacement } from "./standInPlayback";

export interface ScriptFrameSteppingDeps {
  playing: boolean;
  reduceMotion: boolean;
  selectedIds: string[];
  scriptPaused: boolean;
  scriptTimeline: ScriptTimeline | null;
  scriptFrame: number;
  /** The running scenario's stand-in, and whether it is being shown. */
  standIn: StandInPlacement;
  /** The viewport's effects toggle. */
  showEffects: boolean;
  /** Whether the camera follows a driving unit. */
  follow: boolean;
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
 * Play the unit's script run while playing, and paint a paused run's scrubbed
 * or stepped frame.
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
    standIn,
    showEffects,
    follow,
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
  // Read inside the tick for the same reason the timeline is: switching
  // scenario must not rebuild the bake.
  const standInRef = useRef(standIn);
  standInRef.current = standIn;
  const showEffectsRef = useRef(showEffects);
  showEffectsRef.current = showEffects;
  const followRef = useRef(follow);
  followRef.current = follow;

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
          setDrive(state, standInRef.current.drive?.frames ?? null);
          state.follow = followRef.current;
          applyTimeline(state, projectRef.current, timeline, elapsed);
          followCamera(state);
          placeStandIn(
            state,
            projectRef.current,
            standInRef.current,
            timeline,
            frameAt(timeline, elapsed),
          );
          placeEffects(
            state,
            projectRef.current,
            standInRef.current,
            showEffectsRef.current,
            timeline,
            frameAt(timeline, elapsed),
            bakedVertices(projectRef.current, packRef.current, rawRef.current),
          );
          onScriptFrameRef.current?.(frameAt(timeline, elapsed));
        } else {
          // No run on screen yet, or the last one failed. The unit holds its
          // built pose, and there is no track for a stand-in to be about.
          state.standIn.visible = false;
          state.effects.object.visible = false;
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
      // Stopping puts the scene back to the built pose, and the built pose has
      // nothing standing beside it.
      current.standIn.visible = false;
      current.effects.object.visible = false;
      disposeBaked(current);
      syncScene(current, packRef.current, rawRef.current, projectRef.current);
      refreshSelection(current);
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
    const frame = clampFrame(scriptTimeline, scriptFrame);
    setDrive(state, standIn.drive?.frames ?? null);
    state.follow = follow;
    applyTimelineFrame(state, projectRef.current, scriptTimeline, frame);
    followCamera(state);
    placeStandIn(state, projectRef.current, standIn, scriptTimeline, frame);
    placeEffects(
      state,
      projectRef.current,
      standIn,
      showEffects,
      scriptTimeline,
      frame,
      bakedVertices(projectRef.current, packRef.current, rawRef.current),
    );
    state.render();
  }, [
    sceneRef,
    playing,
    scriptPaused,
    scriptTimeline,
    scriptFrame,
    standIn,
    showEffects,
    follow,
    projectRef,
    packRef,
    rawRef,
  ]);
}
