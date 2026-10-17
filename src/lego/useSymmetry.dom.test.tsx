// @vitest-environment happy-dom

/**
 * Symmetry mode's bookkeeping (issue #1844).
 *
 * `./mirror.test.ts` covers where a twin belongs. This is the part around it:
 * which pieces are still owed a twin, which pairs are being held together, and
 * when each of those is forgotten. Every mistake it can make is silent. Hold a
 * pair too long and a piece drags a stranger around with it. Drop one too early
 * and it stops twinning with nothing to say so.
 *
 * The pairing is saved on the pieces (issue #3315), so these tests also reload
 * a unit through its JSON and check the pair still follows.
 */

import { cleanup, render } from "@testing-library/react";
import { act, useState } from "react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AnimPreset, presetById } from "./animPresets";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import { presetCopies } from "./luaScript";
import { unpairPiece, withoutDanglingTwins } from "./mirror";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
  projectProblems,
} from "./model";
import { worldMatrix } from "./reparent";
import { type SymmetrySession, useSymmetry } from "./useSymmetry";

afterEach(() => {
  cleanup();
});

/** A unit whose root is `root`, plus whatever pieces a test names. */
function unit(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "walker",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/** Where a piece's own origin lands in the unit, rounded so a reflection of 3
 *  reads as -3. */
function origin(project: LegoProject, pieceId: string): number[] {
  const point = new THREE.Vector3().applyMatrix4(worldMatrix(project, pieceId));
  return [point.x, point.y, point.z].map((n) => Number(n.toFixed(6)));
}

/** A placement: put a piece somewhere, the way the gizmo and the number fields
 *  both do. */
function moveTo(
  project: LegoProject,
  pieceId: string,
  position: [number, number, number],
): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId ? { ...piece, position } : piece,
    ),
  };
}

interface Bench {
  session: () => SymmetrySession;
  project: () => LegoProject;
  /** Every piece the tests did not put there, which is the twins. */
  extras: () => LegoPiece[];
  /** How many separate edits the document has taken, so a piece and its twin
   *  arriving in one can be told from two. */
  edits: () => number;
  /** An edit from outside symmetry mode: a delete, an undo, a redo. */
  change: (change: (project: LegoProject) => LegoProject) => void;
  run: (fn: () => void) => void;
}

function open(initial: LegoProject): Bench {
  const known = new Set(initial.pieces.map((piece) => piece.id));
  let session: SymmetrySession | null = null;
  let project = initial;
  let setProject: (change: (p: LegoProject) => LegoProject) => void = () => {};
  const edit = vi.fn();

  function Harness() {
    const [doc, setDoc] = useState(initial);
    project = doc;
    setProject = (change) => setDoc((current) => change(current));
    session = useSymmetry({
      project: doc,
      edit: (change) => {
        edit();
        setDoc((current) => change(current));
      },
    });
    return null;
  }
  render(<Harness />);

  const run = (fn: () => void) => {
    act(() => {
      fn();
    });
  };
  return {
    session: () => {
      if (!session) throw new Error("the hook never ran");
      return session;
    },
    project: () => project,
    extras: () => project.pieces.filter((piece) => !known.has(piece.id)),
    edits: () => edit.mock.calls.length,
    change: (change) => run(() => setProject(change)),
    run,
  };
}

/** Symmetry on, with `pieceId` freshly added and selected: the state the
 *  builder is in the moment somebody drops a part in. */
function armed(project: LegoProject, pieceId: string): Bench {
  const bench = open(project);
  bench.run(() => bench.session().setOn(true));
  bench.run(() => bench.session().queueTwin(pieceId));
  return bench;
}

describe("giving a piece a twin", () => {
  it("starts off", () => {
    expect(open(unit([{ id: "leg" }])).session().on).toBe(false);
  });

  it("mirrors a piece the first time it is placed off the centre line", () => {
    const bench = armed(unit([{ id: "leg" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 1])),
    );

    const twins = bench.extras();
    expect(twins).toHaveLength(1);
    expect(origin(bench.project(), "leg")).toEqual([3, 0, 1]);
    expect(origin(bench.project(), twins[0].id)).toEqual([-3, 0, 1]);
  });

  it("brings the twin in on the same edit as the placement", () => {
    // One undo step for the pair, rather than a move that undoes into a unit
    // with a twin nobody asked for still on it.
    const bench = armed(unit([{ id: "leg" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    expect(bench.edits()).toBe(1);
    expect(bench.project().pieces).toHaveLength(3);
  });

  it("waits while the piece is still down the middle", () => {
    // A piece on the centre line is its own reflection, so a twin would be a
    // second copy sitting inside the first. It keeps its turn in the queue.
    const bench = armed(unit([{ id: "leg" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [0, 2, 0])),
    );
    expect(bench.extras()).toHaveLength(0);
    expect(origin(bench.project(), "leg")).toEqual([0, 2, 0]);

    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 2, 0])),
    );
    expect(bench.extras()).toHaveLength(1);
  });

  it("only twins a piece once, however often it is moved after", () => {
    const bench = armed(unit([{ id: "leg" }]), "leg");
    for (const x of [3, 4, 5]) {
      bench.run(() =>
        bench.session().place(["leg"], (p) => moveTo(p, "leg", [x, 0, 0])),
      );
    }
    expect(bench.extras()).toHaveLength(1);
  });

  it("twins each piece of a set placed at once", () => {
    const bench = open(unit([{ id: "arm" }, { id: "leg" }]));
    bench.run(() => bench.session().setOn(true));
    bench.run(() => {
      bench.session().queueTwin("arm");
      bench.session().queueTwin("leg");
    });
    bench.run(() =>
      bench
        .session()
        .place(["arm", "leg"], (p) =>
          moveTo(moveTo(p, "arm", [2, 5, 0]), "leg", [3, 0, 0]),
        ),
    );
    expect(bench.extras()).toHaveLength(2);
    expect(bench.edits()).toBe(1);
  });

  it("does nothing at all while symmetry is off", () => {
    const bench = open(unit([{ id: "leg" }]));
    bench.run(() => bench.session().queueTwin("leg"));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    expect(bench.extras()).toHaveLength(0);
    // The placement itself still lands: `place` is how every move reaches the
    // document, not just a mirrored one.
    expect(origin(bench.project(), "leg")).toEqual([3, 0, 0]);
  });

  it("never twins the root, which is the centre line rather than a piece", () => {
    const bench = armed(unit([]), "root");
    bench.run(() =>
      bench.session().place(["root"], (p) => moveTo(p, "root", [3, 0, 0])),
    );
    expect(bench.extras()).toHaveLength(0);
  });

  it("does nothing when there is no unit open yet", () => {
    // The builder renders before the stored unit arrives.
    let session: SymmetrySession | null = null;
    const edit = vi.fn();
    function Harness() {
      session = useSymmetry({ project: null, edit });
      return null;
    }
    render(<Harness />);
    act(() => {
      session?.setOn(true);
      session?.queueTwin("leg");
      session?.place(["leg"], (p) => p);
    });
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("a leg module dropped in with symmetry on (issue #4316)", () => {
  /** One leg of a biped: a thigh with a shin, and the walk that needs both
   *  sides. */
  function legModule(): LegoProject {
    const piece = (id: string, parentId: string | null, role: string) => ({
      id,
      name: id,
      parentId,
      partId: null,
      role,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    });
    return {
      ...newProject({
        id: "leg-module",
        rootPieceId: "thigh",
        name: "Leg",
        packId: "lego",
        packVersion: "1",
        now: "2026-08-21T00:00:00Z",
      }),
      pieces: [
        piece("thigh", null, "leg.l1.thigh"),
        piece("shin", "thigh", "leg.l1.shin"),
      ],
      animations: [{ presetId: "walk.biped", params: {} }],
    };
  }

  function dropped() {
    let count = 0;
    const inserted = insertCompound(
      unit([]),
      legModule(),
      "root",
      () => `n${++count}`,
      true,
    );
    const legId = inserted.rootPieceIds[0];
    const bench = open(inserted.project);
    bench.run(() => bench.session().setOn(true));
    bench.run(() => bench.session().queueTwin(legId, inserted.presets.held));
    return { bench, legId, inserted };
  }

  it("holds the walk back while only one leg is there", () => {
    const { inserted } = dropped();
    expect(inserted.project.animations ?? []).toEqual([]);
    expect(inserted.presets.held.map((held) => held.presetId)).toEqual([
      "walk.biped",
    ]);
  });

  it("gives the unit the walk once the twin supplies the other leg", () => {
    const { bench, legId } = dropped();
    bench.run(() =>
      bench.session().place([legId], (p) => moveTo(p, legId, [3, 0, 0])),
    );
    expect(bench.project().animations).toEqual([
      { presetId: "walk.biped", params: {} },
    ]);
  });

  it("makes the two legs one set of legs", () => {
    const { bench, legId } = dropped();
    bench.run(() =>
      bench.session().place([legId], (p) => moveTo(p, legId, [3, 0, 0])),
    );
    const walk = presetById("walk.biped") as AnimPreset;
    expect(presetCopies(bench.project(), walk)).toBe(1);
  });

  it("leaves the walk off when symmetry is off", () => {
    const { bench, legId } = dropped();
    bench.run(() => bench.session().setOn(false));
    bench.run(() =>
      bench.session().place([legId], (p) => moveTo(p, legId, [3, 0, 0])),
    );
    expect(bench.project().animations ?? []).toEqual([]);
  });
});

describe("keeping a pair in step", () => {
  /** A twinned leg, ready to be dragged about. */
  function paired(): { bench: Bench; twinId: string } {
    const bench = armed(unit([{ id: "leg" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    return { bench, twinId: bench.extras()[0].id };
  }

  it("moves the twin when the piece moves again", () => {
    const { bench, twinId } = paired();
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [5, 1, 2])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-5, 1, 2]);
    expect(bench.extras()).toHaveLength(1);
  });

  it("keeps following across repeated drags", () => {
    const { bench, twinId } = paired();
    for (const x of [4, 5, 6]) {
      bench.run(() =>
        bench.session().place(["leg"], (p) => moveTo(p, "leg", [x, 0, 0])),
      );
    }
    expect(origin(bench.project(), twinId)).toEqual([-6, 0, 0]);
  });

  it("turns and scales the twin, rather than only shifting it", () => {
    const { bench, twinId } = paired();
    bench.run(() =>
      bench.session().place(["leg"], (project) => ({
        ...project,
        pieces: project.pieces.map((piece) =>
          piece.id === "leg"
            ? { ...piece, rotation: [0, 0.5, 0] as [number, number, number] }
            : piece,
        ),
      })),
    );
    const twin = bench.project().pieces.find((piece) => piece.id === twinId);
    expect(twin?.rotation[1]).toBeCloseTo(-0.5, 6);
  });
});

describe("a pair saved with the unit (issue #3315)", () => {
  function paired(): { bench: Bench; twinId: string } {
    const bench = armed(unit([{ id: "leg" }, { id: "hull" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    return { bench, twinId: bench.extras()[0].id };
  }

  /** The unit as it comes back from disk. */
  function reloaded(project: LegoProject): LegoProject {
    const parsed = parseLegoProjectJson(JSON.stringify(project));
    if (!parsed) throw new Error("the unit did not reload");
    return parsed;
  }

  it("names each piece on the other", () => {
    const { bench, twinId } = paired();
    const byId = (id: string) =>
      bench.project().pieces.find((piece) => piece.id === id);
    expect(byId("leg")?.twin).toBe(twinId);
    expect(byId(twinId)?.twin).toBe("leg");
  });

  it("follows after the unit is saved and reopened", () => {
    const { bench, twinId } = paired();
    const again = open(reloaded(bench.project()));
    again.run(() => again.session().setOn(true));
    again.run(() =>
      again.session().place(["leg"], (p) => moveTo(p, "leg", [7, 1, 2])),
    );
    expect(origin(again.project(), twinId)).toEqual([-7, 1, 2]);
    expect(again.project().pieces).toHaveLength(4);
  });

  it("lets the twin lead", () => {
    const { bench, twinId } = paired();
    const again = open(reloaded(bench.project()));
    again.run(() => again.session().setOn(true));
    again.run(() =>
      again.session().place([twinId], (p) => moveTo(p, twinId, [-6, 0, 0])),
    );
    expect(origin(again.project(), "leg")).toEqual([6, 0, 0]);
  });

  it("keeps following after something else has been selected", () => {
    // Selection is no longer part of the pairing: it is in the document.
    const { bench, twinId } = paired();
    bench.run(() =>
      bench.session().place(["hull"], (p) => moveTo(p, "hull", [1, 1, 1])),
    );
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-9, 0, 0]);
  });

  it("does not follow while symmetry is off, and resumes when it is on", () => {
    const { bench, twinId } = paired();
    bench.run(() => bench.session().setOn(false));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
    bench.run(() => bench.session().setOn(true));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [8, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-8, 0, 0]);
  });

  it("leaves both alone when both are moved in one go", () => {
    const { bench, twinId } = paired();
    bench.run(() =>
      bench
        .session()
        .place(["leg", twinId], (p) =>
          moveTo(moveTo(p, "leg", [5, 0, 0]), twinId, [-4, 0, 0]),
        ),
    );
    expect(origin(bench.project(), "leg")).toEqual([5, 0, 0]);
    expect(origin(bench.project(), twinId)).toEqual([-4, 0, 0]);
  });

  it("does not follow once the pair is broken", () => {
    const { bench, twinId } = paired();
    bench.change((project) => unpairPiece(project, "leg"));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
    expect(
      bench.project().pieces.every((piece) => piece.twin === undefined),
    ).toBe(true);
  });

  it("leaves the other piece ordinary when one of the pair is deleted", () => {
    const { bench, twinId } = paired();
    bench.change((project) =>
      withoutDanglingTwins({
        ...project,
        pieces: project.pieces.filter((piece) => piece.id !== twinId),
      }),
    );
    expect(
      bench.project().pieces.find((piece) => piece.id === "leg")?.twin,
    ).toBeUndefined();
    expect(projectProblems(bench.project())).toEqual([]);
  });

  it("ignores, and reports, a pairing that names a missing piece", () => {
    const { bench, twinId } = paired();
    bench.change((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => piece.id !== twinId),
    }));
    expect(projectProblems(bench.project())).toEqual([
      '"piece0" has a twin that no longer exists.',
    ]);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), "leg")).toEqual([9, 0, 0]);
    expect(bench.project().pieces).toHaveLength(3);
  });

  it("changes nothing in a unit saved before pairs existed", () => {
    const old = reloaded(unit([{ id: "left" }, { id: "right" }]));
    expect(old.pieces.every((piece) => piece.twin === undefined)).toBe(true);
    const bench = open(old);
    bench.run(() => bench.session().setOn(true));
    bench.run(() =>
      bench.session().place(["left"], (p) => moveTo(p, "left", [4, 0, 0])),
    );
    expect(origin(bench.project(), "right")).toEqual([0, 0, 0]);
    expect(bench.project().pieces).toHaveLength(old.pieces.length);
  });

  it("copies a pair with both ids remapped, and drops a lone half", () => {
    const { bench, twinId } = paired();
    let count = 0;
    const newId = () => `copy${++count}`;
    const both = selectionAsCompound(bench.project(), ["leg", twinId], {
      id: "set",
      now: "2026-08-21T00:00:00Z",
      newId,
    }) as LegoProject;
    const inserted = insertCompound(bench.project(), both, "root", newId);
    const copies = inserted.rootPieceIds.map((id) =>
      inserted.project.pieces.find((piece) => piece.id === id),
    );
    expect(copies).toHaveLength(2);
    expect(copies[0]?.twin).toBe(copies[1]?.id);
    expect(copies[1]?.twin).toBe(copies[0]?.id);

    const lone = duplicatePiece(bench.project(), "leg", {
      now: "2026-08-21T00:00:00Z",
      newId,
    });
    const copy = lone?.project.pieces.find(
      (piece) => piece.id === lone.rootPieceId,
    );
    expect(copy?.twin).toBeUndefined();
    // And the original's pairing is untouched.
    expect(lone?.project.pieces.find((piece) => piece.id === "leg")?.twin).toBe(
      twinId,
    );
  });
});

describe("letting a pair go", () => {
  function paired(): { bench: Bench; twinId: string } {
    const bench = armed(unit([{ id: "leg" }, { id: "hull" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    return { bench, twinId: bench.extras()[0].id };
  }

  it("keeps a pair whose twin was deleted and brought back by an undo", () => {
    const { bench, twinId } = paired();
    const before = bench.project();
    bench.change((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => piece.id !== twinId),
    }));
    bench.change(() => before);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-9, 0, 0]);
  });

  it("forgets a queued piece that has been deleted, so a redo cannot twin it", () => {
    const bench = armed(unit([{ id: "leg" }]), "leg");
    const before = bench.project();
    bench.change((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => piece.id !== "leg"),
    }));
    bench.change(() => before);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    expect(bench.extras()).toHaveLength(0);
  });

  it("forgets a piece that was waiting when symmetry was switched off", () => {
    // Turning it back on hours later must not suddenly twin a piece added
    // during the last session of it.
    const bench = armed(unit([{ id: "leg" }]), "leg");
    bench.run(() => bench.session().setOn(false));
    bench.run(() => bench.session().setOn(true));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    expect(bench.extras()).toHaveLength(0);
  });

  it("reports the mode it is in", () => {
    const bench = open(unit([{ id: "leg" }]));
    bench.run(() => bench.session().setOn(true));
    expect(bench.session().on).toBe(true);
    bench.run(() => bench.session().setOn(false));
    expect(bench.session().on).toBe(false);
  });
});
