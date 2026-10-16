import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { REFERENCE_PARK_X } from "../../buildPlate";
import type { GroundShape } from "../../environment";
import { type SceneState, standReferenceOnGround } from "./sceneState";

function parked() {
  const reference = new THREE.Group();
  reference.position.set(REFERENCE_PARK_X, 0, 0);
  return { reference, groundShape: null as GroundShape | null };
}

describe("standReferenceOnGround", () => {
  it("leaves the figure at 0 on flat ground", () => {
    const state = parked();
    standReferenceOnGround(
      state as Pick<SceneState, "reference" | "groundShape">,
    );
    expect(state.reference.position.y).toBe(0);
  });

  it("leaves it at 0 on a slope, which is level beside the unit", () => {
    const state = parked();
    state.groundShape = { kind: "slope", degrees: 30 };
    standReferenceOnGround(
      state as Pick<SceneState, "reference" | "groundShape">,
    );
    expect(state.reference.position.y).toBeCloseTo(0);
  });

  it("stands it on the bump it is parked on, on uneven ground", () => {
    const state = parked();
    state.groundShape = { kind: "uneven", degrees: 30, width: 32 };
    standReferenceOnGround(
      state as Pick<SceneState, "reference" | "groundShape">,
    );
    const k = (2 * Math.PI) / 32;
    expect(state.reference.position.y).toBeCloseTo(
      (Math.tan(Math.PI / 6) / k) * Math.sin(k * REFERENCE_PARK_X),
    );
    expect(state.reference.position.y).not.toBeCloseTo(0);
  });

  it("brings it back to 0 when the ground goes flat again", () => {
    const state = parked();
    state.groundShape = { kind: "uneven", degrees: 30, width: 32 };
    standReferenceOnGround(
      state as Pick<SceneState, "reference" | "groundShape">,
    );
    state.groundShape = null;
    standReferenceOnGround(
      state as Pick<SceneState, "reference" | "groundShape">,
    );
    expect(state.reference.position.y).toBe(0);
  });
});
