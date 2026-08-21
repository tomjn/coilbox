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
 * The selection here is handed in as a fresh array on every render, because
 * that is what the document reducer does: it rebuilds `selectedIds` on every
 * edit whether or not the selection changed. A pairing compared by array
 * identity would break on the first drag.
 */

import { cleanup, render } from "@testing-library/react";
import { act, useState } from "react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
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
  select: (ids: string[]) => void;
  /** An edit from outside symmetry mode: a delete, an undo, a redo. */
  change: (change: (project: LegoProject) => LegoProject) => void;
  run: (fn: () => void) => void;
}

function open(initial: LegoProject, selected: string[] = []): Bench {
  const known = new Set(initial.pieces.map((piece) => piece.id));
  let session: SymmetrySession | null = null;
  let project = initial;
  let setProject: (change: (p: LegoProject) => LegoProject) => void = () => {};
  let setSelected: (ids: string[]) => void = () => {};
  const edit = vi.fn();

  function Harness() {
    const [doc, setDoc] = useState(initial);
    const [ids, setIds] = useState(selected);
    project = doc;
    setProject = (change) => setDoc((current) => change(current));
    setSelected = setIds;
    session = useSymmetry({
      project: doc,
      // Rebuilt every render, as the reducer rebuilds it.
      selectedIds: [...ids],
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
    select: (ids) => run(() => setSelected(ids)),
    change: (change) => run(() => setProject(change)),
    run,
  };
}

/** Symmetry on, with `pieceId` freshly added and selected: the state the
 *  builder is in the moment somebody drops a part in. */
function armed(project: LegoProject, pieceId: string): Bench {
  const bench = open(project, [pieceId]);
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
    const bench = open(unit([{ id: "arm" }, { id: "leg" }]), ["arm", "leg"]);
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
    const bench = open(unit([{ id: "leg" }]), ["leg"]);
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
      session = useSymmetry({ project: null, selectedIds: [], edit });
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

  it("keeps following across an edit that rebuilds the selection", () => {
    // The reducer hands back a new `selectedIds` array on every edit. Compared
    // by identity rather than contents, the pair would break on the first drag.
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

describe("letting a pair go", () => {
  function paired(): { bench: Bench; twinId: string } {
    const bench = armed(unit([{ id: "leg" }, { id: "hull" }]), "leg");
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [3, 0, 0])),
    );
    return { bench, twinId: bench.extras()[0].id };
  }

  it("stops following once something else is selected", () => {
    const { bench, twinId } = paired();
    bench.select(["hull"]);
    bench.select(["leg"]);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    // The twin is an ordinary piece now: it stayed where the pairing left it.
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
  });

  it("stops following when the piece joins a wider selection", () => {
    const { bench, twinId } = paired();
    bench.select(["leg", "hull"]);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
  });

  it("holds on while the same selection is handed back", () => {
    const { bench, twinId } = paired();
    bench.select(["leg"]);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-9, 0, 0]);
  });

  it("forgets a pair whose twin has been deleted, so a redo cannot revive it", () => {
    const { bench, twinId } = paired();
    const before = bench.project();
    bench.change((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => piece.id !== twinId),
    }));
    // The same piece back under the same id, which is what undo hands over.
    bench.change(() => before);
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
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

  it("forgets everything when symmetry is switched off", () => {
    const { bench, twinId } = paired();
    bench.run(() => bench.session().setOn(false));
    bench.run(() => bench.session().setOn(true));
    bench.run(() =>
      bench.session().place(["leg"], (p) => moveTo(p, "leg", [9, 0, 0])),
    );
    expect(origin(bench.project(), twinId)).toEqual([-3, 0, 0]);
    expect(bench.extras()).toHaveLength(1);
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
