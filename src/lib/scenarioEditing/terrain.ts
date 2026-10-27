/**
 * A base's terrain steps as the editor edits them (issue #4793).
 *
 * Each rule takes the document and a base id and hands a document back, the
 * way every rule in `./bases.ts` does, so the blueprint editor's undo and redo
 * cover them with nothing new to write. The geometry is in
 * `@/blueprint/terrainEdit.ts`, and what is here puts it in the document.
 *
 * A step the game would refuse is never written. Each rule that changes a
 * step's shape asks `stepRefusal` first and hands the same document back when
 * the answer is a limit, so a caller can compare identities to tell the edit
 * did not happen.
 */

import type { TerrainStep } from "@/blueprint/model";
import { stepRefusal } from "@/blueprint/terraform";
import {
  type BuildEntry,
  cornerAdded,
  cornerMoved,
  cornerRemoved,
  movedInSequence,
  movedStep,
  stepAdded,
} from "@/blueprint/terrainEdit";
import type { Point, Scenario } from "@/scenario/model";
import { editBaseTerrain, type LayoutEdit, moveBuilding } from "./bases";

/** One step changed by `change`, unless the change makes nothing new or a
 *  step the game would refuse. */
function editStep(
  scenario: Scenario,
  id: string,
  index: number,
  change: (step: TerrainStep) => TerrainStep,
  how: LayoutEdit,
): Scenario {
  return editBaseTerrain(scenario, id, how, (terrain) => {
    const step = terrain[index];
    if (!step) return null;
    const next = change(step);
    if (next === step || stepRefusal(next)) return null;
    const out = terrain.slice();
    out[index] = next;
    return out;
  });
}

/**
 * The document with a new step in a base's layout, before every building, and
 * where it went in `terrain`. The same document and -1 when the game would
 * refuse the step.
 */
export function addStep(
  scenario: Scenario,
  id: string,
  step: TerrainStep,
  how: LayoutEdit = "own",
): { scenario: Scenario; index: number } {
  if (stepRefusal(step)) return { scenario, index: -1 };
  let index = -1;
  const next = editBaseTerrain(scenario, id, how, (terrain) => {
    const added = stepAdded(terrain, step);
    index = added.index;
    return added.terrain;
  });
  return { scenario: next, index };
}

/** The document with one step moved `delta` elmos, snapped to the grid. */
export function moveStep(
  scenario: Scenario,
  id: string,
  index: number,
  delta: Point,
  how: LayoutEdit = "own",
): Scenario {
  return editStep(scenario, id, index, (s) => movedStep(s, delta), how);
}

/** The document with one corner of a step moved `delta` elmos. */
export function moveStepCorner(
  scenario: Scenario,
  id: string,
  index: number,
  corner: number,
  delta: Point,
  how: LayoutEdit = "own",
): Scenario {
  return editStep(
    scenario,
    id,
    index,
    (s) => cornerMoved(s, corner, delta),
    how,
  );
}

/** The document with a corner added to a step on one side, at `at`. */
export function addStepCorner(
  scenario: Scenario,
  id: string,
  index: number,
  edge: number,
  at: Point,
  how: LayoutEdit = "own",
): Scenario {
  return editStep(scenario, id, index, (s) => cornerAdded(s, edge, at), how);
}

/** The document with a corner taken off a step, unless it has too few. */
export function removeStepCorner(
  scenario: Scenario,
  id: string,
  index: number,
  corner: number,
  how: LayoutEdit = "own",
): Scenario {
  return editStep(scenario, id, index, (s) => cornerRemoved(s, corner), how);
}

/** Whether a step raises or levels, which are the two kinds that can swap. */
function heightened(kind: TerrainStep["kind"] | undefined): boolean {
  return kind === "raise" || kind === "level";
}

/** What {@link setStep} can change. `only: "both"` puts a level or ramp back to
 *  changing the ground both ways, since an absent `only` means no change. */
export type StepPatch = Partial<
  Pick<TerrainStep, "kind" | "height" | "heights" | "width">
> & { only?: "both" | "raise" | "lower" };

/**
 * The document with a step's height, kind, ends, width or `only` changed. Only
 * the fields the step's kind uses are taken, so a wall cannot be handed a
 * ramp's width. A step made a raise has no `only`, which only a level and a
 * ramp have.
 */
export function setStep(
  scenario: Scenario,
  id: string,
  index: number,
  patch: StepPatch,
  how: LayoutEdit = "own",
): Scenario {
  return editStep(
    scenario,
    id,
    index,
    (step) => {
      const next: TerrainStep = { ...step };
      let changed = false;
      if (
        heightened(patch.kind) &&
        heightened(step.kind) &&
        patch.kind !== step.kind &&
        patch.kind
      ) {
        next.kind = patch.kind;
        if (patch.kind === "raise") delete next.only;
        changed = true;
      }
      if (
        patch.only &&
        (next.kind === "level" || next.kind === "ramp") &&
        patch.only !== (next.only ?? "both")
      ) {
        if (patch.only === "both") delete next.only;
        else next.only = patch.only;
        changed = true;
      }
      if (
        patch.height !== undefined &&
        Number.isFinite(patch.height) &&
        heightened(step.kind) &&
        patch.height !== step.height
      ) {
        next.height = patch.height;
        changed = true;
      }
      if (
        patch.heights &&
        step.kind === "ramp" &&
        patch.heights.every(Number.isFinite) &&
        (patch.heights[0] !== step.heights?.[0] ||
          patch.heights[1] !== step.heights?.[1])
      ) {
        next.heights = [patch.heights[0], patch.heights[1]];
        changed = true;
      }
      if (
        patch.width !== undefined &&
        step.kind === "ramp" &&
        Number.isFinite(patch.width) &&
        patch.width > 0 &&
        patch.width !== step.width
      ) {
        next.width = patch.width;
        changed = true;
      }
      return changed ? next : step;
    },
    how,
  );
}

/** The document without one of a base's steps. */
export function removeStep(
  scenario: Scenario,
  id: string,
  index: number,
  how: LayoutEdit = "own",
): Scenario {
  return editBaseTerrain(scenario, id, how, (terrain) =>
    terrain[index] ? terrain.filter((_, i) => i !== index) : null,
  );
}

/**
 * The document with one place in a base's build order, a building or a step,
 * moved `delta` places (1 or -1), and where a moved step now is in `terrain`.
 *
 * A building passing a building is {@link moveBuilding}, the same edit the
 * build order always made, so its id and queue go with it. Anything passing a
 * step changes only the steps.
 */
export function moveInBuildOrder(
  scenario: Scenario,
  id: string,
  entry: BuildEntry,
  delta: 1 | -1,
  how: LayoutEdit = "own",
): { scenario: Scenario; step: number } {
  const base = scenario.bases.find((one) => one.id === id);
  const layout = base
    ? scenario.blueprints.find((b) => b.id === base.blueprint)
    : undefined;
  if (!layout) return { scenario, step: -1 };
  const moved = movedInSequence(
    layout.buildings.length,
    layout.terrain ?? [],
    entry,
    delta,
  );
  if (!moved) return { scenario, step: -1 };
  if ("buildings" in moved) {
    return {
      scenario: moveBuilding(scenario, id, entry.index, delta, how),
      step: -1,
    };
  }
  return {
    scenario: editBaseTerrain(scenario, id, how, () => moved.steps),
    step: moved.index,
  };
}
