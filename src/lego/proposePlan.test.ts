import { describe, expect, it } from "vitest";

import { fitPlan } from "./fitPlan";
import type { RoleFindings, RoleProposal } from "./inferRoles";
import type { LegProposal } from "./legChains";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { proposePlan } from "./proposePlan";

function piece(
  id: string,
  parentId: string | null,
  position: [number, number, number],
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function unit(pieces: LegoPiece[], extra: Partial<LegoProject> = {}) {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-11-10T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [base.pieces[0] as LegoPiece, ...pieces],
    ...extra,
  };
}

function findings(
  proposals: RoleProposal[],
  legs: LegProposal[] = [],
): RoleFindings {
  return { proposals, legs, notes: [], error: null };
}

const observed = (pieceName: string, role: string, callin: string) => ({
  pieceName,
  role,
  evidence: "observed" as const,
  callin,
});

/** Legs on each side, pair 1 at the front, under `body`, each a chain of
 *  pieces named `<side>thigh<pair>` and so on, with matching findings. */
function legged(pairs: number, sides: ("l" | "r")[] = ["l", "r"]) {
  const pieces: LegoPiece[] = [piece("body", "root", [0, 20, 0])];
  const legs: LegProposal[] = [];
  for (const side of sides) {
    for (let pair = 1; pair <= pairs; pair++) {
      const x = side === "l" ? 7 : -7;
      const z = (pairs - pair) * 10;
      const name = (segment: string) => `${side}${segment}${pair}`;
      pieces.push(
        piece(name("thigh"), "body", [x, 0, z]),
        piece(name("shin"), name("thigh"), [0, -8, 0]),
        piece(name("foot"), name("shin"), [0, -12, 0]),
      );
      legs.push({
        side,
        pair,
        chain: {
          thigh: name("thigh"),
          shin: name("shin"),
          foot: name("foot"),
        },
        hangsFrom: "body",
        position: [x, 20, z],
      });
    }
  }
  const proposals = legs.flatMap((leg) =>
    (["thigh", "shin", "foot"] as const).map((segment) =>
      observed(
        leg.chain[segment],
        `leg.${leg.side}${leg.pair}.${segment}`,
        "StartMoving",
      ),
    ),
  );
  return { project: unit(pieces), findings: findings(proposals, legs) };
}

const STATIC = { canmove: false };
const MOVER = { canMove: true, speed: 40 };

describe("proposePlan", () => {
  it.each([
    [1, "biped"],
    [2, "quadruped"],
    [3, "hexapod"],
    [4, "octopod"],
  ])("gives %i leg pairs the %s plan", (pairs, id) => {
    const { project, findings: found } = legged(pairs);
    const proposal = proposePlan(project, found);
    expect(proposal.base?.id).toBe(id);
    expect(proposal.notes).toEqual([]);
    expect(proposal.picks["thigh.l1"]).toBe("lthigh1");
    expect(proposal.picks[`foot.r${pairs}`]).toBe(`rfoot${pairs}`);
    expect(proposal.evidence["shin.l1"]).toEqual({
      kind: "script",
      callin: "StartMoving",
      evidence: "observed",
    });
  });

  it("picks the piece the legs hang from as the body, and the root as the root", () => {
    const { project, findings: found } = legged(2);
    const proposal = proposePlan(project, found);
    expect(proposal.picks.body).toBe("body");
    expect(proposal.evidence.body).toEqual({ kind: "hangsFrom", what: "legs" });
    expect(proposal.picks.base).toBe("root");
    expect(proposal.evidence.base).toEqual({ kind: "root" });
  });

  it("proposes no plan for a side with more legs than the other", () => {
    const { project, findings: found } = legged(1);
    const extra = legged(1, ["l"]).findings.legs.map((leg) => ({
      ...leg,
      pair: 2,
    }));
    const proposal = proposePlan(project, {
      ...found,
      legs: [...found.legs, ...extra],
    });
    expect(proposal.base).toBeNull();
    expect(proposal.picks).toEqual({});
    expect(proposal.notes.join(" ")).toMatch(/2 legs on its left and 1/);
  });

  it("proposes no plan for more leg pairs than any plan has", () => {
    const { project, findings: found } = legged(5);
    const proposal = proposePlan(project, found);
    expect(proposal.base).toBeNull();
    expect(proposal.notes.join(" ")).toMatch(/5 pairs/);
  });

  it("leaves the body unpicked when the legs hang from different pieces", () => {
    const { project, findings: found } = legged(1);
    const legs = found.legs.map((leg) =>
      leg.side === "r" ? { ...leg, hangsFrom: "root" } : leg,
    );
    const proposal = proposePlan(project, { ...found, legs });
    expect(proposal.base?.id).toBe("biped");
    expect(proposal.picks.hip).toBeUndefined();
    expect(proposal.notes).toHaveLength(1);
  });

  it("gives wheel roles the Wheels plan, by side and axle", () => {
    const car = unit([
      piece("body", "root", [0, 5, 0]),
      piece("fl", "body", [14, 0, 10]),
      piece("fr", "body", [-14, 0, 10]),
      piece("bl", "body", [14, 0, -10]),
      piece("br", "body", [-14, 0, -10]),
    ]);
    const proposal = proposePlan(
      car,
      findings(
        ["bl", "fr", "fl", "br"].map((name) =>
          observed(name, "wheel", "StartMoving"),
        ),
      ),
    );
    expect(proposal.base?.id).toBe("wheeled");
    expect(proposal.counts).toEqual({ axles: 2 });
    expect(proposal.picks).toMatchObject({
      base: "root",
      body: "body",
      "wheel.l1": "fl",
      "wheel.r1": "fr",
      "wheel.l2": "bl",
      "wheel.r2": "br",
    });
    expect(proposal.evidence.body).toEqual({
      kind: "hangsFrom",
      what: "wheels",
    });
  });

  it("proposes no plan for wheels that do not pair up", () => {
    const trike = unit([
      piece("front", "root", [3, 0, 10]),
      piece("bl", "root", [14, 0, -10]),
      piece("br", "root", [-14, 0, -10]),
    ]);
    const proposal = proposePlan(
      trike,
      findings(
        ["front", "bl", "br"].map((name) =>
          observed(name, "wheel", "StartMoving"),
        ),
      ),
    );
    expect(proposal.base).toBeNull();
    expect(proposal.notes.join(" ")).toMatch(/2 wheels on its left and 1/);
  });

  it("gives a unit that does not move, with a turret, the turret building plan", () => {
    const gun = unit(
      [
        piece("turret", "root", [0, 40, 0]),
        piece("sleeve", "turret", [0, 12, 0]),
        piece("muzzle", "sleeve", [0, 0, 30]),
      ],
      { gameUnitDef: STATIC },
    );
    const proposal = proposePlan(
      gun,
      findings([
        observed("turret", "turret", "AimWeapon1"),
        observed("sleeve", "barrel", "AimWeapon1"),
        {
          pieceName: "muzzle",
          role: "flare",
          evidence: "stated",
          callin: "QueryWeapon1",
        },
      ]),
    );
    expect(proposal.base?.id).toBe("turret.building");
    expect(proposal.picks).toEqual({
      base: "root",
      turret: "turret",
      barrel: "sleeve",
      flare: "muzzle",
    });
    expect(proposal.evidence.flare).toEqual({
      kind: "script",
      callin: "QueryWeapon1",
      evidence: "stated",
    });
  });

  it("gives a unit that does not move, with no turret, the building plan", () => {
    const hut = unit([piece("door", "root", [0, 5, 0])], {
      gameUnitDef: STATIC,
    });
    const proposal = proposePlan(hut, findings([]));
    expect(proposal.base?.id).toBe("building");
    expect(proposal.picks).toEqual({ base: "root" });
  });

  it("adds a build arm to a building whose script names a nano piece", () => {
    const lab = unit([piece("nano", "root", [0, 10, 0])], {
      gameUnitDef: STATIC,
    });
    const proposal = proposePlan(
      lab,
      findings([
        {
          pieceName: "nano",
          role: "buildarm.nano",
          evidence: "stated",
          callin: "QueryNanoPiece",
        },
      ]),
    );
    expect(proposal.base?.id).toBe("building");
    expect(proposal.groups).toEqual({ weapon: false, builds: true });
    expect(proposal.picks["buildarm.nano"]).toBe("nano");
  });

  it("adds a gun to a walker whose script turns a turret", () => {
    const { project, findings: found } = legged(1);
    const armed = {
      ...project,
      pieces: [...project.pieces, piece("gun", "body", [0, 6, 0])],
    };
    const proposal = proposePlan(armed, {
      ...found,
      proposals: [...found.proposals, observed("gun", "turret", "AimWeapon1")],
    });
    expect(proposal.base?.id).toBe("biped");
    expect(proposal.groups.weapon).toBe(true);
    expect(proposal.picks.turret).toBe("gun");
  });

  it("leaves a bone unpicked when two pieces are proposed for it", () => {
    const lab = unit(
      [piece("n1", "root", [2, 10, 0]), piece("n2", "root", [-2, 10, 0])],
      { gameUnitDef: STATIC },
    );
    const nano = (pieceName: string) => ({
      pieceName,
      role: "buildarm.nano",
      evidence: "stated" as const,
      callin: "QueryNanoPiece",
    });
    const proposal = proposePlan(lab, findings([nano("n1"), nano("n2")]));
    expect(proposal.picks["buildarm.nano"]).toBeUndefined();
    expect(proposal.notes.join(" ")).toMatch(/n1, n2/);
  });

  it("proposes no plan for a mover with no legs or wheels found", () => {
    const tank = unit([piece("hull", "root", [0, 5, 0])], {
      gameUnitDef: MOVER,
    });
    const proposal = proposePlan(tank, findings([]));
    expect(proposal.base).toBeNull();
    expect(proposal.notes).toHaveLength(1);
  });

  it("proposes no plan for a unit with no definition and nothing found", () => {
    const proposal = proposePlan(unit([]), findings([]));
    expect(proposal.base).toBeNull();
    expect(proposal.notes).toHaveLength(1);
  });

  it("passes on a script that could not be run", () => {
    const proposal = proposePlan(unit([]), {
      ...findings([]),
      error: "boom",
    });
    expect(proposal).toMatchObject({ base: null, notes: ["boom"] });
  });

  it("fits as the drawer would, moving nothing", () => {
    const { project, findings: found } = legged(2);
    const proposal = proposePlan(project, found);
    const base = proposal.base;
    if (!base) throw new Error("no plan");
    const fitted = fitPlan(project, base, proposal.counts, proposal.picks);
    expect(fitted.project.skeleton).toMatchObject({
      plan: "quadruped",
      fitted: true,
    });
    expect(fitted.project.pieces.map((p) => p.position)).toEqual(
      project.pieces.map((p) => p.position),
    );
  });
});
