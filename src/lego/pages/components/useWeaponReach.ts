import { type RefObject, useEffect, useMemo, useState } from "react";
import { animCobProbe } from "../../../animation/bindings";
import { legoProbeScript } from "../../bindings";
import { unitScript } from "../../luaScript";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { pieceRest } from "../../pieceRest";
import type { RawGeometry } from "../../rawGeometry";
import { pieceWorldRest } from "../../s3oBuild";
import { pickedWeapon } from "../../weaponModule";
import { unitReaches, type WeaponReach } from "../../weaponReach";
import { applySceneScale } from "./cameraFraming";
import type { SceneState } from "./sceneState";
import { useWeaponSource } from "./WeaponsSection";
import { buildWeaponReach, disposeWeaponReach } from "./weaponReachLayer";

/**
 * The pieces a unit's own script returns from `AimFromWeapon<n>`, asked of
 * the script itself the way the "Aiming and firing" scenario asks it.
 * Only asked while `ask` is set, since each answer is a run of the script.
 */
function useProbedAimFrom(
  project: LegoProject,
  numbers: number[],
  ask: boolean,
): Map<string, string> {
  const [named, setNamed] = useState(new Map<string, string>());
  const wanted = numbers.join(",");
  useEffect(() => {
    if (!ask || wanted === "") return;
    let current = true;
    const callins = wanted.split(",").map((n) => `AimFromWeapon${n}`);
    const pieces = project.pieces.map((piece) => piece.name);
    // Text somebody owns beats the bytecode the unit came in with, as in the
    // animation panel.
    const compiled =
      project.script === undefined ? project.compiledScript : undefined;
    const probe = compiled
      ? animCobProbe({ bytes: compiled.bytes, pieces, callins })
      : legoProbeScript({
          script: unitScript(project),
          unitName: project.unitName,
          pieces,
          callins,
          unitDef: project.gameUnitDef ?? null,
          includes: project.gameScriptIncludes ?? null,
          rest: pieceRest(project),
        });
    probe
      .then((result) => {
        if (!current) return;
        const next = new Map<string, string>();
        for (const answer of result?.probes ?? []) {
          if (answer.pieces[0]) next.set(answer.callin, answer.pieces[0]);
        }
        setNamed(next);
      })
      // A script that will not load names no piece, and the rings fall back
      // to the unit's origin, as the stand-in's aim does.
      .catch(() => current && setNamed(new Map()));
    return () => {
      current = false;
    };
  }, [project, wanted, ask]);
  return named;
}

/**
 * Each weapon's range and arc, and their drawing while `show` is on.
 *
 * A builder weapon on a generated script is measured from the piece it is
 * mounted on, because that is what the generated `AimFromWeapon<n>` returns.
 * Any other script is asked which piece it returns.
 */
export function useWeaponReach(
  sceneRef: RefObject<SceneState | null>,
  {
    project,
    pack,
    raw,
    show,
  }: {
    project: LegoProject;
    pack: LoadedPack;
    raw: RawGeometry | null;
    show: boolean;
  },
): WeaponReach[] {
  const source = useWeaponSource(project);
  const generated =
    project.script === undefined && project.compiledScript === undefined;

  // Without the pieces first, to learn which weapons there are to ask about.
  const unnamed = useMemo(
    () =>
      unitReaches(
        project,
        (fires) => {
          const picked = pickedWeapon(
            fires,
            source.gameName ?? "",
            source.weaponDefs,
            source.projects,
          );
          return picked && "def" in picked ? picked.def : null;
        },
        source.weaponDefs ?? {},
        (_number, mountedOn) => (generated ? mountedOn : null),
      ),
    [project, source.gameName, source.weaponDefs, source.projects, generated],
  );
  const toAsk = unnamed
    .filter((reach) => reach.aimFrom === null)
    .map((reach) => reach.number);
  const probed = useProbedAimFrom(project, toAsk, show);
  const reaches = useMemo(
    () =>
      unnamed.map((reach) =>
        reach.aimFrom !== null
          ? reach
          : {
              ...reach,
              aimFrom: probed.get(`AimFromWeapon${reach.number}`) ?? null,
            },
      ),
    [unnamed, probed],
  );

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.weaponReach) disposeWeaponReach(state.weaponReach);
    state.weaponReach = null;
    if (show && reaches.length > 0) {
      state.weaponReach = buildWeaponReach(
        reaches,
        pieceWorldRest(project, pack, raw),
      );
      state.overlay.add(state.weaponReach);
    }
    applySceneScale(state);
    state.render();
  }, [sceneRef, show, reaches, project, pack, raw]);

  return reaches;
}
