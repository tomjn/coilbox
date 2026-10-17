import { describe, expect, it } from "vitest";

import type { RoleProposal } from "./inferRoles";
import { liftedRolesSummary, withLiftedRoles } from "./liftRoles";
import { type LegoPiece, type LegoProject, newProject } from "./model";

function piece(name: string, role?: string): LegoPiece {
  return {
    id: name,
    name,
    parentId: null,
    partId: null,
    meshId: `m-${name}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...(role ? { role } : {}),
  } as LegoPiece;
}

function module(...names: string[]): LegoProject {
  return {
    ...newProject({
      id: "lifted",
      rootPieceId: names[0] ?? "x",
      name: "armcom turret",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    pieces: names.map((name) => piece(name)),
  };
}

function proposal(
  pieceName: string,
  role: string,
  evidence: RoleProposal["evidence"] = "stated",
): RoleProposal {
  return { pieceName, role, evidence, callin: "AimFromWeapon1" };
}

const roleOf = (project: LegoProject, name: string) =>
  project.pieces.find((p) => p.name === name)?.role;

describe("withLiftedRoles", () => {
  it("gives the lifted pieces the roles the script named", () => {
    const out = withLiftedRoles(module("gun", "tube"), [
      proposal("gun", "turret", "observed"),
      proposal("tube", "barrel", "observed"),
    ]);
    expect(roleOf(out, "gun")).toBe("turret");
    expect(roleOf(out, "tube")).toBe("barrel");
  });

  it("ignores roles for pieces that were not lifted", () => {
    const out = withLiftedRoles(module("gun"), [
      proposal("base", "base"),
      proposal("gun", "turret"),
    ]);
    expect(out.pieces).toHaveLength(1);
    expect(roleOf(out, "gun")).toBe("turret");
  });

  it("ignores a role the builder does not know", () => {
    const out = withLiftedRoles(module("gun"), [proposal("gun", "invented")]);
    expect(roleOf(out, "gun")).toBeUndefined();
  });

  it("falls back to piece names where the script said nothing", () => {
    const out = withLiftedRoles(
      module("turret", "barrel", "flare", "plate"),
      [],
    );
    expect(roleOf(out, "turret")).toBe("turret");
    expect(roleOf(out, "barrel")).toBe("barrel");
    expect(roleOf(out, "flare")).toBe("flare");
    expect(roleOf(out, "plate")).toBeUndefined();
  });

  it("lets the script outrank the names", () => {
    // The script says the piece called "barrel" is the turret.
    const out = withLiftedRoles(module("barrel", "turret"), [
      proposal("barrel", "turret", "observed"),
    ]);
    expect(roleOf(out, "barrel")).toBe("turret");
    // The role is taken, so the name "turret" does not claim it a second time.
    expect(roleOf(out, "turret")).toBeUndefined();
  });

  it("does not read a role off a numbered name", () => {
    const out = withLiftedRoles(module("barrel1", "barrel2"), []);
    expect(roleOf(out, "barrel1")).toBeUndefined();
    expect(roleOf(out, "barrel2")).toBeUndefined();
  });

  it("applies the turret sweep and recoil when the roles allow them", () => {
    const out = withLiftedRoles(module("turret", "barrel"), []);
    expect(out.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
  });

  it("applies only the presets whose roles are present", () => {
    const out = withLiftedRoles(module("turret", "plate"), []);
    expect(out.animations?.map((a) => a.presetId)).toEqual(["turret.track"]);
  });

  it("adds no animations when no roles are found", () => {
    const out = withLiftedRoles(module("plate"), []);
    expect(out.animations).toBeUndefined();
  });

  it("leaves a role already on a piece alone", () => {
    const base = module("turret");
    const held = {
      ...base,
      pieces: [piece("turret", "barrel")],
    };
    expect(roleOf(withLiftedRoles(held, []), "turret")).toBe("barrel");
  });
});

describe("liftedRolesSummary", () => {
  it("lists the roles by label, once each", () => {
    const out = withLiftedRoles(module("turret", "barrel"), []);
    expect(liftedRolesSummary(out)).toBe("Turret, Barrel");
  });

  it("is null when no piece has a role", () => {
    expect(liftedRolesSummary(module("plate"))).toBeNull();
  });
});
