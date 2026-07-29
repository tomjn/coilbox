import { describe, expect, it } from "vitest";

import {
  CLIPBOARD_MARKER,
  parseClipboardPiece,
  serializeClipboardPiece,
} from "./clipboard";
import { subtreeAsCompound } from "./compounds";
import { type LegoPiece, type LegoProject, newProject } from "./model";

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
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

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

const TURRET = project([
  { id: "turret", name: "turret", parentId: "root", partId: "barrel_a" },
]);

function liftTurret(): LegoProject {
  return subtreeAsCompound(TURRET, "turret", {
    id: "c1",
    now: "2026-07-29T00:00:00Z",
    newId: counter("new"),
  }) as LegoProject;
}

describe("serializeClipboardPiece and parseClipboardPiece", () => {
  it("round-trips a lifted subtree", () => {
    const lifted = liftTurret();
    const text = serializeClipboardPiece(lifted);

    const result = parseClipboardPiece(text, new Set(["barrel_a"]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.piece.project.pieces.map((p) => p.name)).toEqual([
        "turret",
      ]);
      expect(result.piece.missingParts).toEqual([]);
    }
  });

  it("rejects text that is not JSON at all", () => {
    const result = parseClipboardPiece("not json { at all", new Set());

    expect(result).toEqual({
      ok: false,
      reason: "The clipboard does not hold JSON.",
    });
  });

  it("rejects valid JSON that is not a lego payload", () => {
    const result = parseClipboardPiece(
      JSON.stringify({ hello: "world" }),
      new Set(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "The clipboard does not hold a lego piece.",
    });
  });

  it("rejects JSON carrying the marker but a project that will not parse", () => {
    const result = parseClipboardPiece(
      JSON.stringify({ marker: CLIPBOARD_MARKER, project: { nope: true } }),
      new Set(),
    );

    expect(result).toEqual({
      ok: false,
      reason: "The clipboard's lego piece could not be read.",
    });
  });

  it("rejects plain unmarked JSON even when it happens to hold a valid project", () => {
    const lifted = liftTurret();

    const result = parseClipboardPiece(JSON.stringify(lifted), new Set());

    expect(result).toEqual({
      ok: false,
      reason: "The clipboard does not hold a lego piece.",
    });
  });

  it("pastes a piece naming a part that does not exist, and reports it", () => {
    const lifted = liftTurret();
    const text = serializeClipboardPiece(lifted);

    // The current pack has no "barrel_a", perhaps because it was renamed or
    // dropped in a newer version of the pack.
    const result = parseClipboardPiece(text, new Set(["some_other_part"]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Pasted rather than dropped: the piece and its hierarchy survive.
      expect(result.piece.project.pieces.map((p) => p.name)).toEqual([
        "turret",
      ]);
      expect(result.piece.project.pieces[0]?.partId).toBe("barrel_a");
      expect(result.piece.missingParts).toEqual(["turret"]);
    }
  });

  it("pastes a payload from a different pack the same way, as every part is unknown here", () => {
    const fromAnotherPack: LegoProject = { ...liftTurret(), packId: "aliens" };
    const text = serializeClipboardPiece(fromAnotherPack);

    // This pack has never heard of "barrel_a": it belongs to "aliens", not
    // "lego". A whole different pack is not a special case, it degrades the
    // same way one missing part does.
    const result = parseClipboardPiece(text, new Set(["some_lego_part"]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.piece.project.pieces).toHaveLength(1);
      expect(result.piece.missingParts).toEqual(["turret"]);
    }
  });

  it("reports nothing missing for an empty piece with no part at all", () => {
    const emptyPoint = project([{ id: "flare", name: "flare" }]);
    const lifted = subtreeAsCompound(emptyPoint, "flare", {
      id: "c2",
      now: "2026-07-29T00:00:00Z",
      newId: counter("new"),
    }) as LegoProject;

    const result = parseClipboardPiece(
      serializeClipboardPiece(lifted),
      new Set(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.piece.missingParts).toEqual([]);
  });
});
