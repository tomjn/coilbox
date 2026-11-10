/**
 * Work out a game unit's body plan, and which piece is each bone, from the
 * roles its script proposed (#5185).
 *
 * Legs in pairs give the plan with that many legs, wheels give Wheels, and a
 * unit whose definition does not move gives Turret building with a turret and
 * Building without one. A gun or a build arm found on a mover adds that group.
 *
 * It never guesses. A leg with no partner on the other side, wheels that do
 * not pair up into axles, two pieces proposed for one bone, or a unit whose
 * definition is missing: each is said in a note, and either no plan is
 * proposed or the bone is left for the game maker to pick.
 *
 * Pure, and with no UI, so a whole game's units can be run through it.
 */

import { t } from "@lingui/core/macro";
import * as THREE from "three";

import { field, flag, unitSpeedOf } from "@/workshop/moveClasses";
import { roleLabel } from "./animPresets";
import { BIPED, type BodyPlan, HEXAPOD, OCTOPOD, QUADRUPED } from "./bodyPlans";
import { BUILDING, TURRET_BUILDING } from "./buildingPlans";
import { withGroups } from "./describedPlan";
import { type BonePicks, planBones } from "./fitPlan";
import type { RoleEvidence, RoleFindings } from "./inferRoles";
import type { LegoPiece, LegoProject } from "./model";
import { worldMatrix } from "./reparent";
import { WHEELED } from "./vehiclePlans";

/** Why a piece was picked for a bone, shown beside the pick. */
export type PickEvidence =
  /** A role the script named or showed, with the call-in it came from. */
  | { kind: "script"; callin: string; evidence: RoleEvidence }
  /** The unit's root piece, for the plan's root bone. */
  | { kind: "root" }
  /** The piece every leg, or every wheel, hangs from, for the body bone. */
  | { kind: "hangsFrom"; what: "legs" | "wheels" };

export interface PlanProposal {
  /** The plan before groups, or null when no plan fits. */
  base: BodyPlan | null;
  /** The gun and build arm groups to add to it, as `withGroups` takes them. */
  groups: { weapon: boolean; builds: boolean };
  /** The plan's count proportions, such as how many axles. */
  counts: Record<string, number>;
  picks: BonePicks;
  /** Why each pick was made, by bone id. */
  evidence: Record<string, PickEvidence>;
  /** What could not be proposed, and why. */
  notes: string[];
}

/** As in `legChains`: closer to the centre line than this is on it. */
const ON_THE_LINE = 0.001;

/** The plan for each number of leg pairs. */
const LEG_PLANS: Record<number, BodyPlan> = {
  1: BIPED,
  2: QUADRUPED,
  3: HEXAPOD,
  4: OCTOPOD,
};

/** The roles a gun or build arm bone is picked by. */
const BY_ROLE = new Set([
  "turret",
  "barrel",
  "flare",
  "buildarm.base",
  "buildarm.arm",
  "buildarm.nozzle",
  "buildarm.nano",
]);

/** Whether the unit's definition says it moves, as the engine reads one: a
 *  flier, or `canmove` with a speed. Undefined with no definition to read. */
function moves(def: Record<string, unknown> | undefined): boolean | undefined {
  if (!def) return undefined;
  return (
    flag(field(def, "canfly")) ||
    (flag(field(def, "canmove")) && unitSpeedOf(def) > 0)
  );
}

function restPosition(project: LegoProject, piece: LegoPiece) {
  const at = new THREE.Vector3().setFromMatrixPosition(
    worldMatrix(project, piece.id),
  );
  return [at.x, at.y, at.z] as const;
}

/**
 * The body plan and bone picks the findings point to. `findings` is what
 * `inferRoles` reported for this project.
 */
export function proposePlan(
  project: LegoProject,
  findings: RoleFindings,
): PlanProposal {
  // What the script runs said first, such as why a chain was not a leg,
  // since that is often why no plan fits.
  const notes: string[] = [...findings.notes];
  const picks: BonePicks = {};
  const evidence: Record<string, PickEvidence> = {};
  const counts: Record<string, number> = {};
  const byName = new Map(project.pieces.map((p) => [p.name, p]));
  const pick = (boneId: string, piece: LegoPiece, why: PickEvidence) => {
    if (Object.values(picks).includes(piece.id)) return;
    picks[boneId] = piece.id;
    evidence[boneId] = why;
  };
  const none = (): PlanProposal => ({
    base: null,
    groups: { weapon: false, builds: false },
    counts: {},
    picks: {},
    evidence: {},
    notes,
  });

  if (findings.error) {
    notes.push(findings.error);
    return none();
  }

  const proposed = findings.proposals.filter((p) => byName.has(p.pieceName));
  const wheels = proposed.filter((p) => p.role === "wheel");

  // The body bone, from the one piece every leg or wheel hangs off. When that
  // is the unit's root, the root is the body and the plan's root bone, which
  // only places the body above the ground, is left unpicked.
  let body: LegoPiece | undefined;
  let bodyFrom: "legs" | "wheels" | null = null;

  let base: BodyPlan | null = null;
  if (findings.legs.length > 0) {
    const left = findings.legs.filter((leg) => leg.side === "l");
    const right = findings.legs.filter((leg) => leg.side === "r");
    const pairs = left.length;
    if (left.length !== right.length) {
      const l = left.length;
      const r = right.length;
      notes.push(
        t`The unit has ${l} legs on its left and ${r} on its right, so they do not pair up and no plan is proposed.`,
      );
      return none();
    }
    const plan = LEG_PLANS[pairs];
    if (!plan) {
      notes.push(
        t`No body plan has ${pairs} pairs of legs, so none is proposed.`,
      );
      return none();
    }
    base = plan;
    for (const leg of findings.legs) {
      for (const segment of ["thigh", "shin", "foot"] as const) {
        const piece = byName.get(leg.chain[segment]);
        if (piece) {
          pick(`${segment}.${leg.side}${leg.pair}`, piece, {
            kind: "script",
            callin: "StartMoving",
            evidence: "observed",
          });
        }
      }
    }
    const from = new Set(findings.legs.map((leg) => leg.hangsFrom));
    const only = from.size === 1 ? [...from][0] : null;
    body = only ? byName.get(only) : undefined;
    bodyFrom = "legs";
    if (!body) {
      notes.push(
        t`The legs do not all hang from one piece, so the body is left for you to pick.`,
      );
    }
  } else if (wheels.length > 0) {
    const placed = wheels.map((proposal) => {
      const piece = byName.get(proposal.pieceName) as LegoPiece;
      return { proposal, piece, at: restPosition(project, piece) };
    });
    const centred = placed.filter((w) => Math.abs(w.at[0]) < ON_THE_LINE);
    if (centred.length > 0) {
      const names = centred.map((w) => w.piece.name).join(", ");
      notes.push(
        t`${names} turn like wheels but sit on the unit's centre line, so which side each is on is unknown and no plan is proposed.`,
      );
      return none();
    }
    const sides = (["l", "r"] as const).map((side) =>
      placed
        .filter((w) => (side === "l" ? w.at[0] > 0 : w.at[0] < 0))
        .sort((a, b) => b.at[2] - a.at[2]),
    );
    const [left, right] = sides as [typeof placed, typeof placed];
    if (left.length !== right.length) {
      const l = left.length;
      const r = right.length;
      notes.push(
        t`The unit has ${l} wheels on its left and ${r} on its right, so they do not pair up into axles and no plan is proposed.`,
      );
      return none();
    }
    const axles = WHEELED.proportions.find((p) => p.id === "axles");
    const count = left.length;
    if (axles && (count < axles.min || count > axles.max)) {
      const min = axles.min;
      const max = axles.max;
      notes.push(
        t`The unit has ${count} wheels a side, and the Wheels plan takes ${min} to ${max} axles, so no plan is proposed.`,
      );
      return none();
    }
    const tied = sides.some((side) =>
      side.some(
        (w, i) =>
          i > 0 &&
          Math.abs((side[i - 1] as (typeof side)[number]).at[2] - w.at[2]) <
            ON_THE_LINE,
      ),
    );
    if (tied) {
      notes.push(
        t`Two wheels on one side are the same distance front to back, so which axle each is on is unknown and no plan is proposed.`,
      );
      return none();
    }
    // Each left wheel's axle partner is the right wheel in the same place
    // front to back, so it has to be nearer that one than any other.
    const unpaired = left.some((w, i) =>
      right.some(
        (other, j) =>
          j !== i &&
          Math.abs(other.at[2] - w.at[2]) <=
            Math.abs((right[i] as (typeof right)[number]).at[2] - w.at[2]),
      ),
    );
    if (unpaired) {
      notes.push(
        t`The wheels on the left and right are not level front to back, so which wheels share an axle is unknown and no plan is proposed.`,
      );
      return none();
    }
    base = WHEELED;
    counts.axles = count;
    for (const [s, side] of (["l", "r"] as const).entries()) {
      (sides[s] as typeof placed).forEach((w, i) => {
        pick(`wheel.${side}${i + 1}`, w.piece, {
          kind: "script",
          callin: w.proposal.callin,
          evidence: w.proposal.evidence,
        });
      });
    }
    const parents = new Set(placed.map((w) => w.piece.parentId));
    const only = parents.size === 1 ? [...parents][0] : null;
    body = project.pieces.find((p) => p.id === only);
    bodyFrom = "wheels";
    if (!body) {
      notes.push(
        t`The wheels do not all hang from one piece, so the body is left for you to pick.`,
      );
    }
  } else {
    const moving = moves(project.gameUnitDef);
    if (moving === undefined) {
      notes.push(
        t`The unit has no game definition to say whether it moves, and no legs or wheels were found, so no plan is proposed.`,
      );
      return none();
    }
    if (moving) {
      notes.push(
        t`The unit moves, but no legs or wheels were found that turn as it does, so no plan is proposed.`,
      );
      return none();
    }
    base = proposed.some((p) => p.role === "turret")
      ? TURRET_BUILDING
      : BUILDING;
  }

  const groups = {
    weapon: proposed.some((p) => p.role === "turret"),
    builds: proposed.some((p) => p.role.startsWith("buildarm.")),
  };
  const plan = withGroups(base, groups);
  const bones = planBones(plan, counts);

  if (body && bodyFrom) {
    const bodyBone = bones.find((b) => b.role === "base" && b.parent !== null);
    if (bodyBone)
      pick(bodyBone.id, body, { kind: "hangsFrom", what: bodyFrom });
  }
  const root = project.pieces.find((p) => p.id === project.rootPieceId);
  const rootBone = bones.find((b) => b.parent === null);
  if (root && rootBone) pick(rootBone.id, root, { kind: "root" });

  for (const bone of bones) {
    if (!bone.role || !BY_ROLE.has(bone.role)) continue;
    const ones = proposed.filter((p) => p.role === bone.role);
    if (ones.length > 1) {
      const names = ones.map((p) => p.pieceName).join(", ");
      const role = roleLabel(bone.role);
      notes.push(
        t`${names} are all proposed as ${role}, so which one it is is left for you to pick.`,
      );
      continue;
    }
    const one = ones[0];
    const piece = one ? byName.get(one.pieceName) : undefined;
    if (one && piece) {
      pick(bone.id, piece, {
        kind: "script",
        callin: one.callin,
        evidence: one.evidence,
      });
    }
  }

  return { base, groups, counts, picks, evidence, notes };
}
